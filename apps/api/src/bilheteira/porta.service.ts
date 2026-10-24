import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { can, type RequestContext } from "../common/permissions";
import { siteIncluido, SEM_PLANO } from "../site/plano";
import { recintosValidos, type Recinto } from "../site/site.tipos";
import { quotaDoSocioCobre } from "./contexto";
import { horaNoFuso } from "../common/fuso";
import { BilheteiraEmissao } from "./emissao.service";
import {
  PIN_BLOQUEIO_MIN,
  PIN_TENTATIVAS,
  TODAS_AS_PORTAS,
  decidirEntrada,
  guardarPin,
  lerCodigo,
  novoPin,
  novoToken,
  pinCerto,
  resumoDoToken,
  type Resultado,
} from "./regras";
import type { AcessoDaPortaDto, EntrarNaPortaDto, LerDto } from "./bilheteira.dto";

/**
 * O leitor à porta.
 *
 * ## Quem lê
 *
 * Um segurança contratado não tem conta na consola, nem deve ter. A consola
 * cria, por jogo e por porta, um **link** (32 bytes aleatórios) e um **PIN**
 * de seis algarismos, mostrados uma vez e guardados só como resumo. O link
 * abre o leitor; o PIN entrega uma sessão assinada que só serve para ler
 * códigos desse jogo nessa porta, e caduca seis horas depois do fim do jogo.
 * Cinco PINs errados seguidos bloqueiam o link 15 minutos.
 *
 * ## O que o leitor vê
 *
 * A bancada e o tipo do bilhete, e a porta certa quando é a errada. Nunca o
 * nome nem o contacto de quem comprou.
 *
 * ## Dois seguranças, o mesmo bilhete
 *
 * Marcar o bilhete como usado é um `UPDATE ... WHERE status = 'VALID'`: quem
 * chega em segundo não altera linha nenhuma e lê "já entrou". Um lugar anual
 * entra uma vez por jogo pelo índice único de `TicketScan` (ver a migração).
 */

const SESSAO_HORAS = 14;
/**
 * Leituras por acesso e por minuto. O tecto por endereço não serve (é o do
 * intermediário, partilhado por todos os clubes); este é por segurança: um
 * leitor a sério lê um bilhete a cada dois ou três segundos.
 */
const LEITURAS_POR_MINUTO = 120;
const ESTADOS_POR_MINUTO = 20;

@Injectable()
export class PortaService {
  private readonly log = new Logger(PortaService.name);
  /** Os pedidos de cada acesso no último minuto, na memória (uma instância da API). */
  private readonly ritmo = new Map<string, number[]>();

  private dentroDoRitmo(chave: string, limite: number): boolean {
    const agora = Date.now();
    const lista = (this.ritmo.get(chave) ?? []).filter((t) => t > agora - 60_000);
    if (lista.length >= limite) return false;
    lista.push(agora);
    this.ritmo.set(chave, lista);
    if (this.ritmo.size > 5000) this.ritmo.clear();
    return true;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly emissao: BilheteiraEmissao,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* A consola: criar e revogar acessos                                         */
  /* ------------------------------------------------------------------------ */

  private async escrever(ctx: RequestContext) {
    if (!can(ctx, "website:write")) throw new ForbiddenException("Sem permissão para mexer na bilheteira");
    const ok = await this.prisma.runAs(ctx.academyId, (db) => siteIncluido(db, ctx.academyId));
    if (!ok) throw new ForbiddenException({ code: "SITE_NOT_IN_PLAN", message: SEM_PLANO });
  }

  private async recintoDoJogo(db: ScopedClient, academyId: string, matchId: string): Promise<Recinto | null> {
    const [venda, config] = await Promise.all([
      db.siteMatchTickets.findUnique({ where: { matchId }, select: { venueId: true } }),
      db.siteConfig.findUnique({ where: { academyId }, select: { venues: true } }),
    ]);
    return recintosValidos(config?.venues).find((r) => r.id === venda?.venueId) ?? null;
  }

  private nomeDaPorta(recinto: Recinto | null, gateId: string): string {
    if (gateId === TODAS_AS_PORTAS) return "Todas as portas";
    return recinto?.portas.find((p) => p.id === gateId)?.nome ?? "Porta";
  }

  async acessos(ctx: RequestContext, matchId: string) {
    await this.escrever(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const recinto = await this.recintoDoJogo(db, ctx.academyId, matchId);
      const lista = await db.ticketGateAccess.findMany({ where: { matchId }, orderBy: { createdAt: "asc" } });
      const agora = new Date();
      return {
        portas: [{ id: TODAS_AS_PORTAS, nome: "Todas as portas" }, ...(recinto?.portas.map((p) => ({ id: p.id, nome: p.nome })) ?? [])],
        acessos: lista.map((a) => ({
          id: a.id,
          gateId: a.gateId,
          porta: this.nomeDaPorta(recinto, a.gateId),
          label: a.label,
          expiraEm: a.expiresAt.toISOString(),
          ativo: !a.revokedAt && a.expiresAt > agora,
          bloqueado: !!a.lockedUntil && a.lockedUntil > agora,
          criadoPor: a.createdByName,
        })),
      };
    });
  }

