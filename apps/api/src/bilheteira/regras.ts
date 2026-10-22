import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * As regras da bilheteira, sem base de dados.
 *
 * Tudo o que decide quem compra o quê, quando, e se entra, vive aqui como
 * funções puras: os serviços leem a base, chamam isto, e escrevem o que isto
 * disser. É o que deixa `npm run test:bilheteira` provar as regras sem
 * servidor nem base, e o que impede a mesma regra de ter duas versões (a do
 * site e a da app, a da compra e a do webhook).
 *
 * Decisões do Rui (21/10/2026), em `docs/08-site-do-clube.md`:
 *   - lugares guardados 10 minutos; pago depois disso, reembolso;
 *   - preço de sócio só com a quota a cobrir o mês do jogo, um por sócio;
 *   - quota em atraso não compra a preço de sócio e o lugar anual não entra;
 *   - lotação por bancada, descontados os lugares anuais;
 *   - cada porta só aceita as bancadas dela.
 */

/** Quanto tempo os lugares ficam guardados à espera do pagamento. */
export const RESERVA_MINUTOS = 10;
/** Quantos bilhetes numa compra. Acima disto é revenda. */
export const MAXIMO_POR_COMPRA = 10;

/* -------------------------------------------------------------------------- */
/* As fases da venda                                                            */
/* -------------------------------------------------------------------------- */

export type Venda = {
  open: boolean;
  membersFrom: Date | null;
  publicFrom: Date | null;
  membersOnly: boolean;
  closesAt: Date | null;
};

export type EstadoDaVenda = {
  /** Os sócios podem comprar agora. */
  socios: boolean;
  /** O público geral pode comprar agora. */
  publico: boolean;
  /** Já não abre (passou o fecho, ou o jogo foi cancelado). */
  fechada: boolean;
  /** Quando abre, para quem ainda não pode: o site diz "abre a…". */
  abreSociosEm: Date | null;
  abrePublicoEm: Date | null;
};

/**
 * Quem pode comprar agora. Fecha à hora do jogo (ou antes, se o clube
 * quiser), e nunca abre num jogo cancelado ou jogado.
 */
export function estadoDaVenda(v: Venda, jogo: { startsAt: Date; status: string }, agora = new Date()): EstadoDaVenda {
  const fecho = v.closesAt && v.closesAt < jogo.startsAt ? v.closesAt : jogo.startsAt;
  const fechada = !v.open || jogo.status !== "SCHEDULED" || agora >= fecho;
  if (fechada) return { socios: false, publico: false, fechada: true, abreSociosEm: null, abrePublicoEm: null };
  const socios = !v.membersFrom || agora >= v.membersFrom;
  const publico = !v.membersOnly && (!v.publicFrom || agora >= v.publicFrom);
  return {
    socios,
    publico,
    fechada: false,
    abreSociosEm: socios ? null : v.membersFrom,
    abrePublicoEm: publico || v.membersOnly ? null : v.publicFrom,
  };
}

/* -------------------------------------------------------------------------- */
/* Lotação                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Quantos lugares ainda se vendem numa bancada: a lotação, menos os lugares
 * anuais dos sócios, menos os bilhetes vendidos ou guardados. Nulo = a
 * bancada não tem lotação escrita (sem limite próprio; conta o do jogo).
 */
export function lugaresLivres(lotacao: number | null, anuais: number, ocupados: number): number | null {
  if (lotacao === null) return null;
  return Math.max(0, lotacao - anuais - ocupados);
}

/* -------------------------------------------------------------------------- */
/* O pedido                                                                     */
/* -------------------------------------------------------------------------- */

export type TipoParaVenda = { id: string; nome: string; precoCents: number; bancadaId: string | null; para: "publico" | "socios"; tierId: string | null };

/** Quem está a comprar. Um sócio só depois de identificado e com a quota a cobrir o jogo. */
export type Comprador =
  | { kind: "publico" }
  | { kind: "socio"; memberId: string; tierId: string | null; jaTemBilheteDeSocio: boolean };

export type LinhaDoPedido = { typeId: string; quantidade: number };

export type PedidoAceite = {
  ok: true;
  totalCents: number;
  /** Um bilhete por pessoa, já com o tipo e a bancada. */
  bilhetes: { typeId: string; typeName: string; bancadaId: string; priceCents: number; deSocio: boolean }[];
};
export type PedidoRecusado = { ok: false; erro: string };

