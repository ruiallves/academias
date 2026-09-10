import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  LegalAcceptanceContext,
  LegalAudience,
  LegalDocument,
  LegalDocumentType,
  Role,
} from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { SupabaseJwtService } from "../auth/supabase-jwt.service";
import { can, type RequestContext } from "../common/permissions";
import { LEGAL_TYPES, typeFromSlug } from "./legal.catalog";

/**
 * Documentos legais: o que está em vigor, quem tem de aceitar o quê, e o registo
 * de quem aceitou.
 *
 * ## Três perguntas, uma resposta cada
 *
 *  1. **O que está em vigor?** — `current()`. A versão `PUBLISHED` de cada tipo
 *     com o `effectiveAt` mais recente que já passou. Derivada, com cache de um
 *     minuto: é lida em todos os pedidos autenticados (pelo guard) e os
 *     documentos mudam meia dúzia de vezes por ano.
 *  2. **O que falta a esta pessoa, neste clube?** — `statusFor()`. Cruza as
 *     audiências da pessoa com as de cada documento em vigor e vê o que já foi
 *     aceite — pela pessoa (âmbito `USER`) ou pelo clube (âmbito `CLUB`).
 *  3. **Registar uma aceitação** — `accept()`. Valida tudo outra vez no servidor:
 *     a versão está em vigor, a audiência aplica-se, quem vincula o clube pode
 *     vinculá-lo e disse que pode. O browser nunca marca nada como aceite.
 *
 * ## Quem é quem (`audiencesOf`)
 *
 * A audiência não é um papel novo — deriva do que já existe. `legal:club` é uma
 * permissão como as outras (dados, não `if role ===`), e o vínculo de família ou
 * de sócio é o que a app do clube já usa para escolher contexto.
 *
 * ## O gate no servidor
 *
 * `assertClear()` é chamado pelo `AuthGuard` em todos os pedidos autenticados
 * de academia. Com cache curta por pessoa e clube, e sem custo nenhum enquanto
 * não houver documento em vigor que se aplique a alguém. Ver `auth.guard.ts`.
 */

export type LegalSubject = {
  userId: string;
  academyId: string;
  /** A membership com que se está a entrar, quando há uma. */
  membershipId: string | null;
  audiences: LegalAudience[];
};

export type LegalDocumentView = {
  id: string;
  type: LegalDocumentType;
  slug: string;
  title: string;
  summary: string | null;
  version: string;
  scope: LegalDocument["scope"];
  acceptanceKind: LegalDocument["acceptanceKind"];
  audiences: LegalAudience[];
  effectiveAt: Date;
  changeNote: string | null;
};

export type PendingDocument = LegalDocumentView & {
  /** A versão que esta pessoa (ou o clube) tinha aceite antes, se alguma. */
  previousVersion: string | null;
};

export type LegalStatus = {
  audiences: LegalAudience[];
  /** Tem `legal:club` — pode vincular o clube. */
  canBindClub: boolean;
  /**
   * Pedir a confirmação "estou autorizado a representar o clube"?
   *
   * **Uma vez por clube**, a quem o inaugura: a primeira pessoa que vincula o
   * clube a um documento contratual. A partir daí ninguém mais é interrogado
   * sobre poderes — nem essa pessoa numa actualização dos termos, nem um
   * segundo responsável que entre depois. O clube já está representado, e a
   * resposta ficou registada com data, IP e nome de quem a deu.
   */
  needsAuthority: boolean;
  pending: PendingDocument[];
  /** Os documentos em vigor que se aplicam a esta pessoa e já estão em dia. */
  accepted: (LegalDocumentView & { acceptedAt: Date })[];
  /** `true` quando alguma das pendentes é actualização de uma versão já aceite. */
  isUpdate: boolean;
};

/** Uma versão sem o texto — o que se lê em todos os pedidos. */
export type LegalDocMeta = Omit<LegalDocument, "content">;

type AcceptanceRow = {
  documentId: string;
  documentType: LegalDocumentType;
  documentVersion: string;
  userId: string;
  academyId: string | null;
  onBehalfOfClub: boolean;
  acceptedAt: Date;
};

