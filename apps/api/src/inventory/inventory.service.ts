import { randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { InventoryAssignmentStatus, InventoryMovementType, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { can, type RequestContext } from "../common/permissions";
import { currentSeason } from "../common/seasons";
import type {
  AssignDto,
  CreateItemDto,
  ImportRowDto,
  ReturnDto,
  StockMovementDto,
  UpdateItemDto,
  UpdateVariantDto,
} from "./inventory.dto";

/**
 * Fotografias de artigos.
 *
 * Bucket próprio e privado, com o mesmo caminho de três passos das fotografias
 * de atleta e das imagens de exercício (autorizar → o browser carrega direto →
 * confirmar). Guardam-se **chaves**, nunca endereços: um link assinado expira, e
 * um link expirado na base é uma imagem partida para sempre.
 */
export const INVENTORY_BUCKET = "inventario";
const IMAGE_TTL = 6 * 60 * 60;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Quatro chegam para mostrar um artigo. Mais do que isso é um catálogo. */
const IMAGE_MAX_COUNT = 4;

/**
 * O armazém do clube.
 *
 * Substitui a folha de Excel e os palitos numa A4 — e a diferença entre isto e
 * a folha não é a interface, é **saber quem mexeu e porquê**. A folha diz quanto
 * há hoje; isto diz porque é que há esse número.
 *
 * ## As três regras que atravessam o ficheiro
 *
 * 1. **O stock vive na variante.** Um artigo sem tamanhos tem uma variante
 *    "Único". Nenhum caminho de escrita mexe em quantidades no artigo, porque no
 *    artigo não há nenhuma.
 *
 * 2. **O disponível calcula-se: `total − atribuído`.** Não é coluna. Guardá-lo
 *    seria a mesma verdade escrita duas vezes, e a segunda diverge.
 *
 * 3. **Nenhuma quantidade muda sem um movimento.** As duas escritas acontecem na
 *    mesma transacção — `runAs` já abre uma —, e por isso não existe estado em
 *    que o número tenha mudado e o histórico não saiba porquê.
 *
 * ## As corridas
 *
 * Duas pessoas a entregar o último M ao mesmo tempo é o caso que uma leitura
 * seguida de escrita não resolve: as duas lêem "1 disponível" e as duas gravam.
 * Por isso o desconto é um `UPDATE` **condicional** — a condição de haver stock
 * vai no `WHERE`, e quem não afectar nenhuma linha perdeu a corrida e leva um
 * erro. Ver `descontarDisponivel`.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "inventory:read")) throw new ForbiddenException("Sem acesso ao inventário");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "inventory:write")) throw new ForbiddenException("Sem permissão para alterar o inventário");
  }

  /* ---------------------------------------------------------------------- */
  /* Leitura                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Os números do topo.
   *
   * Contados na base e não somados em memória: um clube com quarenta artigos e
   * duzentas variantes traria duzentas linhas para desenhar cinco números.
   */
  async overview(ctx: RequestContext) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const artigos = await db.inventoryItem.count({ where: { archivedAt: null } });

      const somas = await db.inventoryVariant.aggregate({
        where: { archivedAt: null, item: { archivedAt: null } },
        _sum: { totalQuantity: true, assignedQuantity: true, damagedQuantity: true, lostQuantity: true },
      });

      const total = somas._sum.totalQuantity ?? 0;
      const atribuidas = somas._sum.assignedQuantity ?? 0;

      const variantes = await this.variantesComMinimo(db);
      const baixo = variantes.filter((v) => this.nivel(v) !== "ok").length;

      return {
        artigos,
        unidades: total,
        atribuidas,
        disponiveis: total - atribuidas,
        stockBaixo: baixo,
        danificadas: somas._sum.damagedQuantity ?? 0,
        perdidas: somas._sum.lostQuantity ?? 0,
      };
    });
  }

  /** A lista de artigos, com o stock somado das variantes. */
  async items(ctx: RequestContext, params: { q?: string; categoryId?: string; status?: string } = {}) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const termo = params.q?.trim();

      const rows = await db.inventoryItem.findMany({
        where: {
          archivedAt: null,
          ...(params.categoryId ? { categoryId: params.categoryId } : {}),
          ...(termo
            ? {
                OR: [
                  { name: { contains: termo, mode: "insensitive" as const } },
                  { sku: { contains: termo, mode: "insensitive" as const } },
                  { brand: { contains: termo, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, sku: true, brand: true, minimumStock: true, description: true,
          imageKeys: true,
          category: { select: { id: true, label: true } },
          variants: {
            where: { archivedAt: null },
            orderBy: [{ order: "asc" }, { label: "asc" }],
            select: {
              id: true, label: true, sku: true, order: true, minimumStock: true,
              totalQuantity: true, assignedQuantity: true, damagedQuantity: true, lostQuantity: true,
            },
          },
        },
      });

      /*
       * A miniatura de cada artigo — só a primeira imagem.
       *
       * Assinar as quatro de cada artigo numa lista de quarenta seriam cento e
       * sessenta assinaturas para mostrar quarenta quadrados. A ficha do artigo
       * é que traz o resto.
       */
      const lista = await Promise.all(
        rows.map(async (it) => ({
          ...this.serializeItem(it),
          thumbnail: it.imageKeys[0]
            ? await this.storage.signDownload(INVENTORY_BUCKET, it.imageKeys[0], IMAGE_TTL)
            : null,
        })),
      );

      // O filtro de estado é sobre um valor derivado, por isso acontece aqui e
      // não no `where`: o nível de um artigo sai das variantes dele.
      return params.status ? lista.filter((i) => i.status === params.status) : lista;
    });
  }

  /** Um artigo: variantes, stock e o histórico dele. */
  async item(ctx: RequestContext, id: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await db.inventoryItem.findFirst({
        where: { id },
        select: {
          id: true, name: true, sku: true, brand: true, minimumStock: true, description: true, notes: true,
          archivedAt: true, imageKeys: true,
          category: { select: { id: true, label: true } },
          variants: {
            where: { archivedAt: null },
            orderBy: [{ order: "asc" }, { label: "asc" }],
            select: {
              id: true, label: true, sku: true, order: true, minimumStock: true,
              totalQuantity: true, assignedQuantity: true, damagedQuantity: true, lostQuantity: true,
            },
          },
        },
      });
      if (!row) throw new NotFoundException("Artigo não encontrado");

      const movimentos = await db.inventoryMovement.findMany({
        where: { variant: { itemId: id } },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true, type: true, quantity: true, reason: true, createdAt: true,
          variant: { select: { id: true, label: true } },
          athlete: { select: { id: true, name: true } },
          performedBy: { select: { user: { select: { name: true } } } },
        },
      });

      // Os links assinados geram-se agora, um por imagem — nunca se guardam.
      const imagens = await Promise.all(
        row.imageKeys.map(async (key) => ({
          key,
          url: await this.storage.signDownload(INVENTORY_BUCKET, key, IMAGE_TTL),
        })),
      );

      return {
        ...this.serializeItem(row),
        notes: row.notes,
        images: imagens.filter((i) => i.url !== null),
        movements: movimentos.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          reason: m.reason,
          at: m.createdAt,
          variantId: m.variant.id,
          variantLabel: m.variant.label,
          athleteId: m.athlete?.id ?? null,
          athleteName: m.athlete?.name ?? null,
          by: m.performedBy?.user.name ?? null,
        })),
      };
    });
  }

  /** O que está com atletas — a lista de "equipamento atribuído". */
  async assignments(
    ctx: RequestContext,
    params: { teamId?: string; athleteId?: string; itemId?: string; status?: string } = {},
  ) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.inventoryAssignment.findMany({
        where: {
          ...(params.athleteId ? { athleteId: params.athleteId } : {}),
          ...(params.itemId ? { variant: { itemId: params.itemId } } : {}),
          // Por omissão só o que está por devolver: é a pergunta que se faz a
          // esta lista. O histórico completo pede-se com `status=all`.
          ...(params.status === "all" ? {} : { status: (params.status as InventoryAssignmentStatus) ?? "ACTIVE" }),
          ...(params.teamId ? { athlete: { teams: { some: { teamId: params.teamId } } } } : {}),
        },
        orderBy: { assignedAt: "desc" },
        take: 500,
        select: {
          id: true, quantity: true, status: true, assignedAt: true, returnedAt: true, notes: true,
          athlete: {
            select: {
              id: true, name: true,
              teams: { select: { team: { select: { id: true, name: true } } } },
            },
          },
          variant: { select: { id: true, label: true, item: { select: { id: true, name: true } } } },
          assignedBy: { select: { user: { select: { name: true } } } },
          returnedBy: { select: { user: { select: { name: true } } } },
        },
      });

      return rows.map((a) => ({
        id: a.id,
        quantity: a.quantity,
        status: a.status,
        assignedAt: a.assignedAt,
        returnedAt: a.returnedAt,
        notes: a.notes,
        athleteId: a.athlete.id,
        athleteName: a.athlete.name,
        teamName: a.athlete.teams[0]?.team.name ?? null,
        teamId: a.athlete.teams[0]?.team.id ?? null,
        variantId: a.variant.id,
        variantLabel: a.variant.label,
        itemId: a.variant.item.id,
        itemName: a.variant.item.name,
        assignedBy: a.assignedBy?.user.name ?? null,
        returnedBy: a.returnedBy?.user.name ?? null,
      }));
    });
  }

  /** O histórico do clube inteiro, para a aba de movimentos. */
  async movements(ctx: RequestContext, params: { itemId?: string } = {}) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.inventoryMovement.findMany({
        where: params.itemId ? { variant: { itemId: params.itemId } } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true, type: true, quantity: true, reason: true, createdAt: true,
          variant: { select: { id: true, label: true, item: { select: { id: true, name: true } } } },
          athlete: { select: { id: true, name: true } },
          performedBy: { select: { user: { select: { name: true } } } },
        },
      });

      return rows.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        at: m.createdAt,
        itemId: m.variant.item.id,
        itemName: m.variant.item.name,
        variantLabel: m.variant.label,
        athleteId: m.athlete?.id ?? null,
        athleteName: m.athlete?.name ?? null,
        by: m.performedBy?.user.name ?? null,
      }));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Artigos e variantes                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Registar um artigo — ou juntá-lo a um que já existe.
   *
   * ## Duas referências iguais são o mesmo artigo
   *
   * Se a referência escrita já existir no armazém, isto **não cria um segundo
   * artigo**: soma o stock ao que lá está. É o que a referência quer dizer — é
   * ela que identifica o material, e dois artigos com a mesma são um erro de
   * registo, não duas coisas. Sem isto, ao fim de uma época o clube tem
   * "T-shirt aquecimento" três vezes e nenhuma com o número certo.
   *
   * ## Dois nomes iguais são uma pergunta
   *
   * Sem referência, o nome é tudo o que há para comparar — e um nome repetido
   * tanto pode ser a mesma t-shirt (juntar) como a de outra época (artigo novo).
   * Quem está a registar é que sabe, e por isso pergunta-se: o serviço devolve
   * `conflict` e espera pela resposta em `onConflict`. Decidir sozinho seria
   * escolher entre perder stock e duplicar o armazém.
   */
  async createItem(ctx: RequestContext, dto: CreateItemDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.validarCatalogo(db, dto.categoryId, "inventoryCategories");

      /*
       * Sem tamanhos? Nasce com "Único".
       *
       * O stock vive sempre numa variante — um artigo sem nenhuma seria um
       * artigo onde nunca se conseguiria dar entrada de nada. Resolver aqui, na
       * criação, evita que cada caminho de escrita a seguir tenha de perguntar
       * "e se não tiver variantes?".
       */
      const pedidas = dto.variants?.length ? dto.variants : [{ label: "Único" }];
      const referencia = dto.sku?.trim() || "";

      /* --------------------------------------------- já existe? --------- */
      const existente = referencia
        ? await db.inventoryItem.findFirst({
            where: { archivedAt: null, sku: { equals: referencia, mode: "insensitive" } },
            select: { id: true, name: true, sku: true, variants: { select: { id: true, label: true } } },
          })
        : await db.inventoryItem.findFirst({
            where: { archivedAt: null, name: { equals: dto.name.trim(), mode: "insensitive" } },
            select: { id: true, name: true, sku: true, variants: { select: { id: true, label: true } } },
          });

      if (existente) {
        // Referência igual: junta-se, sem perguntar. Ver a nota do cabeçalho.
        const juntar = referencia ? true : dto.onConflict === "merge";

        if (!referencia && dto.onConflict !== "merge" && dto.onConflict !== "new") {
          return {
            ok: false as const,
            conflict: { id: existente.id, name: existente.name, sku: existente.sku },
          };
        }

        if (juntar) {
          await this.juntarStock(db, ctx, existente, pedidas);
          return { ok: true as const, id: existente.id, merged: true };
        }
      }

      const sku = referencia || (await this.gerarSku(db, dto.categoryId, dto.name));

      const item = await db.inventoryItem.create({
        data: {
          academyId: ctx.academyId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          categoryId: dto.categoryId || null,
          sku,
          brand: dto.brand?.trim() || null,
          minimumStock: dto.minimumStock ?? 0,
          notes: dto.notes?.trim() || null,
          variants: {
            create: pedidas.map((v, i) => ({
              academyId: ctx.academyId,
              label: v.label.trim(),
              // A variante herda a referência do artigo com o tamanho colado —
              // `ET-0001-M`. É a convenção do retalho, e é o que se lê numa
              // etiqueta sem ter de a cruzar com nada.
              sku: v.sku?.trim() || skuDaVariante(sku, v.label),
              order: i,
              minimumStock: v.minimumStock ?? null,
              totalQuantity: v.quantity ?? 0,
            })),
          },
        },
        select: { id: true, variants: { select: { id: true, totalQuantity: true } } },
      });

      /*
       * O stock inicial é uma entrada como outra qualquer: sem isto, o histórico
       * de um artigo começaria com um número caído do céu.
       *
       * Numa instrução só. Um artigo com quarenta tamanhos são quarenta
       * movimentos, e quarenta idas à base dentro da transacção — ver a nota do
       * `importItems`, onde isso rebentou a sério.
       */
      const iniciais = item.variants
        .filter((v) => v.totalQuantity > 0)
        .map((v) => ({
          academyId: ctx.academyId,
          variantId: v.id,
          type: "ENTRY" as const,
          quantity: v.totalQuantity,
          reason: "Stock inicial",
          performedById: ctx.membershipId ?? null,
        }));
      if (iniciais.length) await db.inventoryMovement.createMany({ data: iniciais });

      return { ok: true as const, id: item.id, sku, merged: false };
    });
  }

  /**
   * Somar stock a um artigo que já existe.
   *
   * Os tamanhos que ele já tem recebem as unidades; os que não tem passam a
   * existir. Cada soma deixa um movimento — a regra 3 do topo não tem excepções,
   * e sem ela o stock de um artigo importado duas vezes ficaria sem explicação.
   */
  private async juntarStock(
    db: ScopedClient,
    ctx: RequestContext,
    item: { id: string; sku: string | null; variants: { id: string; label: string }[] },
    pedidas: { label: string; quantity?: number; minimumStock?: number; sku?: string }[],
  ) {
    const porRotulo = new Map(item.variants.map((v) => [fold(v.label), v]));
    const movimentos: Prisma.InventoryMovementCreateManyInput[] = [];

    for (const [ordem, v] of pedidas.entries()) {
      const quantidade = v.quantity ?? 0;
      const jaLa = porRotulo.get(fold(v.label));

      if (jaLa) {
        if (quantidade > 0) {
          await db.inventoryVariant.update({
            where: { id: jaLa.id },
            data: { totalQuantity: { increment: quantidade } },
          });
          movimentos.push({
            academyId: ctx.academyId,
            variantId: jaLa.id,
            type: "ENTRY",
            quantity: quantidade,
            reason: "Entrada juntada a artigo existente",
            performedById: ctx.membershipId ?? null,
          });
        }
        continue;
      }

      const nova = await db.inventoryVariant.create({
        data: {
          academyId: ctx.academyId,
          itemId: item.id,
          label: v.label.trim(),
          sku: v.sku?.trim() || skuDaVariante(item.sku, v.label),
          order: item.variants.length + ordem,
          minimumStock: v.minimumStock ?? null,
          totalQuantity: quantidade,
        },
        select: { id: true },
      });

      if (quantidade > 0) {
        movimentos.push({
          academyId: ctx.academyId,
          variantId: nova.id,
          type: "ENTRY",
          quantity: quantidade,
          reason: "Tamanho novo num artigo existente",
          performedById: ctx.membershipId ?? null,
        });
      }
    }

    if (movimentos.length) await db.inventoryMovement.createMany({ data: movimentos });
  }

  /**
   * A referência, quando o clube não escreve nenhuma.
   *
   * `ET-0001` — duas ou três letras da categoria, e uma sequência de quatro
   * dígitos. É o que se usa em armazém e em retalho, e resolve três coisas de
   * uma vez: lê-se em voz alta ao telefone, ordena-se sozinha, e diz de que
   * família é o material sem se ir ver a ficha.
   *
   * O número é o maior daquele prefixo mais um — e não uma contagem de artigos.
   * Contar daria referências repetidas ao primeiro artigo arquivado.
   */
  private async gerarSku(db: ScopedClient, categoryId: string | undefined, nome: string): Promise<string> {
    let prefixo = "ART";
    if (categoryId) {
      const cat = await db.catalogItem.findFirst({ where: { id: categoryId }, select: { label: true } });
      if (cat) prefixo = prefixoDe(cat.label);
    } else {
      // Sem categoria, o nome do artigo dá o prefixo — "Bola de treino" → "BT".
      prefixo = prefixoDe(nome);
    }

    const usados = await db.inventoryItem.findMany({
      where: { sku: { startsWith: `${prefixo}-` } },
      select: { sku: true },
    });

    const maior = usados.reduce((max, i) => {
      const n = Number(/-(\d+)$/.exec(i.sku ?? "")?.[1] ?? 0);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    return `${prefixo}-${String(maior + 1).padStart(4, "0")}`;
  }

  /**
   * Corrigir a ficha de um artigo.
   *
   * Vazio limpa, ausente não mexe — a mesma regra da ficha de sócio. O stock não
   * se toca aqui: mexe-se tamanho a tamanho, e cada alteração deixa um
   * movimento. Um campo de quantidade neste formulário seria um caminho para
   * mudar números sem explicação.
   */
  async updateItem(ctx: RequestContext, id: string, dto: UpdateItemDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const antes = await db.inventoryItem.findFirst({
        where: { id },
        select: { id: true, sku: true, variants: { select: { id: true, label: true, sku: true } } },
      });
      if (!antes) throw new NotFoundException("Artigo não encontrado");

      await this.validarCatalogo(db, dto.categoryId, "inventoryCategories");

      const texto = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
      const novaRef = dto.sku === undefined ? undefined : dto.sku.trim() || null;

      /*
       * Uma referência já usada é o mesmo artigo — e o mesmo artigo não pode
       * existir duas vezes. Aqui não se junta como na criação: juntar dois
       * artigos que já têm stock e histórico é outra operação, e não é esta.
       */
      if (novaRef && novaRef !== antes.sku) {
        const ocupada = await db.inventoryItem.findFirst({
          where: { id: { not: id }, archivedAt: null, sku: { equals: novaRef, mode: "insensitive" } },
          select: { name: true },
        });
        if (ocupada) throw new BadRequestException(`A referência ${novaRef} já é de "${ocupada.name}"`);
      }

      await db.inventoryItem.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: texto(dto.description) } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
          ...(novaRef !== undefined ? { sku: novaRef } : {}),
          ...(dto.brand !== undefined ? { brand: texto(dto.brand) } : {}),
          ...(dto.minimumStock !== undefined ? { minimumStock: dto.minimumStock } : {}),
          ...(dto.notes !== undefined ? { notes: texto(dto.notes) } : {}),
        },
      });

      /*
       * A referência mudou: os tamanhos que a seguiam seguem-na.
       *
       * Só os que foram gerados — aqueles cujo código é exactamente
       * `referência-tamanho`. Um tamanho com referência escrita à mão fica como
       * está: foi alguém que a escreveu, e é a que está na etiqueta.
       *
       * Sem isto, mudar `ET-0001` para `ET-0009` deixava seis tamanhos a dizer
       * `ET-0001-M` — e o artigo passava a ter duas referências, uma delas de
       * nada.
       */
      if (novaRef !== undefined && novaRef !== antes.sku) {
        for (const v of antes.variants) {
          const derivada = skuDaVariante(antes.sku, v.label);
          if (v.sku !== derivada && v.sku !== null) continue;
          await db.inventoryVariant.update({
            where: { id: v.id },
            data: { sku: skuDaVariante(novaRef, v.label) },
          });
        }
      }

      return { ok: true };
    });
  }

  /**
   * Arquivar um artigo.
   *
   * Nunca apagar: os movimentos e as entregas apontam para aqui, e apagar a
   * linha reescrevia o passado — o histórico de quem recebeu o quê ficaria com
   * buracos. Sai das listas e fica.
   */
  async archiveItem(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.inventoryItem.findFirst({
        where: { id },
        select: { id: true, variants: { select: { assignedQuantity: true } } },
      });
      if (!item) throw new NotFoundException("Artigo não encontrado");

      // Com material na rua, arquivar esconderia da lista aquilo que ainda é
      // preciso ir buscar a alguém.
      const porDevolver = item.variants.reduce((a, v) => a + v.assignedQuantity, 0);
      if (porDevolver > 0) {
        throw new BadRequestException(
          `Ainda há ${porDevolver} ${porDevolver === 1 ? "unidade" : "unidades"} por devolver. Recebe-as primeiro.`,
        );
      }

      await db.inventoryItem.update({ where: { id }, data: { archivedAt: new Date() } });
      return { ok: true };
    });
  }

  /**
   * Apagar um artigo — a sério, com o histórico.
   *
   * ## Porque é que isto existe ao lado de arquivar
   *
   * Arquivar é o caminho normal: tira o artigo das listas e guarda tudo o que
   * aconteceu com ele. Serve para o material que o clube deixou de usar mas que
   * já foi entregue a gente — e essas entregas são registo do que aconteceu.
   *
   * Apagar é para o que **nunca devia ter existido**: o artigo criado a testar, o
   * nome duplicado, a importação com a coluna errada. Aí o histórico não é
   * história nenhuma — é ruído que suja as contagens e o armazém para sempre.
   *
   * ## O que leva atrás
   *
   * Os tamanhos, os movimentos e as entregas já fechadas, por cascata. É por
   * isso que se exige o **nome escrito à mão**, como no apagar de uma equipa: é
   * a única acção deste módulo sem volta, e um clique distraído não a deve
   * conseguir.
   *
   * ## O que a impede
   *
   * Material na rua. Apagar um artigo que está com atletas apagaria a prova de
   * que lhes foi entregue — e alguém ficaria com uma t-shirt que o clube não
   * sabe que deu. Recebe-se primeiro.
   */
  async deleteItem(ctx: RequestContext, id: string, confirmName: string) {
    this.mustWrite(ctx);

    const apagado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.inventoryItem.findFirst({
        where: { id },
        select: {
          id: true, name: true, imageKeys: true,
          variants: { select: { assignedQuantity: true } },
        },
      });
      if (!item) throw new NotFoundException("Artigo não encontrado");

      const normalizar = (v: string) => v.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt");
      if (normalizar(confirmName) !== normalizar(item.name)) {
        throw new BadRequestException(`Para confirmar, escreve o nome do artigo exactamente: ${item.name}`);
      }

      const naRua = item.variants.reduce((a, v) => a + v.assignedQuantity, 0);
      if (naRua > 0) {
        throw new BadRequestException(
          `Ainda há ${naRua} ${naRua === 1 ? "unidade" : "unidades"} com atletas. Recebe-as antes de apagar.`,
        );
      }

      // O que se perde, contado antes de se perder — a resposta di-lo, e o
      // diálogo mostrou-o antes de perguntar.
      const perdas = {
        tamanhos: item.variants.length,
        movimentos: await db.inventoryMovement.count({ where: { variant: { itemId: id } } }),
        entregas: await db.inventoryAssignment.count({ where: { variant: { itemId: id } } }),
      };

      await db.inventoryItem.delete({ where: { id } });

      return { ok: true as const, name: item.name, imageKeys: item.imageKeys, ...perdas };
    });

    /*
     * As fotografias saem depois, fora da transacção.
     *
     * Apagar um ficheiro não se desfaz: se isto corresse lá dentro e a
     * transacção falhasse a seguir, ficava a ficha com chaves sem ficheiro por
     * trás — e nenhuma maneira de as recuperar. A mesma ordem de `removeImage`.
     *
     * Uma falha aqui deixa ficheiros órfãos no armazenamento, e é o mal menor:
     * ninguém lhes chega sem a chave, e a linha que as apontava já não existe.
     */
    for (const key of apagado.imageKeys) {
      await this.storage.remove(INVENTORY_BUCKET, key).catch(() => undefined);
    }

    return apagado;
  }

  async addVariant(ctx: RequestContext, itemId: string, dto: { label: string; sku?: string; quantity?: number; minimumStock?: number }) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const item = await db.inventoryItem.findFirst({
        where: { id: itemId },
        select: { id: true, sku: true, variants: { select: { order: true } } },
      });
      if (!item) throw new NotFoundException("Artigo não encontrado");

      const variant = await db.inventoryVariant.create({
        data: {
          academyId: ctx.academyId,
          itemId,
          label: dto.label.trim(),
          // Herda a do artigo com o tamanho colado, como as outras — um tamanho
          // acrescentado depois não tem por que ficar sem etiqueta.
          sku: dto.sku?.trim() || skuDaVariante(item.sku, dto.label),
          order: Math.max(0, ...item.variants.map((v) => v.order + 1), 0),
          minimumStock: dto.minimumStock ?? null,
          totalQuantity: dto.quantity ?? 0,
        },
        select: { id: true },
      });

      if (dto.quantity && dto.quantity > 0) {
        await this.registarMovimento(db, ctx, {
          variantId: variant.id,
          type: "ENTRY",
          quantity: dto.quantity,
          reason: "Stock inicial",
        });
      }

      return { id: variant.id };
    });
  }

  async updateVariant(ctx: RequestContext, id: string, dto: UpdateVariantDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const existe = await db.inventoryVariant.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException("Tamanho não encontrado");

      await db.inventoryVariant.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(dto.sku !== undefined ? { sku: dto.sku.trim() || null } : {}),
          ...(dto.minimumStock !== undefined ? { minimumStock: dto.minimumStock } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });

      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Fotografias                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Passo 1: a autorização — um endereço assinado para uma chave nossa.
   *
   * O ficheiro nunca passa pelo nosso servidor: o browser carrega-o direto para
   * o armazenamento. É o mesmo caminho das fotografias de atleta, e a razão é a
   * mesma — um upload de 8 MB a atravessar a API é 8 MB de memória que ela não
   * tem para dar a mais ninguém.
   */
  async imageUploadUrl(ctx: RequestContext, itemId: string, contentType: string) {
    this.mustWrite(ctx);
    if (!IMAGE_TYPES.includes(contentType)) {
      throw new BadRequestException("A imagem tem de ser JPEG, PNG ou WebP");
    }
    await this.mustExist(ctx, itemId);
    await this.storage.ensureBucket({
      name: INVENTORY_BUCKET,
      fileSizeLimit: IMAGE_MAX_BYTES,
      allowedMimeTypes: IMAGE_TYPES,
    });

    const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
    const key = `artigos/${itemId}/${randomBytes(8).toString("hex")}${ext}`;
    const signed = await this.storage.signUpload(INVENTORY_BUCKET, key);
    return { ...signed, key, maxBytes: IMAGE_MAX_BYTES };
  }

  /** Passo 3: confirmar que o ficheiro chegou e juntar a chave à ficha. */
  async addImage(ctx: RequestContext, itemId: string, key: string) {
    this.mustWrite(ctx);
    await this.mustExist(ctx, itemId);

    // A chave tem de ser deste artigo — uma autorização não aponta a ficha de
    // outro para a mesma imagem. Mesma regra das fotografias de atleta.
    if (!key.startsWith(`artigos/${itemId}/`)) throw new BadRequestException("Chave inválida");
    if (!(await this.storage.exists(INVENTORY_BUCKET, key))) {
      throw new BadRequestException("O ficheiro não chegou ao armazenamento");
    }

    await this.prisma.runAs(ctx.academyId, async (db) => {
      const it = await db.inventoryItem.findFirst({ where: { id: itemId }, select: { imageKeys: true } });
      if (!it) throw new NotFoundException("Artigo não encontrado");
      if (it.imageKeys.length >= IMAGE_MAX_COUNT) {
        throw new BadRequestException(`Um artigo leva no máximo ${IMAGE_MAX_COUNT} fotografias`);
      }
      if (!it.imageKeys.includes(key)) {
        await db.inventoryItem.update({ where: { id: itemId }, data: { imageKeys: [...it.imageKeys, key] } });
      }
    });

    return { key, url: await this.storage.signDownload(INVENTORY_BUCKET, key, IMAGE_TTL) };
  }

  async removeImage(ctx: RequestContext, itemId: string, key: string) {
    this.mustWrite(ctx);

    const tinha = await this.prisma.runAs(ctx.academyId, async (db) => {
      const it = await db.inventoryItem.findFirst({ where: { id: itemId }, select: { imageKeys: true } });
      if (!it) throw new NotFoundException("Artigo não encontrado");
      if (!it.imageKeys.includes(key)) return false;
      await db.inventoryItem.update({
        where: { id: itemId },
        data: { imageKeys: it.imageKeys.filter((k) => k !== key) },
      });
      return true;
    });

    // Fora da transacção: apagar o ficheiro é irreversível, e se a transacção
    // desfizesse a seguir ficava a ficha com uma chave sem ficheiro por trás.
    if (tinha) await this.storage.remove(INVENTORY_BUCKET, key);
    return { ok: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Importação                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * O armazém que o clube já tinha, numa folha.
   *
   * ## Uma linha por tamanho, um artigo por nome
   *
   * A folha do clube tem uma linha por tamanho — é assim que se conta material
   * numa prateleira. Aqui, linhas com o **mesmo nome de artigo** juntam-se num
   * artigo com vários tamanhos, que é o modelo do produto. É a tradução que
   * evita quarenta artigos chamados "T-shirt aquecimento M", "… L", "… XL".
   *
   * ## Tudo ou nada
   *
   * Uma folha com um erro não entra pela metade: metade do armazém importado é o
   * pior sítio onde parar, porque a segunda tentativa duplica o que já entrou.
   * O `runAs` já corre isto dentro de uma transacção.
   *
   * As categorias novas **criam-se**, ao contrário dos sócios onde se pergunta:
   * uma categoria de material é uma gaveta do armazém, não uma decisão com
   * consequências em quotas e no site.
   */
  async importItems(ctx: RequestContext, rows: ImportRowDto[]) {
    this.mustWrite(ctx);
    if (rows.length === 0) throw new BadRequestException("A folha não tem linhas");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const problemas: { line: number; reason: string }[] = [];

      const categorias = await db.catalogItem.findMany({
        where: { kind: "inventoryCategories" },
        select: { id: true, label: true },
      });
      const porNome = new Map(categorias.map((c) => [fold(c.label), c.id]));

      const existentes = await db.inventoryItem.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, sku: true, variants: { select: { id: true, label: true } } },
      });
      const jaLa = new Map(existentes.map((i) => [fold(i.name), i]));
      /*
       * A referência manda sobre o nome.
       *
       * Uma folha que traga a referência do clube identifica o artigo por ela —
       * é o que ela é. O nome pode estar escrito de duas maneiras entre folhas
       * ("T-shirt aquecimento" e "T-shirt de aquecimento") e a referência não.
       */
      const porSku = new Map(existentes.filter((i) => i.sku).map((i) => [fold(i.sku!), i]));

      /** Agrupado por nome de artigo — ver a nota do cabeçalho. */
      const artigos = new Map<
        string,
        { name: string; category?: string; brand?: string; sku?: string; minimumStock?: number; variants: { label: string; quantity: number; line: number }[] }
      >();

      rows.forEach((row, i) => {
        const line = row.line ?? i + 2;
        const nome = row.name.trim();
        const chave = fold(nome);
        if (!artigos.has(chave)) {
          artigos.set(chave, {
            name: nome,
            category: row.category?.trim() || undefined,
            brand: row.brand?.trim() || undefined,
            sku: row.sku?.trim() || undefined,
            minimumStock: row.minimumStock,
            variants: [],
          });
        }
        const artigo = artigos.get(chave)!;
        const tamanho = row.size?.trim() || "Único";

        if (artigo.variants.some((v) => fold(v.label) === fold(tamanho))) {
          problemas.push({ line, reason: `"${nome}" tem o tamanho ${tamanho} repetido na folha` });
          return;
        }
        artigo.variants.push({ label: tamanho, quantity: row.quantity ?? 0, line });
      });

      if (problemas.length > 0) return { ok: false as const, created: 0, updated: 0, problems: problemas };

      let criados = 0;
      let actualizados = 0;

      /*
       * As escritas juntam-se em três instruções, e não noventa.
       *
       * `runAs` corre isto dentro de uma transacção, e uma transacção tem tempo
       * contado. A primeira versão criava artigo, variante e movimento um a um:
       * uma folha real — dezassete artigos, trinta e nove tamanhos — dava perto
       * de noventa idas à base, e a transacção expirava a meio com um erro que
       * não dizia nada a quem estava a importar.
       *
       * Passou a três `createMany`, com os identificadores gerados aqui: sem
       * eles, não haveria como ligar o movimento à variante que ainda não tinha
       * id. É a diferença entre uma importação que demora um segundo e uma que
       * não acaba.
       */
      const novosItens: Prisma.InventoryItemCreateManyInput[] = [];
      const novasVariantes: Prisma.InventoryVariantCreateManyInput[] = [];
      const novosMovimentos: Prisma.InventoryMovementCreateManyInput[] = [];
      /** A referência de cada artigo novo, para as variantes a herdarem. */
      const skuPorItem = new Map<string, string>();

      for (const artigo of artigos.values()) {
        // A categoria pelo nome, sem caixa nem acentos. Nova? cria-se.
        let categoryId: string | null = null;
        if (artigo.category) {
          const encontrada = porNome.get(fold(artigo.category));
          if (encontrada) {
            categoryId = encontrada;
          } else {
            const nova = await db.catalogItem.create({
              data: { academyId: ctx.academyId, kind: "inventoryCategories", label: artigo.category, order: porNome.size },
              select: { id: true, label: true },
            });
            porNome.set(fold(nova.label), nova.id);
            categoryId = nova.id;
          }
        }

        const antigo = (artigo.sku ? porSku.get(fold(artigo.sku)) : undefined) ?? jaLa.get(fold(artigo.name));

        /*
         * Um artigo que já existe não se duplica: junta-se-lhe os tamanhos que
         * a folha traz e que ele ainda não tem. Reimportar a mesma folha passa a
         * ser inofensivo — e é o que acontece sempre, porque a primeira
         * importação nunca sai perfeita.
         */
        const itemId = antigo?.id ?? randomUUID();

        if (antigo) {
          actualizados++;
        } else {
          criados++;
          // Uma folha de armazém raramente traz referências. Geradas aqui, com o
          // mesmo formato do registo manual — ver `gerarSku`.
          const sku = artigo.sku || (await this.gerarSku(db, categoryId ?? undefined, artigo.name));
          skuPorItem.set(itemId, sku);
          novosItens.push({
            id: itemId,
            academyId: ctx.academyId,
            name: artigo.name,
            categoryId,
            brand: artigo.brand ?? null,
            sku,
            minimumStock: artigo.minimumStock ?? 0,
          });
        }

        const tamanhosDele = new Set((antigo?.variants ?? []).map((v) => fold(v.label)));

        for (const [ordem, v] of artigo.variants.entries()) {
          if (tamanhosDele.has(fold(v.label))) continue;

          const variantId = randomUUID();
          novasVariantes.push({
            id: variantId,
            academyId: ctx.academyId,
            itemId,
            label: v.label,
            sku: skuDaVariante(skuPorItem.get(itemId) ?? antigo?.sku ?? null, v.label),
            order: ordem,
            totalQuantity: v.quantity,
          });

          // O stock que a folha traz é uma entrada como outra qualquer: sem
          // isto, o histórico começava com um número sem origem.
          if (v.quantity > 0) {
            novosMovimentos.push({
              academyId: ctx.academyId,
              variantId,
              type: "ENTRY",
              quantity: v.quantity,
              reason: "Importação",
              performedById: ctx.membershipId ?? null,
            });
          }
        }
      }

      // A ordem importa: as variantes apontam para os artigos, e os movimentos
      // para as variantes.
      if (novosItens.length) await db.inventoryItem.createMany({ data: novosItens });
      if (novasVariantes.length) await db.inventoryVariant.createMany({ data: novasVariantes });
      if (novosMovimentos.length) await db.inventoryMovement.createMany({ data: novosMovimentos });

      return { ok: true as const, created: criados, updated: actualizados, problems: [] };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stock                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Dar entrada, dar saída, ou corrigir a contagem.
   *
   * `ADJUSTMENT` **fixa** o total no valor dado, em vez de somar: "afinal são
   * 48" é o que quem conta a prateleira sabe dizer, e obrigá-lo a calcular a
   * diferença de cabeça é como se estraga um inventário.
   *
   * O total nunca desce abaixo do que está entregue: se há 30 t-shirts com
   * atletas, o clube não pode ter 20 no total — seriam dez que existem em
   * mãos e não na contabilidade.
   */
  async moveStock(ctx: RequestContext, variantId: string, dto: StockMovementDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const v = await db.inventoryVariant.findFirst({
        where: { id: variantId },
        select: { id: true, label: true, totalQuantity: true, assignedQuantity: true },
      });
      if (!v) throw new NotFoundException("Tamanho não encontrado");

      const novoTotal =
        dto.type === "ENTRY" ? v.totalQuantity + dto.quantity
        : dto.type === "EXIT" ? v.totalQuantity - dto.quantity
        : dto.quantity;

      if (novoTotal < 0) {
        throw new BadRequestException(`Não há ${dto.quantity} unidades para dar saída — há ${v.totalQuantity}`);
      }
      if (novoTotal < v.assignedQuantity) {
        throw new BadRequestException(
          `Há ${v.assignedQuantity} unidades entregues a atletas: o total não pode ficar abaixo disso`,
        );
      }

      await db.inventoryVariant.update({ where: { id: variantId }, data: { totalQuantity: novoTotal } });

      await this.registarMovimento(db, ctx, {
        variantId,
        type: dto.type as InventoryMovementType,
        // Num ajuste, o que interessa ao histórico é a diferença — "passou a 48"
        // não se lê; "menos 2, contagem" lê-se.
        quantity: dto.type === "ADJUSTMENT" ? Math.abs(novoTotal - v.totalQuantity) : dto.quantity,
        reason: dto.reason?.trim() || (dto.type === "ADJUSTMENT" ? `Contagem: ${novoTotal}` : null),
      });

      return { ok: true, total: novoTotal, available: novoTotal - v.assignedQuantity };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Entregas e devoluções                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Entregar equipamento a um atleta.
   *
   * As quatro escritas — descontar, criar a entrega, registar o movimento —
   * acontecem na mesma transacção. Uma entrega gravada sem o stock descer, ou o
   * contrário, é pior do que não ter módulo nenhum: passa a haver dois números
   * verdadeiros e nenhum de confiança.
   */
  async assign(ctx: RequestContext, dto: AssignDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atleta = await db.athlete.findFirst({ where: { id: dto.athleteId }, select: { id: true, name: true } });
      if (!atleta) throw new NotFoundException("Atleta não encontrado");

      const variante = await db.inventoryVariant.findFirst({
        where: { id: dto.variantId, archivedAt: null },
        select: { id: true, label: true, item: { select: { id: true, name: true, archivedAt: true } } },
      });
      if (!variante || variante.item.archivedAt) throw new NotFoundException("Tamanho não encontrado");

      await this.descontarDisponivel(db, dto.variantId, dto.quantity);

      /*
       * A época da entrega.
       *
       * Guardava-se `null` sempre que ninguém tivesse marcado `isCurrent` — que
       * é o estado normal de um clube (ver `currentSeason`). Uma entrega sem
       * época não aparece no que o clube deu esta época, e o buraco só se nota
       * meses depois, a fechar contas.
       */
      const season = await currentSeason(db);

      const entrega = await db.inventoryAssignment.create({
        data: {
          academyId: ctx.academyId,
          athleteId: dto.athleteId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          notes: dto.notes?.trim() || null,
          seasonId: season?.id ?? null,
          assignedById: ctx.membershipId ?? null,
        },
        select: { id: true },
      });

      await this.registarMovimento(db, ctx, {
        variantId: dto.variantId,
        type: "ASSIGNMENT",
        quantity: dto.quantity,
        athleteId: dto.athleteId,
        assignmentId: entrega.id,
        reason: dto.notes?.trim() || null,
      });

      return { id: entrega.id, athleteName: atleta.name, itemName: variante.item.name, variantLabel: variante.label };
    });
  }

  /**
   * Receber de volta.
   *
   * Em bom estado volta à prateleira; danificado ou perdido sai do total e fica
   * contado como baixa. A unidade não desaparece do mundo por não estar
   * utilizável — desaparece do que o clube pode entregar, que é outra coisa, e é
   * a diferença que permite responder a "quanto se perdeu esta época".
   *
   * Devolução parcial é aceite: entregaram-se três coletes e voltaram dois.
   */
  async returnAssignment(ctx: RequestContext, id: string, dto: ReturnDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const entrega = await db.inventoryAssignment.findFirst({
        where: { id },
        select: { id: true, quantity: true, status: true, variantId: true, athleteId: true },
      });
      if (!entrega) throw new NotFoundException("Entrega não encontrada");
      if (entrega.status !== "ACTIVE") throw new BadRequestException("Esta entrega já foi fechada");

      const quantos = dto.quantity ?? entrega.quantity;
      if (quantos > entrega.quantity) {
        throw new BadRequestException(`Só foram entregues ${entrega.quantity}`);
      }

      const baixa = dto.condition !== "GOOD";

      await db.inventoryVariant.update({
        where: { id: entrega.variantId },
        data: {
          assignedQuantity: { decrement: quantos },
          // Em bom estado o total não muda — a unidade só troca de sítio, de
          // "com o atleta" para "na prateleira".
          ...(baixa ? { totalQuantity: { decrement: quantos } } : {}),
          ...(dto.condition === "DAMAGED" ? { damagedQuantity: { increment: quantos } } : {}),
          ...(dto.condition === "LOST" ? { lostQuantity: { increment: quantos } } : {}),
        },
      });

      const estado: InventoryAssignmentStatus =
        dto.condition === "DAMAGED" ? "DAMAGED" : dto.condition === "LOST" ? "LOST" : "RETURNED";

      /*
       * Devolução parcial: a linha original fica com o que sobrou em mãos e
       * abre-se uma linha fechada com o que voltou. Assim o que o atleta ainda
       * tem continua a ser uma linha `ACTIVE` — que é o que a lista de
       * "equipamento atribuído" mostra — em vez de um saldo escondido.
       */
      const parcial = quantos < entrega.quantity;
      const fechada = parcial
        ? await db.inventoryAssignment.create({
            data: {
              academyId: ctx.academyId,
              athleteId: entrega.athleteId,
              variantId: entrega.variantId,
              quantity: quantos,
              status: estado,
              returnedAt: new Date(),
              returnedById: ctx.membershipId ?? null,
              notes: dto.notes?.trim() || null,
            },
            select: { id: true },
          })
        : null;

      if (parcial) {
        await db.inventoryAssignment.update({
          where: { id },
          data: { quantity: entrega.quantity - quantos },
        });
      } else {
        await db.inventoryAssignment.update({
          where: { id },
          data: {
            status: estado,
            returnedAt: new Date(),
            returnedById: ctx.membershipId ?? null,
            ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
          },
        });
      }

      await this.registarMovimento(db, ctx, {
        variantId: entrega.variantId,
        type: dto.condition === "DAMAGED" ? "DAMAGE" : dto.condition === "LOST" ? "LOSS" : "RETURN",
        quantity: quantos,
        athleteId: entrega.athleteId,
        assignmentId: fechada?.id ?? id,
        reason: dto.notes?.trim() || null,
      });

      return { ok: true, status: estado };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Miudezas                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Descontar do disponível, à prova de corridas.
   *
   * A condição de haver stock vai no `WHERE` do `UPDATE`, e não num `if` antes
   * dele. Duas entregas simultâneas do último M lêem ambas "1 disponível"; com a
   * verificação em SQL, só uma afecta uma linha — a outra não afecta nenhuma e
   * leva o erro. Sem isto, o stock ia a -1 e ninguém dava por ela até faltar
   * uma t-shirt no balneário.
   */
  private async descontarDisponivel(db: ScopedClient, variantId: string, quantidade: number) {
    const mexeu = await db.$executeRaw`
      UPDATE "InventoryVariant"
         SET "assignedQuantity" = "assignedQuantity" + ${quantidade},
             "updatedAt" = now()
       WHERE "id" = ${variantId}
         AND "totalQuantity" - "assignedQuantity" >= ${quantidade}`;

    if (mexeu === 0) {
      const v = await db.inventoryVariant.findFirst({
        where: { id: variantId },
        select: { totalQuantity: true, assignedQuantity: true },
      });
      const disponivel = v ? v.totalQuantity - v.assignedQuantity : 0;
      throw new BadRequestException(
        disponivel <= 0
          ? "Não há stock disponível deste tamanho"
          : `Só há ${disponivel} ${disponivel === 1 ? "unidade disponível" : "unidades disponíveis"}`,
      );
    }
  }

  private async mustExist(ctx: RequestContext, itemId: string) {
    const existe = await this.prisma.runAs(ctx.academyId, (db) =>
      db.inventoryItem.findFirst({ where: { id: itemId }, select: { id: true } }),
    );
    if (!existe) throw new NotFoundException("Artigo não encontrado");
  }

  /** Nenhuma quantidade muda sem uma linha aqui. Ver a regra 3 do topo. */
  private async registarMovimento(
    db: ScopedClient,
    ctx: RequestContext,
    m: {
      variantId: string;
      type: InventoryMovementType;
      quantity: number;
      athleteId?: string | null;
      assignmentId?: string | null;
      reason?: string | null;
    },
  ) {
    await db.inventoryMovement.create({
      data: {
        academyId: ctx.academyId,
        variantId: m.variantId,
        type: m.type,
        quantity: m.quantity,
        athleteId: m.athleteId ?? null,
        assignmentId: m.assignmentId ?? null,
        reason: m.reason ?? null,
        performedById: ctx.membershipId ?? null,
      } satisfies Prisma.InventoryMovementUncheckedCreateInput,
    });
  }

  /**
   * O catálogo é uma tabela só — locais, balneários, provas, e agora categorias
   * e localizações de material. Não chega verificar que o id existe: tem de ser
   * do `kind` certo, senão liga-se um artigo a um balneário.
   */
  private async validarCatalogo(db: ScopedClient, id: string | undefined, kind: string) {
    if (!id) return;
    const item = await db.catalogItem.findFirst({ where: { id, kind }, select: { id: true } });
    if (!item) throw new BadRequestException("Categoria desconhecida");
  }

  private async variantesComMinimo(db: ScopedClient) {
    return db.inventoryVariant.findMany({
      where: { archivedAt: null, item: { archivedAt: null } },
      select: {
        totalQuantity: true,
        assignedQuantity: true,
        minimumStock: true,
        item: { select: { minimumStock: true } },
      },
    });
  }

  /**
   * O nível de um tamanho: esgotado, baixo, ou em condições.
   *
   * Conta o **disponível** e não o total: vinte t-shirts todas entregues são
   * vinte t-shirts que não se podem dar a ninguém, e um armazém que se diz cheio
   * quando não tem nada para entregar é um armazém que mente.
   */
  private nivel(v: { totalQuantity: number; assignedQuantity: number; minimumStock: number | null; item: { minimumStock: number } }) {
    const disponivel = v.totalQuantity - v.assignedQuantity;
    const minimo = v.minimumStock ?? v.item.minimumStock;
    if (disponivel <= 0) return "out" as const;
    if (minimo > 0 && disponivel <= minimo) return "low" as const;
    return "ok" as const;
  }

  private serializeItem(it: {
    id: string;
    name: string;
    sku: string | null;
    brand: string | null;
    minimumStock: number;
    description: string | null;
    category: { id: string; label: string } | null;
    variants: {
      id: string; label: string; sku: string | null; order: number; minimumStock: number | null;
      totalQuantity: number; assignedQuantity: number; damagedQuantity: number; lostQuantity: number;
    }[];
  }) {
    const variants = it.variants.map((v) => {
      const nivel = this.nivel({ ...v, item: { minimumStock: it.minimumStock } });
      return {
        id: v.id,
        label: v.label,
        sku: v.sku,
        order: v.order,
        minimumStock: v.minimumStock ?? it.minimumStock,
        ownMinimum: v.minimumStock,
        total: v.totalQuantity,
        assigned: v.assignedQuantity,
        available: v.totalQuantity - v.assignedQuantity,
        damaged: v.damagedQuantity,
        lost: v.lostQuantity,
        status: nivel === "out" ? "out" : nivel === "low" ? "low" : "ok",
      };
    });

    const total = variants.reduce((a, v) => a + v.total, 0);
    const assigned = variants.reduce((a, v) => a + v.assigned, 0);

    return {
      id: it.id,
      name: it.name,
      sku: it.sku,
      brand: it.brand,
      description: it.description,
      minimumStock: it.minimumStock,
      category: it.category,
      variants,
      total,
      assigned,
      available: total - assigned,
      // O pior estado das variantes manda: um artigo com o M esgotado não é um
      // artigo "disponível", por muitos XXL que tenha na prateleira.
      status: variants.some((v) => v.status === "out")
        ? "out"
        : variants.some((v) => v.status === "low")
          ? "low"
          : "ok",
    };
  }
}