/** Os tipos que este comprador pode escolher. */
export function tiposPara(tipos: TipoParaVenda[], quem: Comprador): TipoParaVenda[] {
  return tipos.filter((t) => {
    if (t.para === "publico") return true;
    if (quem.kind !== "socio") return false;
    return t.tierId === null || t.tierId === quem.tierId;
  });
}

/**
 * Aceita ou recusa um pedido, antes de guardar lugares. A frase de recusa é
 * para quem está a comprar.
 *
 * `livres` é por bancada (nulo = sem limite próprio) e `livresNoJogo` o total
 * que o jogo ainda leva (nulo = sem limite). As duas vêm da base, contadas
 * dentro da mesma transação que vai escrever, com o jogo bloqueado: é isso
 * que garante que dois pedidos ao mesmo tempo não vendem o mesmo lugar.
 */
export function verificarPedido(input: {
  linhas: LinhaDoPedido[];
  tipos: TipoParaVenda[];
  quem: Comprador;
  venda: EstadoDaVenda;
  livres: Record<string, number | null>;
  livresNoJogo: number | null;
}): PedidoAceite | PedidoRecusado {
  const { linhas, tipos, quem, venda, livres, livresNoJogo } = input;
  if (venda.fechada) return { ok: false, erro: "A venda de bilhetes para este jogo está fechada." };

  const pedidas = linhas.filter((l) => l.quantidade > 0);
  if (pedidas.length === 0) return { ok: false, erro: "Escolhe pelo menos um bilhete." };
  if (pedidas.some((l) => !Number.isInteger(l.quantidade) || l.quantidade < 0)) return { ok: false, erro: "Quantidade inválida." };
  const total = pedidas.reduce((n, l) => n + l.quantidade, 0);
  if (total > MAXIMO_POR_COMPRA) return { ok: false, erro: `No máximo ${MAXIMO_POR_COMPRA} bilhetes por compra.` };

  const podeEscolher = new Map(tiposPara(tipos, quem).map((t) => [t.id, t]));
  const bilhetes: PedidoAceite["bilhetes"] = [];
  let deSocio = 0;

  for (const l of pedidas) {
    const t = podeEscolher.get(l.typeId);
    if (!t) {
      const existe = tipos.some((x) => x.id === l.typeId);
      return { ok: false, erro: existe ? "Esse bilhete é só para sócios com as quotas em dia." : "Esse bilhete já não está à venda." };
    }
    if (!t.bancadaId) return { ok: false, erro: "Esse bilhete não tem bancada. O clube tem de o rever." };
    if (t.para === "socios") deSocio += l.quantidade;
    else if (!venda.publico) {
      return {
        ok: false,
        erro: venda.abrePublicoEm ? "A venda ao público ainda não abriu." : "Este jogo é só para sócios.",
      };
    }
    for (let i = 0; i < l.quantidade; i++) {
      bilhetes.push({ typeId: t.id, typeName: t.nome, bancadaId: t.bancadaId, priceCents: t.precoCents, deSocio: t.para === "socios" });
    }
  }

  if (deSocio > 0) {
    if (quem.kind !== "socio") return { ok: false, erro: "Esse bilhete é só para sócios com as quotas em dia." };
    if (!venda.socios) return { ok: false, erro: "A venda aos sócios ainda não abriu." };
    if (deSocio > 1 || quem.jaTemBilheteDeSocio) return { ok: false, erro: "Cada sócio leva um bilhete de sócio por jogo. Os acompanhantes compram ao preço deles." };
  }

  // A lotação, por bancada e no jogo.
  const porBancada = new Map<string, number>();
  for (const b of bilhetes) porBancada.set(b.bancadaId, (porBancada.get(b.bancadaId) ?? 0) + 1);
  for (const [bancadaId, n] of porBancada) {
    const livre = livres[bancadaId];
    if (livre !== null && livre !== undefined && n > livre) {
      return { ok: false, erro: livre === 0 ? "Esta bancada esgotou." : `Só há ${livre} ${livre === 1 ? "lugar" : "lugares"} nesta bancada.` };
    }
  }
  if (livresNoJogo !== null && total > livresNoJogo) {
    return { ok: false, erro: livresNoJogo === 0 ? "Os bilhetes para este jogo esgotaram." : `Só há ${livresNoJogo} ${livresNoJogo === 1 ? "lugar" : "lugares"} para este jogo.` };
  }

  return { ok: true, totalCents: bilhetes.reduce((n, b) => n + b.priceCents, 0), bilhetes };
}