  /**
   * Um acesso novo. O link e o PIN só se mostram aqui, uma vez: na base fica
   * o resumo, e quem os perder cria outro.
   */
  async criarAcesso(ctx: RequestContext, matchId: string, dto: AcessoDaPortaDto) {
    await this.escrever(ctx);
    const token = novoToken();
    const pin = novoPin();
    const criado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const jogo = await db.match.findFirst({ where: { id: matchId }, select: { endsAt: true } });
      if (!jogo) throw new NotFoundException("Jogo não encontrado");
      const recinto = await this.recintoDoJogo(db, ctx.academyId, matchId);
      if (dto.gateId !== TODAS_AS_PORTAS && !recinto?.portas.some((p) => p.id === dto.gateId)) {
        throw new BadRequestException("Essa porta não existe no recinto do jogo. Cria as portas no Estádio.");
      }
      const quem = await db.user.findFirst({ where: { id: ctx.userId }, select: { name: true } });
      const expira = new Date(Math.max(jogo.endsAt.getTime() + 6 * 60 * 60_000, Date.now() + 60 * 60_000));
      const a = await db.ticketGateAccess.create({
        data: {
          academyId: ctx.academyId,
          matchId,
          gateId: dto.gateId,
          label: dto.label?.trim() || this.nomeDaPorta(recinto, dto.gateId),
          tokenHash: resumoDoToken(token),
          pinHash: guardarPin(pin),
          expiresAt: expira,
          createdByName: quem?.name ?? null,
        },
      });
      const slug = (await db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true } }))?.slug ?? "";
      return { a, slug };
    });
    return { id: criado.a.id, link: this.linkDoLeitor(criado.slug, token), pin, expiraEm: criado.a.expiresAt.toISOString() };
  }

  /** Onde o segurança abre o leitor: a consola do clube, numa rota que não pede conta. */
  private linkDoLeitor(slug: string, token: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    const raiz = base ? base.replace(/\/$/, "").replace("{slug}", slug) : `https://${slug}.academias.pt`;
    return `${raiz}/consola/porta/${token}`;
  }

  async revogar(ctx: RequestContext, id: string) {
    await this.escrever(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.ticketGateAccess.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } }));
    return { ok: true as const };
  }

  /* ------------------------------------------------------------------------ */
  /* O segurança: entrar e ler                                                  */
  /* ------------------------------------------------------------------------ */

  private assinarSessao(accessId: string, ate: number): string {
    const corpo = `${accessId}.${ate}`;
    return `${corpo}.${createHmac("sha256", this.emissao.segredo()).update(`porta-sessao:${corpo}`).digest("base64url")}`;
  }

  private lerSessao(sessao: string): string {
    const partes = sessao.split(".");
    if (partes.length !== 3) throw new UnauthorizedException("Sessão inválida. Abre o link outra vez.");
    const [id, ate, sig] = partes;
    const certa = Buffer.from(createHmac("sha256", this.emissao.segredo()).update(`porta-sessao:${id}.${ate}`).digest("base64url"));
    const dada = Buffer.from(sig);
    if (certa.length !== dada.length || !timingSafeEqual(certa, dada) || !(Number(ate) > Date.now())) {
      throw new UnauthorizedException("A sessão acabou. Abre o link outra vez e escreve o PIN.");
    }
    return id;
  }

  private async clube(slug: string): Promise<string> {
    const academyId = await this.auth.academyIdBySlug(slug.slice(0, 80));
    if (!academyId) throw new NotFoundException();
    return academyId;
  }

  /** O acesso de uma sessão, se ainda valer. */
  private async acessoVivo(db: ScopedClient, accessId: string) {
    const a = await db.ticketGateAccess.findFirst({ where: { id: accessId } });
    if (!a || a.revokedAt || a.expiresAt <= new Date()) throw new UnauthorizedException("Este acesso já não vale. Pede outro ao clube.");
    return a;
  }

  /** `POST /api/clubes/:slug/porta/entrar`: o link e o PIN dão uma sessão. */
  async entrar(slug: string, dto: EntrarNaPortaDto) {
    const academyId = await this.clube(slug);
    const r = await this.prisma.runAs(academyId, async (db) => {
      const a = await db.ticketGateAccess.findFirst({ where: { tokenHash: resumoDoToken(dto.token) } });
      if (!a || a.revokedAt || a.expiresAt <= new Date()) return { erro: "Este link já não vale. Pede outro ao clube." } as const;
      const BLOQUEADO = "Demasiados PINs errados. Espera 15 minutos ou pede outro link ao clube.";
      /*
       * A tentativa conta-se **antes** de ver o PIN, numa escrita só. Lida e
       * escrita em dois passos, vinte pedidos em paralelo liam todos "0
       * erradas" e tinham vinte palpites em vez de cinco. Um bloqueio que já
       * passou recomeça a contagem.
       */
      const contada = await db.$queryRaw<{ n: number }[]>`
        UPDATE "TicketGateAccess"
           SET "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedAttempts" + 1 END,
               "lockedUntil" = NULL
         WHERE id = ${a.id} AND ("lockedUntil" IS NULL OR "lockedUntil" <= now())
         RETURNING "failedAttempts" AS n`;
      if (contada.length === 0) return { erro: BLOQUEADO } as const;
      const tentativa = Number(contada[0].n);
      const certo = tentativa <= PIN_TENTATIVAS && pinCerto(dto.pin, a.pinHash);
      if (!certo) {
        if (tentativa >= PIN_TENTATIVAS) {
          await db.ticketGateAccess.update({ where: { id: a.id }, data: { lockedUntil: new Date(Date.now() + PIN_BLOQUEIO_MIN * 60_000) } });
          return { erro: BLOQUEADO } as const;
        }
        return { erro: "PIN errado." } as const;
      }
      await db.ticketGateAccess.update({ where: { id: a.id }, data: { failedAttempts: 0, lockedUntil: null } });
      return { a, ...(await this.estadoDoAcesso(db, academyId, a)) };
    });
    if ("erro" in r) throw new UnauthorizedException(r.erro);
    const ate = Math.min(r.a.expiresAt.getTime(), Date.now() + SESSAO_HORAS * 60 * 60_000);
    return { sessao: this.assinarSessao(r.a.id, ate), jogo: r.jogo, porta: r.porta, entradas: r.entradas };
  }

  async estado(slug: string, sessao: string) {
    const academyId = await this.clube(slug);
    const accessId = this.lerSessao(sessao);
    if (!this.dentroDoRitmo(`e:${accessId}`, ESTADOS_POR_MINUTO)) throw new BadRequestException("Demasiados pedidos. Espera um momento.");
    return this.prisma.runAs(academyId, async (db) => this.estadoDoAcesso(db, academyId, await this.acessoVivo(db, accessId)));
  }

  private async estadoDoAcesso(db: ScopedClient, academyId: string, a: { matchId: string; gateId: string; label: string }) {
    const [jogo, recinto, entradas] = await Promise.all([
      db.match.findFirst({ where: { id: a.matchId }, select: { startsAt: true, opponent: true, isHome: true, team: { select: { name: true } } } }),
      this.recintoDoJogo(db, academyId, a.matchId),
      db.ticketScan.count({ where: { matchId: a.matchId, gateId: a.gateId, result: "OK" } }),
    ]);
    const bancadas =
      a.gateId === TODAS_AS_PORTAS
        ? (recinto?.bancadas.map((b) => b.nome) ?? [])
        : (recinto?.portas.find((p) => p.id === a.gateId)?.bancadaIds.map((id) => recinto.bancadas.find((b) => b.id === id)?.nome ?? id) ?? []);
    return {
      jogo: jogo ? { startsAt: jogo.startsAt.toISOString(), nome: jogo.isHome ? `${jogo.team.name} vs ${jogo.opponent}` : `${jogo.opponent} vs ${jogo.team.name}` } : null,
      porta: { nome: a.label, bancadas },
      entradas,
    };
  }

  /** `POST /api/clubes/:slug/porta/ler`: um código lido. */
  async ler(slug: string, dto: LerDto) {
    const academyId = await this.clube(slug);
    const accessId = this.lerSessao(dto.sessao);
    if (!this.dentroDoRitmo(`l:${accessId}`, LEITURAS_POR_MINUTO)) throw new BadRequestException("Demasiadas leituras seguidas. Espera um momento.");
    const lido = lerCodigo(this.emissao.segredo(), dto.codigo);

    return this.prisma.runAs(academyId, async (db) => {
      const a = await this.acessoVivo(db, accessId);
      const recinto = await this.recintoDoJogo(db, academyId, a.matchId);
      const porta = a.gateId === TODAS_AS_PORTAS ? TODAS_AS_PORTAS : (recinto?.portas.find((p) => p.id === a.gateId) ?? { id: a.gateId, bancadaIds: [] });
      const nomeDaBancada = (id: string) => recinto?.bancadas.find((b) => b.id === id)?.nome ?? null;
      const portaCerta = (bancadaId: string) => recinto?.portas.find((p) => p.bancadaIds.includes(bancadaId))?.nome ?? null;

      const registar = async (resultado: Resultado, ids: { ticketId?: string; seasonSeatId?: string }) => {
        await db.ticketScan.create({ data: { academyId, matchId: a.matchId, gateId: a.gateId, accessId: a.id, result: resultado, ...ids } });
      };

      if (!lido) {
        await registar("INVALID", {});
        return this.resposta("INVALID", null);
      }

      if (lido.tipo === "T") {
        const t = await db.matchTicket.findFirst({ where: { id: lido.id }, include: { order: { select: { status: true } } } });
        const bilhete = t ? { matchId: t.matchId, bancadaId: t.bancadaId, status: t.order.status === "PAID" ? t.status : "VOID" } : null;
        let resultado = decidirEntrada({ tipo: "T", bilhete, jogoId: a.matchId, porta });
        if (resultado === "OK" && t) {
          // Só um segurança marca o bilhete: o segundo não altera linha nenhuma.
          const marcado = await db.matchTicket.updateMany({ where: { id: t.id, status: "VALID" }, data: { status: "USED", usedAt: new Date(), usedGateId: a.gateId } });
          if (marcado.count === 0) resultado = "ALREADY_USED";
        }
        await registar(resultado, t ? { ticketId: t.id } : {});
        return this.resposta(
          resultado,
          t
            ? {
                tipo: t.typeName,
                bancada: nomeDaBancada(t.bancadaId),
                portaCerta: portaCerta(t.bancadaId),
                // Em "já entrou", quando e por onde: um segundo pedido depois de uma resposta perdida lê-se como o que é.
                usadoEm: t.usedAt?.toISOString() ?? null,
                usadoNa: t.usedGateId && t.usedGateId !== TODAS_AS_PORTAS ? this.nomeDaPorta(recinto, t.usedGateId) : null,
              }
            : null,
        );
      }

      const lugar = await db.seasonSeat.findFirst({ where: { id: lido.id } });
      const jogo = await db.match.findFirst({ where: { id: a.matchId }, select: { startsAt: true, team: { select: { seasonId: true } } } });
      const venda = await db.siteMatchTickets.findUnique({ where: { matchId: a.matchId }, select: { venueId: true } });
      const jaEntrou = lugar ? (await db.ticketScan.count({ where: { matchId: a.matchId, seasonSeatId: lugar.id, result: "OK" } })) > 0 : false;
      const quotaEmDia = lugar && jogo ? await quotaDoSocioCobre(db, academyId, lugar.memberId, jogo.startsAt) : false;
      let resultado = decidirEntrada({
        tipo: "S",
        lugar,
        jogo: { seasonId: jogo?.team.seasonId ?? null, venueId: venda?.venueId ?? null },
        jaEntrouNesteJogo: jaEntrou,
        quotaEmDia,
        porta,
      });
      if (resultado === "OK" && lugar) {
        /*
         * A entrada aceite grava-se com `ON CONFLICT DO NOTHING` contra o índice
         * único das entradas anuais: se outro segurança a gravou no mesmo
         * instante, não entra linha nenhuma, e este lê "já entrou". Um erro de
         * chave aqui abortava a transação inteira.
         */
        const entrou = await db.$executeRaw`
          INSERT INTO "TicketScan" ("id", "academyId", "matchId", "gateId", "accessId", "seasonSeatId", "result")
          VALUES (${randomUUID()}, ${academyId}, ${a.matchId}, ${a.gateId}, ${a.id}, ${lugar.id}, 'OK')
          ON CONFLICT ("matchId", "seasonSeatId") WHERE "result" = 'OK' AND "seasonSeatId" IS NOT NULL DO NOTHING
        `;
        if (entrou === 0) {
          resultado = "ALREADY_USED";
          await registar("ALREADY_USED", { seasonSeatId: lugar.id });
        }
      } else {
        await registar(resultado, lugar ? { seasonSeatId: lugar.id } : {});
      }
      return this.resposta(resultado, lugar ? { tipo: "Lugar anual", bancada: nomeDaBancada(lugar.bancadaId), lugar: lugar.seat, portaCerta: portaCerta(lugar.bancadaId) } : null);
    });
  }

  private resposta(
    resultado: Resultado,
    d: { tipo: string; bancada: string | null; lugar?: string | null; portaCerta: string | null; usadoEm?: string | null; usadoNa?: string | null } | null,
  ) {
    const MENSAGENS: Record<Resultado, string> = {
      OK: "Pode entrar.",
      ALREADY_USED: d?.usadoEm ? `Este bilhete já entrou às ${horaNoFuso(new Date(d.usadoEm))}${d.usadoNa ? `, pela ${d.usadoNa}` : ""}.` : "Este bilhete já entrou.",
      WRONG_GATE: d?.portaCerta ? `Esta não é a porta. Entra pela ${d.portaCerta}.` : "Esta não é a porta deste bilhete.",
      WRONG_MATCH: "Este bilhete não é deste jogo.",
      VOID: "Este bilhete foi anulado ou não está pago.",
      INVALID: "Código inválido. Não é um bilhete deste clube.",
      QUOTA_EM_ATRASO: "Quota em atraso. O sócio tem de passar pela secretaria.",
    };
    return { resultado, ok: resultado === "OK", mensagem: MENSAGENS[resultado], bilhete: d ? { tipo: d.tipo, bancada: d.bancada, lugar: d.lugar ?? null } : null };
  }
}