/** Sem acentos, sem caixa — como uma pessoa escreve o mesmo nome de duas formas. */
function fold(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * O prefixo de uma referência, a partir do nome da família.
 *
 * "Equipamento de treino" → `ET`; "Material médico" → `MM`; "Bolas" → `BOL`.
 * As preposições não contam — "de", "do", "e" — senão "Material de treino" dava
 * `MDT` e ninguém percebia o D.
 *
 * Uma palavra só dá as três primeiras letras: duas letras de uma palavra única
 * são ambíguas de mais num armazém com dez famílias.
 */
function prefixoDe(nome: string): string {
  const stop = new Set(["de", "do", "da", "dos", "das", "e", "a", "o", "para", "em"]);
  const palavras = fold(nome)
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !stop.has(p));

  if (palavras.length === 0) return "ART";
  if (palavras.length === 1) return palavras[0].slice(0, 3).toUpperCase();
  return palavras
    .slice(0, 3)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/**
 * A referência de um tamanho: a do artigo com o tamanho colado — `ET-0001-M`.
 *
 * É a convenção do retalho para variantes, e serve para o que uma etiqueta
 * precisa: identificar a peça exacta sem ter de cruzar duas colunas.
 */
function skuDaVariante(skuDoArtigo: string | null, rotulo: string): string | null {
  if (!skuDoArtigo) return null;
  const sufixo = rotulo.trim().toUpperCase().replace(/\s+/g, "");
  return sufixo ? `${skuDoArtigo}-${sufixo}` : skuDoArtigo;
}