/* -------------------------------------------------------------------------- */
/* O sócio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A data de nascimento escrita (`AAAA-MM-DD`) é a da ficha? Compara só o dia,
 * em UTC, porque a coluna é uma data sem hora. Sem data na ficha, não há como
 * confirmar: recusa.
 */
export function mesmaData(naFicha: Date | null, escrita: string): boolean {
  if (!naFicha || !/^\d{4}-\d{2}-\d{2}$/.test(escrita)) return false;
  return naFicha.toISOString().slice(0, 10) === escrita;
}

export type QuotaParaCobertura = { period: string; status: string; coversFrom: Date | null; coversTo: Date | null };

/**
 * A quota do sócio cobre o dia do jogo?
 *
 * Um jogo a 14 de setembro com as quotas pagas até agosto não passa. Cobre
 * quando há uma quota paga cuja cobertura inclui o dia do jogo, ou a do
 * período em que o jogo cai (as quotas antigas não têm cobertura escrita),
 * ou quando o clube dispensou esse período. Uma categoria sem quota (0 €) não
 * tem nada a cobrir.
 */
export function quotaCobre(input: {
  quotas: QuotaParaCobertura[];
  dispensados: string[];
  periodoDoJogo: string;
  dia: Date;
  semQuota: boolean;
}): boolean {
  if (input.semQuota) return true;
  if (input.dispensados.includes(input.periodoDoJogo)) return true;
  return input.quotas.some(
    (q) =>
      q.status === "SETTLED" &&
      ((q.coversFrom && q.coversTo && q.coversFrom <= input.dia && input.dia <= q.coversTo) || q.period === input.periodoDoJogo),
  );
}

/* -------------------------------------------------------------------------- */
/* O pagamento que chega                                                        */
/* -------------------------------------------------------------------------- */

/**
 * O que fazer a um pagamento confirmado.
 *
 * Pago dentro dos 10 minutos: fica com os lugares. Mas se a compra já tinha
 * sido dada por expirada (o aviso da euPago chegou atrasado) e entretanto os
 * lugares se venderam, não há onde o sentar: reembolso. Pago depois dos 10
 * minutos: reembolso, sempre (decisão do Rui).
 */
export function destinoDoPagamento(input: {
  status: string;
  reservedUntil: Date;
  pagoEm: Date;
  aindaHaLugar: boolean;
}): "emitir" | "reembolso" | "ja-tratado" {
  if (input.status === "PAID" || input.status === "LATE_PAYMENT" || input.status === "CANCELLED") return "ja-tratado";
  if (input.pagoEm > input.reservedUntil) return "reembolso";
  if (input.status === "EXPIRED" && !input.aindaHaLugar) return "reembolso";
  return "emitir";
}

/* -------------------------------------------------------------------------- */
/* O código do bilhete (QR)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `T` é um bilhete (`MatchTicket`), `S` um lugar anual (`SeasonSeat`). O QR
 * leva `T.<id>.<assinatura>`: não se adivinha, não se muda de bilhete, e não
 * há código guardado na base que possa vazar.
 */
export type TipoDeCodigo = "T" | "S";

function assinatura(segredo: string, tipo: TipoDeCodigo, id: string): string {
  return createHmac("sha256", segredo).update(`bilhete:${tipo}:${id}`).digest("base64url").slice(0, 22);
}

export function codigoDoBilhete(segredo: string, tipo: TipoDeCodigo, id: string): string {
  return `${tipo}.${id}.${assinatura(segredo, tipo, id)}`;
}

/** O que um QR lido diz, se for nosso. Nulo para tudo o resto (outro sistema, editado, partido). */
export function lerCodigo(segredo: string, texto: string): { tipo: TipoDeCodigo; id: string } | null {
  const partes = texto.trim().split(".");
  if (partes.length !== 3) return null;
  const [tipo, id, sig] = partes;
  if ((tipo !== "T" && tipo !== "S") || !/^[a-z0-9]{10,40}$/i.test(id)) return null;
  const certa = Buffer.from(assinatura(segredo, tipo, id));
  const dada = Buffer.from(sig);
  if (certa.length !== dada.length || !timingSafeEqual(certa, dada)) return null;
  return { tipo, id };
}

/* -------------------------------------------------------------------------- */
/* A porta e o leitor                                                           */
/* -------------------------------------------------------------------------- */

/** A porta "todas": quem não quer separar entradas usa esta. */
export const TODAS_AS_PORTAS = "todas";