const CURRENT_TTL_MS = 60_000;
const CLEAR_TTL_MS = 60_000;

export const LEGAL_REQUIRED_CODE = "LEGAL_ACCEPTANCE_REQUIRED";

@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jwt: SupabaseJwtService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* O que está em vigor                                                       */
  /* ------------------------------------------------------------------------ */

  private currentCache: { until: number; docs: LegalDocMeta[] } | null = null;
  private currentInflight: Promise<LegalDocMeta[]> | null = null;

  /**
   * A versão em vigor de cada tipo — uma linha por tipo, sem o texto.
   *
   * A RLS de `LegalDocument` só deixa o papel das academias ver o que está
   * publicado, por isso isto lê pela ligação normal, fora de `runAs`.
   */
  async current(): Promise<LegalDocMeta[]> {
    const agora = Date.now();
    if (this.currentCache && this.currentCache.until > agora) return this.currentCache.docs;
    if (this.currentInflight) return this.currentInflight;

    this.currentInflight = (async () => {
      const rows = await this.prisma.legalDocument.findMany({
        where: { status: "PUBLISHED", effectiveAt: { lte: new Date() } },
        orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }],
        select: SELECT_META,
      });
      const porTipo = new Map<LegalDocumentType, LegalDocMeta>();
      for (const row of rows) if (!porTipo.has(row.type)) porTipo.set(row.type, row);
      const docs = [...porTipo.values()].sort((a, b) => LEGAL_TYPES[a.type].order - LEGAL_TYPES[b.type].order);
      this.currentCache = { until: Date.now() + CURRENT_TTL_MS, docs };
      return docs;
    })().finally(() => {
      this.currentInflight = null;
    });
    return this.currentInflight;
  }

  /** A plataforma publicou ou retirou uma versão: esquece-se tudo. */
  invalidate(): void {
    this.currentCache = null;
    this.clearCache.clear();
  }

  /** A versão em vigor de um tipo, com o texto — para o site e para o gate. */
  async currentOf(slug: string): Promise<LegalDocument | null> {
    const type = typeFromSlug(slug);
    if (!type) return null;
    return this.prisma.legalDocument.findFirst({
      where: { type, status: "PUBLISHED", effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }],
    });
  }

  /** Uma versão concreta, publicada ou retirada — o que uma aceitação antiga aponta. */
  async versionOf(slug: string, version: string): Promise<LegalDocument | null> {
    const type = typeFromSlug(slug);
    if (!type) return null;
    return this.prisma.legalDocument.findFirst({ where: { type, version } });
  }

  /** As versões que já valeram de um tipo, sem texto, da mais recente para a mais antiga. */
  async versionsOf(slug: string) {
    const type = typeFromSlug(slug);
    if (!type) return [];
    return this.prisma.legalDocument.findMany({
      where: { type, status: "PUBLISHED" },
      orderBy: [{ effectiveAt: "desc" }],
      select: SELECT_META,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Quem é quem                                                               */
  /* ------------------------------------------------------------------------ */

  /**
   * As audiências de um pedido já autenticado pelo guard.
   *
   * Sem idas à base: o contexto já traz o papel e as permissões. O vínculo de
   * sócio não entra aqui de propósito — as rotas de sócio não passam pelo guard,
   * e verificam-se em `assertClearMember`.
   */
  audiencesOfContext(ctx: RequestContext): LegalAudience[] {
    if (isFamily(ctx.role)) return ["FAMILY"];
    // Quem representa o clube é `CLUB_OWNER` e **não** `STAFF`: os Termos de
    // Serviço, que aceita pelo clube, cobrem também a utilização que ele próprio
    // faz. Pedir-lhe os Termos de Utilização por cima era o mesmo contrato duas vezes.
    return can(ctx, "legal:club") ? ["CLUB_OWNER"] : ["STAFF"];
  }

  /**
   * A identidade de um pedido às rotas `/api/legal/*`, que são `@Public()`.
   *
   * Público porque a autenticação é outra: um sócio sem membership nenhuma tem
   * de conseguir aceitar os termos, e o guard global exige uma `Membership`.
   * Verifica-se o JWT e resolve-se o `User` pela escotilha, como na app do clube.
   */
  async subjectFor(authorization: string | undefined, slug: string): Promise<LegalSubject & { canBindClub: boolean }> {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new UnauthorizedException("Falta o token de sessão");
    const user = await this.jwt.verify(token);

    const [academyId, memberships, userRows] = await Promise.all([
      this.auth.academyIdBySlug(slug),
      this.auth.membershipsOf(user.authId),
      this.prisma.$queryRaw<{ id: string | null }[]>`SELECT app.resolve_user_by_auth(${user.authId}) AS id`,
    ]);
    if (!academyId) throw new NotFoundException(`Academia "${slug}" não encontrada`);
    const userId = userRows[0]?.id ?? null;
    if (!userId) throw new ForbiddenException("Esta conta ainda não existe na plataforma.");

    const daAcademia = memberships.filter((m) => m.academy_id === academyId);
    const staff = daAcademia.find((m) => !isFamily(m.role));
    const familia = daAcademia.find((m) => isFamily(m.role));

    const audiences: LegalAudience[] = [];
    let canBindClub = false;
    if (staff) {
      // Só com vínculo de pessoal é que as permissões interessam — e é aqui que
      // se paga o `contextFor`, não em todos os pedidos.
      const ctx = await this.auth.contextFor(user.authId, slug, "console");
      canBindClub = can(ctx, "legal:club");
      audiences.push(canBindClub ? "CLUB_OWNER" : "STAFF");
    }
    if (familia) audiences.push("FAMILY");

    const socio = await this.prisma.runAs(academyId, (db) =>
      db.member.findFirst({ where: { userId }, select: { id: true } }),
    );
    if (socio) audiences.push("MEMBER");

    if (audiences.length === 0) throw new ForbiddenException("Sem acesso a esta academia");

    return {
      userId,
      academyId,
      membershipId: staff?.membership_id ?? familia?.membership_id ?? null,
      audiences,
      canBindClub,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* O que falta                                                               */
  /* ------------------------------------------------------------------------ */

  async statusFor(subject: LegalSubject, db?: ScopedClient): Promise<LegalStatus> {
    const docs = (await this.current()).filter((d) => appliesTo(d, subject.audiences));
    const canBindClub = subject.audiences.includes("CLUB_OWNER");
    if (docs.length === 0) {
      return { audiences: subject.audiences, canBindClub, needsAuthority: false, pending: [], accepted: [], isUpdate: false };
    }

    // Dentro da transação de quem chamou, quando já há uma (a área de sócio);
    // senão abre-se uma. O `app.user_id` é LOCAL e morre com ela nos dois casos.
    const ler = async (tx: ScopedClient) => {
      await setUser(tx, subject.userId);
      return tx.legalAcceptance.findMany({
        where: {
          OR: [
            {
              documentType: { in: docs.map((d) => d.type) },
              OR: [{ userId: subject.userId }, { academyId: subject.academyId, onBehalfOfClub: true }],
            },
            // Qualquer coisa que **alguém** já tenha aceite em nome deste clube:
            // é o que diz se o clube já foi inaugurado, e a confirmação de
            // poderes pede-se uma vez só, a quem o inaugura.
            { academyId: subject.academyId, onBehalfOfClub: true },
          ],
        },
        orderBy: { acceptedAt: "desc" },
        select: {
          documentId: true, documentType: true, documentVersion: true, userId: true,
          academyId: true, onBehalfOfClub: true, acceptedAt: true,
        },
      });
    };
    const rows = db ? await ler(db) : await this.prisma.runAs(subject.academyId, ler);
    const clubeInaugurado = rows.some((r) => r.onBehalfOfClub && r.academyId === subject.academyId);

    const pending: PendingDocument[] = [];
    const accepted: LegalStatus["accepted"] = [];
    for (const doc of docs) {
      const feita = rows.find((r) => r.documentId === doc.id && satisfies(r, doc, subject));
      if (feita) {
        accepted.push({ ...view(doc), acceptedAt: feita.acceptedAt });
        continue;
      }
      const anterior = rows.find((r) => r.documentType === doc.type && satisfies(r, doc, subject));
      pending.push({ ...view(doc), previousVersion: anterior?.documentVersion ?? null });
    }

    // Os que vinculam o clube primeiro: são a razão da caixa de autoridade, que
    // abre a lista, e é assim que a pessoa os lê logo a seguir a ela.
    pending.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "CLUB" ? -1 : 1));

    return {
      audiences: subject.audiences,
      canBindClub,
      needsAuthority: pending.some((p) => p.scope === "CLUB") && !clubeInaugurado,
      pending,
      accepted,
      isUpdate: pending.some((p) => p.previousVersion !== null),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* O gate — a verificação que corre em todos os pedidos                      */
  /* ------------------------------------------------------------------------ */

  private clearCache = new Map<string, number>();

  /**
   * Recusa o pedido se houver aceitações obrigatórias por fazer.
   *
   * Barato de propósito: sem documento em vigor que se aplique a esta
   * audiência, não há ida à base nenhuma. Com, a resposta fica em cache um
   * minuto — e `accept()` limpa-a, por isso quem aceita entra logo.
   */
  async assertClear(subject: LegalSubject, db?: ScopedClient): Promise<void> {
    const docs = (await this.current()).filter((d) => appliesTo(d, subject.audiences));
    if (docs.length === 0) return;

    const key = `${subject.userId}|${subject.academyId}|${subject.audiences.join(",")}`;
    const ate = this.clearCache.get(key);
    if (ate && ate > Date.now()) return;

    const status = await this.statusFor(subject, db);
    if (status.pending.length > 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: LEGAL_REQUIRED_CODE,
        message: "Há documentos legais por aceitar. Recarrega a página para os rever.",
        pending: status.pending.map((p) => p.type),
      });
    }
    this.clearCache.set(key, Date.now() + CLEAR_TTL_MS);
  }

  /** O mesmo, a partir do contexto que o guard já construiu. */
  assertClearContext(ctx: RequestContext): Promise<void> {
    return this.assertClear({
      userId: ctx.userId,
      academyId: ctx.academyId,
      membershipId: ctx.membershipId,
      audiences: this.audiencesOfContext(ctx),
    });
  }

  /** As rotas de sócio, que não passam pelo guard — já dentro da transação delas. */
  assertClearMember(db: ScopedClient, userId: string, academyId: string): Promise<void> {
    return this.assertClear({ userId, academyId, membershipId: null, audiences: ["MEMBER"] }, db);
  }

  private forget(userId: string): void {
    for (const key of this.clearCache.keys()) if (key.startsWith(userId + "|")) this.clearCache.delete(key);
  }

  /* ------------------------------------------------------------------------ */
  /* Aceitar                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Regista aceitações.
   *
   * Tudo é validado aqui, contra a base, e não contra o que o cliente diz:
   *
   *  - o documento existe e é **a versão em vigor** do seu tipo (aceitar uma
   *    versão antiga não conta, aceitar um rascunho é impossível);
   *  - a audiência do documento inclui esta pessoa;
   *  - um documento de âmbito `CLUB` exige `legal:club` **e** a confirmação
   *    explícita de que a pessoa pode representar o clube;
   *  - o que já estava aceite não se regista duas vezes (idempotente — o
   *    utilizador que carrega duas vezes não cria duas provas).
   *
   * O contexto (`SIGNUP`, `LOGIN_GATE`, `TERMS_UPDATE`) é decidido aqui e não
   * pelo cliente: `TERMS_UPDATE` se já havia uma versão aceite deste tipo,
   * `SIGNUP` se a conta tem menos de um dia, `LOGIN_GATE` no resto. `SETTINGS`
   * é o único que o cliente pode pedir, porque só ele sabe de onde veio.
   */
  async accept(
    subject: LegalSubject,
    body: { documentIds: string[]; confirmAuthority?: boolean; context?: string },
    meta: { ip?: string; userAgent?: string },
  ): Promise<LegalStatus> {
    const ids = [...new Set((body.documentIds ?? []).filter((x) => typeof x === "string" && x.length > 0))];
    if (ids.length === 0) throw new BadRequestException("Nada para aceitar.");

    const current = await this.current();
    const escolhidos = ids.map((id) => {
      const doc = current.find((d) => d.id === id);
      if (!doc) throw new BadRequestException("Um dos documentos não é a versão em vigor.");
      if (doc.acceptanceKind === "NONE") throw new BadRequestException(`"${doc.title}" não se aceita — só se publica.`);
      if (!appliesTo(doc, subject.audiences)) {
        throw new ForbiddenException(`"${doc.title}" não se aplica a esta conta.`);
      }
      // A confirmação de poderes verifica-se abaixo, dentro da transação: só é
      // exigida a quem ainda não representou este clube.
      if (doc.scope === "CLUB" && !subject.audiences.includes("CLUB_OWNER")) {
        throw new ForbiddenException(`Só quem representa o clube pode aceitar "${doc.title}" em nome dele.`);
      }
      return doc;
    });

    const contextoPedido = body.context === "SETTINGS" ? "SETTINGS" : null;

    await this.prisma.runAs(subject.academyId, async (db) => {
      await setUser(db, subject.userId);

      const [existentes, conta] = await Promise.all([
        db.legalAcceptance.findMany({
          where: {
            OR: [
              {
                documentType: { in: escolhidos.map((d) => d.type) },
                OR: [{ userId: subject.userId }, { academyId: subject.academyId, onBehalfOfClub: true }],
              },
              { academyId: subject.academyId, onBehalfOfClub: true },
            ],
          },
          select: {
            documentId: true, documentType: true, documentVersion: true, userId: true,
            academyId: true, onBehalfOfClub: true, acceptedAt: true,
          },
        }),
        db.user.findFirst({ where: { id: subject.userId }, select: { createdAt: true } }),
      ]);

      const novaConta = conta ? Date.now() - conta.createdAt.getTime() < 24 * 3600_000 : false;

      /*
       * A confirmação de poderes é uma vez por clube, a quem o inaugura.
       *
       * Feita a primeira vez, ninguém mais responde à pergunta — nem a mesma
       * pessoa numa actualização dos termos, nem um segundo responsável que
       * entre depois. A resposta está registada, com data, IP e nome.
       */
      const clubeInaugurado = existentes.some((r) => r.onBehalfOfClub && r.academyId === subject.academyId);
      if (!clubeInaugurado && escolhidos.some((d) => d.scope === "CLUB") && body.confirmAuthority !== true) {
        throw new BadRequestException("Confirma que estás autorizado a representar o clube.");
      }

      for (const doc of escolhidos) {
        if (existentes.some((r) => r.documentId === doc.id && satisfies(r, doc, subject))) continue;
        const anterior = existentes.some((r) => r.documentType === doc.type && satisfies(r, doc, subject));
        const context: LegalAcceptanceContext =
          contextoPedido ?? (anterior ? "TERMS_UPDATE" : novaConta ? "SIGNUP" : "LOGIN_GATE");

        try {
          await db.legalAcceptance.create({
            data: {
              userId: subject.userId,
              academyId: subject.academyId,
              membershipId: subject.membershipId,
              documentId: doc.id,
              documentType: doc.type,
              documentVersion: doc.version,
              contentHash: doc.contentHash,
              scope: doc.scope,
              onBehalfOfClub: doc.scope === "CLUB",
              context,
              ip: meta.ip ?? null,
              userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
            },
          });
        } catch (e) {
          /*
           * A versão desapareceu da base entre a leitura e a escrita.
           *
           * Não acontece pelo produto — retirar não apaga, e um rascunho nunca
           * está em vigor —, mas acontece a quem mexa na base à mão, e a cache
           * de um minuto segura o id morto até expirar. Um 500 aqui não diz
           * nada a ninguém; isto esquece a cache e pede para recarregar.
           */
          if (chaveEstrangeira(e)) {
            this.invalidate();
            throw new ConflictException("A versão deste documento mudou. Recarrega a página para veres a actual.");
          }
          throw e;
        }
      }
    });

    this.forget(subject.userId);
    return this.statusFor(subject);
  }

  /* ------------------------------------------------------------------------ */
  /* A criação de conta                                                        */
  /* ------------------------------------------------------------------------ */

  /**
   * O que uma audiência tem de aceitar — para as páginas de criação de conta,
   * onde ainda não há sessão nem pessoa. O convite de staff, o registo de
   * família e o convite de sócio mostram estes documentos ao lado da password:
   * quem cria a conta aceita-os ao criá-la, e não vê o gate à primeira entrada.
   */
  async requiredFor(audiences: LegalAudience[]): Promise<(LegalDocumentView & { url: string })[]> {
    const docs = (await this.current()).filter((d) => appliesTo(d, audiences));
    return docs.map((d) => ({ ...view(d), url: publicUrl(d.type) }));
  }

  /**
   * A confirmação que a criação de conta exige — verificada **antes** de criar
   * seja o que for (a conta no Supabase não participa em rollback nenhum).
   *
   * Sem documentos em vigor para esta audiência não exige nada: um clube que
   * ainda não publicou termos não trava as suas inscrições.
   */
  async assertSignupConsent(
    audiences: LegalAudience[],
    body: { acceptLegal?: boolean; confirmAuthority?: boolean },
    academyId: string,
  ): Promise<LegalDocMeta[]> {
    const docs = (await this.current()).filter((d) => appliesTo(d, audiences));
    if (docs.length === 0) return docs;
    if (body.acceptLegal !== true) throw new BadRequestException("Tens de aceitar os documentos legais para criar a conta.");
    if (docs.some((d) => d.scope === "CLUB") && !(await this.clubAlreadyBound(academyId)) && body.confirmAuthority !== true) {
      throw new BadRequestException("Confirma que estás autorizado a representar o clube.");
    }
    return docs;
  }

  /**
   * O clube já foi inaugurado — alguém já o vinculou a um documento contratual.
   *
   * É o que decide se a confirmação de poderes ainda se pede — e é uma pergunta
   * do clube, não da pessoa, por isso corre em `runAs` e não precisa de sessão:
   * a política de `LegalAcceptance` deixa ver as linhas do clube corrente, que
   * é exactamente o que aqui se conta. Devolve um booleano e mais nada.
   */
  async clubAlreadyBound(academyId: string): Promise<boolean> {
    const n = await this.prisma.runAs(academyId, (db) =>
      db.legalAcceptance.count({ where: { academyId, onBehalfOfClub: true } }),
    );
    return n > 0;
  }

  /**
   * Regista as aceitações da criação de conta — já dentro da transação que
   * criou o `User` e a `Membership`, com contexto `SIGNUP`. Idempotente: quem
   * já tinha conta e volta a entrar por convite não duplica a prova.
   */
  async acceptAtSignup(
    db: ScopedClient,
    subject: LegalSubject,
    docs: LegalDocMeta[],
    meta: { ip?: string; userAgent?: string },
  ): Promise<void> {
    if (docs.length === 0) return;
    await setUser(db, subject.userId);
    const existentes = await db.legalAcceptance.findMany({
      where: {
        documentId: { in: docs.map((d) => d.id) },
        OR: [{ userId: subject.userId }, { academyId: subject.academyId, onBehalfOfClub: true }],
      },
      select: {
        documentId: true, documentType: true, documentVersion: true, userId: true,
        academyId: true, onBehalfOfClub: true, acceptedAt: true,
      },
    });
    for (const doc of docs) {
      if (existentes.some((r) => r.documentId === doc.id && satisfies(r, doc, subject))) continue;
      try {
        await db.legalAcceptance.create({
          data: {
            userId: subject.userId,
            academyId: subject.academyId,
            membershipId: subject.membershipId,
            documentId: doc.id,
            documentType: doc.type,
            documentVersion: doc.version,
            contentHash: doc.contentHash,
            scope: doc.scope,
            onBehalfOfClub: doc.scope === "CLUB",
            context: "SIGNUP",
            ip: meta.ip ?? null,
            userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
          },
        });
      } catch (e) {
        /*
         * Aqui não se deita a criação da conta abaixo.
         *
         * Esta escrita corre dentro da transação que cria o `User` e a
         * `Membership`: rebentar aqui deixava a pessoa sem conta por causa do
         * registo de uma aceitação. Se a versão desapareceu entretanto,
         * esquece-se a cache e segue-se — e o gate à primeira entrada pede o
         * que faltar, que é exactamente para isso que existe.
         */
        if (!chaveEstrangeira(e)) throw e;
        this.invalidate();
      }
    }
    this.forget(subject.userId);
  }

  /* ------------------------------------------------------------------------ */
  /* Histórico                                                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * O que esta pessoa aceitou — e, se representa o clube, o que o clube aceitou.
   *
   * É a resposta à pergunta "o utilizador X aceitou a v1.0 em Setembro e a v2.0
   * em Novembro". Nunca se apaga nada, por isso está tudo aqui.
   */
  async history(subject: LegalSubject) {
    const rows = await this.prisma.runAs(subject.academyId, async (db) => {
      await setUser(db, subject.userId);
      return db.legalAcceptance.findMany({
        where: subject.audiences.includes("CLUB_OWNER")
          ? { OR: [{ userId: subject.userId }, { academyId: subject.academyId, onBehalfOfClub: true }] }
          : { userId: subject.userId },
        orderBy: { acceptedAt: "desc" },
        take: 200,
        select: {
          id: true, documentType: true, documentVersion: true, scope: true, onBehalfOfClub: true,
          context: true, acceptedAt: true, userId: true,
          user: { select: { name: true } },
          document: { select: { title: true } },
        },
      });
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.documentType,
      slug: LEGAL_TYPES[r.documentType].slug,
      title: r.document.title,
      version: r.documentVersion,
      scope: r.scope,
      onBehalfOfClub: r.onBehalfOfClub,
      context: r.context,
      acceptedAt: r.acceptedAt,
      mine: r.userId === subject.userId,
      by: r.user.name,
    }));
  }
}

/* -------------------------------------------------------------------------- */

const SELECT_META = {
  id: true, type: true, version: true, title: true, summary: true, contentHash: true,
  status: true, scope: true, audiences: true, acceptanceKind: true, effectiveAt: true,
  publishedAt: true, retiredAt: true, createdById: true, publishedById: true, changeNote: true,
  createdAt: true, updatedAt: true,
  // O texto fica de fora de propósito: isto é lido em todos os pedidos.
} as const;

/** O `documentId` já não existe — a versão foi apagada da base. */
function chaveEstrangeira(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2003";
}

function isFamily(role: Role): boolean {
  return role === "GUARDIAN" || role === "ATHLETE";
}

function appliesTo(doc: Pick<LegalDocument, "audiences" | "acceptanceKind">, audiences: LegalAudience[]): boolean {
  if (doc.acceptanceKind === "NONE") return false;
  return doc.audiences.some((a) => audiences.includes(a));
}

/** Esta linha satisfaz este documento para este sujeito? Depende do âmbito. */
function satisfies(row: AcceptanceRow, doc: Pick<LegalDocument, "scope">, subject: LegalSubject): boolean {
  if (doc.scope === "CLUB") return row.onBehalfOfClub && row.academyId === subject.academyId;
  return row.userId === subject.userId;
}

async function setUser(db: ScopedClient, userId: string): Promise<void> {
  // LOCAL, como o `academy_id`: morre com a transação. É o que abre a política
  // `own_or_academy` às linhas do próprio utilizador.
  await db.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
}

/**
 * Onde um documento se lê fora de qualquer app: o site.
 *
 * `SITE_ORIGIN` é a lista de origens do site (a primeira é a canónica); em
 * desenvolvimento o site corre em :5190.
 */
export function publicUrl(type: LegalDocumentType): string {
  const origem = (process.env.SITE_ORIGIN ?? "http://localhost:5190").split(",")[0].trim().replace(/[/]$/, "");
  return `${origem}/legal/${LEGAL_TYPES[type].slug}`;
}

export function view(doc: LegalDocMeta): LegalDocumentView {
  return {
    id: doc.id,
    type: doc.type,
    slug: LEGAL_TYPES[doc.type].slug,
    title: doc.title,
    summary: doc.summary,
    version: doc.version,
    scope: doc.scope,
    acceptanceKind: doc.acceptanceKind,
    audiences: doc.audiences,
    effectiveAt: doc.effectiveAt,
    changeNote: doc.changeNote,
  };
}