/** Esta porta deixa entrar quem tem lugar nesta bancada? */
export function portaAceita(porta: { id: string; bancadaIds: string[] } | typeof TODAS_AS_PORTAS, bancadaId: string): boolean {
  return porta === TODAS_AS_PORTAS || porta.bancadaIds.includes(bancadaId);
}

export type Resultado = "OK" | "ALREADY_USED" | "WRONG_GATE" | "WRONG_MATCH" | "VOID" | "INVALID" | "QUOTA_EM_ATRASO";

/**
 * O que o leitor diz de um código, já lido e verificado.
 *
 * Um bilhete: tem de ser deste jogo, estar válido e por usar, e da bancada da
 * porta. Um lugar anual: tem de ser da época e do recinto do jogo, da bancada
 * da porta, e o sócio tem de ter a quota em dia (decisão do Rui: em atraso
 * não entra). O lugar anual não se "gasta": entra uma vez por jogo, e o
 * serviço diz se já entrou neste jogo.
 */
export function decidirEntrada(input:
  | { tipo: "T"; bilhete: { matchId: string; status: string; bancadaId: string } | null; jogoId: string; porta: Parameters<typeof portaAceita>[0] }
  | {
      tipo: "S";
      lugar: { seasonId: string; venueId: string; bancadaId: string } | null;
      jogo: { seasonId: string | null; venueId: string | null };
      jaEntrouNesteJogo: boolean;
      quotaEmDia: boolean;
      porta: Parameters<typeof portaAceita>[0];
    }): Resultado {
  if (input.tipo === "T") {
    const b = input.bilhete;
    if (!b) return "INVALID";
    if (b.matchId !== input.jogoId) return "WRONG_MATCH";
    if (b.status === "VOID") return "VOID";
    if (!portaAceita(input.porta, b.bancadaId)) return "WRONG_GATE";
    if (b.status === "USED") return "ALREADY_USED";
    return "OK";
  }
  const l = input.lugar;
  if (!l) return "INVALID";
  if (!input.jogo.seasonId || l.seasonId !== input.jogo.seasonId || l.venueId !== input.jogo.venueId) return "WRONG_MATCH";
  if (!portaAceita(input.porta, l.bancadaId)) return "WRONG_GATE";
  if (!input.quotaEmDia) return "QUOTA_EM_ATRASO";
  if (input.jaEntrouNesteJogo) return "ALREADY_USED";
  return "OK";
}

/* -------------------------------------------------------------------------- */
/* O link e o PIN do segurança                                                  */
/* -------------------------------------------------------------------------- */

/** Tentativas erradas seguidas antes de o PIN bloquear, e por quanto tempo. */
export const PIN_TENTATIVAS = 5;
export const PIN_BLOQUEIO_MIN = 15;

/** O token do link: 32 bytes aleatórios. Guarda-se só o resumo. */
export function novoToken(): string {
  return randomBytes(32).toString("base64url");
}

export function resumoDoToken(token: string): string {
  return createHash("sha256").update(`porta:${token}`).digest("hex");
}

/** Seis algarismos, para se ditar ao telefone. A força vem do bloqueio, não do tamanho. */
export function novoPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** O PIN guardado como `sal:resumo` (scrypt). Um PIN de seis algarismos não se guarda em claro. */
export function guardarPin(pin: string): string {
  const sal = randomBytes(16).toString("hex");
  return `${sal}:${scryptSync(pin, sal, 32).toString("hex")}`;
}

export function pinCerto(pin: string, guardado: string): boolean {
  const [sal, resumo] = guardado.split(":");
  if (!sal || !resumo || !/^\d{6}$/.test(pin)) return false;
  const dado = scryptSync(pin, sal, 32);
  const certo = Buffer.from(resumo, "hex");
  return dado.length === certo.length && timingSafeEqual(dado, certo);
}

/**
 * Depois de uma tentativa: quantas erradas seguidas, e se fica bloqueado.
 * Uma certa limpa a contagem.
 */
export function depoisDaTentativa(certa: boolean, erradas: number, agora = new Date()): { erradas: number; bloqueadoAte: Date | null } {
  if (certa) return { erradas: 0, bloqueadoAte: null };
  const n = erradas + 1;
  return { erradas: n, bloqueadoAte: n >= PIN_TENTATIVAS ? new Date(agora.getTime() + PIN_BLOQUEIO_MIN * 60_000) : null };
}
