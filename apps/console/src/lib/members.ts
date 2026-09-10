import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";

/**
 * Sócios — a fronteira de dados.
 *
 * Como o scouting, fica fora do bootstrap: um clube com história tem milhares de
 * sócios, e trazê-los todos para o browser à entrada seria pagar por uma área que
 * a maior parte das pessoas nem abre.
 */

export type MemberStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type Sex = "FEMALE" | "MALE" | "UNSPECIFIED";
export type DocumentKind = "CC" | "PASSPORT" | "RESIDENCE" | "OTHER";

export const STATUS_LABEL: Record<MemberStatus, string> = {
  PENDING: "Por aprovar",
  ACTIVE: "Activo",
  SUSPENDED: "Suspenso",
  CANCELLED: "Cancelado",
};

export const SEX_LABEL: Record<Sex, string> = {
  FEMALE: "Feminino",
  MALE: "Masculino",
  UNSPECIFIED: "Não indicado",
};

export const DOC_LABEL: Record<DocumentKind, string> = {
  CC: "Cartão de cidadão",
  PASSPORT: "Passaporte",
  RESIDENCE: "Título de residência",
  OTHER: "Outro",
};

export type MemberTier = {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  /** Por mês — as quotas são mensais e só mensais (ver `member-fees.service.ts`). */
  feeCents: number | null;
  minAge: number | null;
  maxAge: number | null;
  isPublic: boolean;
  order: number;
  members: number;
};

/*
 * Só o nome é garantido.
 *
 * Um sócio inscrito ao balcão traz o nome e um contacto; o resto da ficha
 * completa-se depois, e até lá é **nulo** — não string vazia. A diferença
 * importa nos ecrãs: um vazio desenha-se como campo em branco, um nulo
 * desenha-se como "por preencher", que é uma coisa que se pode ir corrigir.
 */
export type MemberRow = {
  id: string;
  number: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  phoneCountry: string;
  birthdate: string | null;
  city: string | null;
  status: MemberStatus;
  createdAt: string;
  approvedAt: string | null;
  source: string;
  tier: { id: string; name: string; feeCents: number | null } | null;
  /**
   * O estado da app deste sócio — o que a coluna "App" mostra.
   *
   * Quatro, e a diferença entre eles decide o que se pode fazer:
   * `account` já entrou, `invited` recebeu o convite e ainda não entrou,
   * `none` pode ser convidado, `noemail` **não pode** — falta o endereço na
   * ficha, e é o caso mais comum num livro importado de Excel.
   */
  app: "account" | "invited" | "none" | "noemail";
  /** Quando o convite saiu. Nulo quando nunca saiu. */
  inviteSentAt: string | null;
  /** O período (`AAAA-MM`) da última quota liquidada. Nulo = nunca pagou nenhuma. */
  lastPaidPeriod: string | null;
};

export type MemberDetail = MemberRow & {
  country: string;
  address: string | null;
  postalCode: string | null;
  sex: Sex;
  documentKind: DocumentKind;
  documentNumber: string | null;
  taxId: string | null;
  notes: string | null;
  /** Carimbos de consentimento. Nulo = não foi dado. Ver o modelo. */
  acceptedTermsAt: string | null;
  partnerCommsAt: string | null;
  partnerDataAt: string | null;
  approvedBy: string | null;
  /** A conta da app do clube: reclamada (`userId`) e o carimbo do convite. */
  userId: string | null;
  inviteSentAt: string | null;
  /** Vem com a ficha: é uma linha do cabeçalho, não um separador que se abre. */
  fees: MemberFeesSummary;
};

/* ---------------------------------------------------------------------------- */
/* Quotas e app                                                                  */
/* ---------------------------------------------------------------------------- */

export type MemberFeeRow = {
  id: string;
  /** `AAAA-MM`. Linhas antigas podem trazer `2026` ou `2026-T3` — o rótulo diz o que eram. */
  period: string;
  label: string | null;
  amountCents: number;
  dueOn: string | null;
  status: "OPEN" | "SETTLED" | "VOID";
  settledAt: string | null;
  method: string | null;
  notes: string | null;
};

/**
 * A situação de quotas de um sócio — a resposta a "está em dia este mês?".
 *
 * `missing` não é `open`: uma quota que ninguém lançou não é dívida do sócio,
 * é trabalho por fazer do clube.
 */
export type MemberFeesSummary = {
  currentPeriod: string;
  currentStatus: "settled" | "open" | "void" | "missing";
  openCount: number;
  openCents: number;
  overdueCount: number;
  lastSettled: { period: string; label: string | null; settledAt: string | null } | null;
};

/**
 * O que o ecrã de lançar precisa de saber.
 *
 * Não traz lista de meses: o intervalo é do cliente, que o produz a partir de
 * "de" e "até". Uma lista trazida do servidor era um tecto disfarçado — "os
 * doze mais recentes" impedia acertar a época de há dois anos. `taken` são
 * todos os meses que já têm quota, para o intervalo os deixar de fora seja em
 * que ano for.
 */
export type MemberFeePeriods = {
  hasTier: boolean;
  defaultAmountCents: number | null;
  taken: string[];
};

/**
 * Quão atrasado está um sócio, a partir da última quota que pagou.
 *
 * A regra é de leitura, não de contabilidade: **verde** se a última paga é a do
 * mês corrente, **amarelo** se é de algum dos três meses anteriores, e
 * **vermelho** a partir daí (ou se nunca pagou nenhuma). É a régua que uma
 * direcção usa a olhar para a lista — quem está em dia, quem está a começar a
 * atrasar-se, e quem já é conversa para ter.
 *
 * ## O que ela não sabe
 *
 * O período de cobrança do escalão. Uma quota **anual** paga em Janeiro é a
 * última paga o ano inteiro, e a partir de Maio esta régua pinta-a de vermelho
 * — o sócio está em dia e a coluna diz que não. Para clubes de quota mensal (o
 * caso de longe mais comum) a conta está certa; para os outros, a coluna do
 * escalão ao lado diz qual é o período, e o `title` da célula dá a data por
 * extenso.
 */
export function feeStanding(lastPaidPeriod: string | null, hoje = new Date()): "ok" | "warn" | "late" {
  if (!lastPaidPeriod) return "late";

  const atual = hoje.getFullYear() * 12 + hoje.getMonth();
  const [ano, mes] = lastPaidPeriod.split("-").map(Number);
  if (!Number.isFinite(ano) || !Number.isFinite(mes)) return "late";

  // `mes - 1` porque `getMonth()` conta de zero e o período conta de um.
  const meses = atual - (ano * 12 + (mes - 1));
  if (meses <= 0) return "ok";
  if (meses <= 3) return "warn";
  return "late";
}

export const listMemberFees = (memberId: string) => apiGet<MemberFeeRow[]>(`/api/members/${memberId}/fees`);
export const memberFeePeriods = (memberId: string) =>
  apiGet<MemberFeePeriods>(`/api/members/${memberId}/fees/periods`);
export const createMemberFees = (memberId: string, body: { periods: string[]; amountCents: number; notes?: string }) =>
  apiPost<{ created: number; alreadyExisted: string[] }>(`/api/members/${memberId}/fees`, body);
/** O menu "Marcar como paga / por pagar / Anular" — o mesmo das mensalidades. */
export const setMemberFeeStatus = (id: string, status: MemberFeeRow["status"]) =>
  apiPatch<{ id: string; status: MemberFeeRow["status"] }>(`/api/members/fees/${id}/status`, { status });

/** "Setembro 2026" a partir de `2026-09`; o que não for mês devolve-se como veio. */
export function mesPorExtenso(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const inviteMember = (id: string) => apiPost<{ ok: true; email: string }>(`/api/members/${id}/invite`, {});

/**
 * (Re)enviar o convite a vários — a acção em massa da lista.
 *
 * Devolve a contagem em vez de rebentar no primeiro que não dá: escolher trinta
 * sócios de um livro importado e ter quinze sem email é o caso normal, não um
 * erro. Ver `enviarMuitos` no servidor.
 */
export const inviteMembers = (ids: string[]) =>
  apiPost<{ ok: true; enviados: number; falhas: { id: string; reason: string }[] }>("/api/members/invites", { ids });

/**
 * Desligar a ficha da conta. Ligar não tem função: acontece sozinho, pelo email
 * da ficha, na consola (ao gravar) e na app (ao abrir).
 */
export const unlinkMemberAccount = (id: string) => apiDelete<{ ok: true }>(`/api/members/${id}/link-account`);

/* ---------------------------------------------------------------------------- */
/* Sondagens                                                                     */
/* ---------------------------------------------------------------------------- */

export type PollRow = {
  id: string;
  question: string;
  details: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED";
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  totalVotes: number;
  options: { id: string; label: string; votes: number }[];
};

export const listPolls = () => apiGet<PollRow[]>("/api/polls");
export const createPoll = (body: { question: string; details?: string; options: string[] }) =>
  apiPost<{ id: string }>("/api/polls", body);
export const publishPoll = (id: string) => apiPost<{ ok: true }>(`/api/polls/${id}/publish`, {});
export const closePoll = (id: string) => apiPost<{ ok: true }>(`/api/polls/${id}/close`, {});
export const removePoll = (id: string) => apiDelete<{ ok: true }>(`/api/polls/${id}`);

/* O cartão na app — os dois interruptores das definições do clube. */
export const setMemberCard = (body: { cardEnabled?: boolean; qrEnabled?: boolean }) =>
  apiPatch<{ cardEnabled: boolean; qrEnabled: boolean }>("/api/member-card", body);

export const listMembers = (filters: { status?: string; tierId?: string; q?: string } = {}) =>
  apiGet<{ members: MemberRow[]; counts: Partial<Record<MemberStatus, number>> }>("/api/members", filters);

export const createMember = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string; number: number | null }>("/api/members", body);

export const getMember = (id: string) => apiGet<MemberDetail>(`/api/members/${id}`);

export const updateMember = (id: string, body: Record<string, unknown>) => apiPatch(`/api/members/${id}`, body);

/**
 * Apagar de vez — só serve para o que nunca chegou a ser sócio.
 *
 * O servidor recusa assim que houver um número atribuído e diz porquê; ver
 * `MembersService.remove`. Quem tem número cancela-se, não se apaga.
 */
export const removeMember = (id: string) => apiDelete<{ ok: boolean }>(`/api/members/${id}`);

export const listTiers = () => apiGet<MemberTier[]>("/api/members/tiers");

export const createTier = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string }>("/api/members/tiers", body);

export const updateTier = (id: string, body: Record<string, unknown>) => apiPatch(`/api/members/tiers/${id}`, body);

export const archiveTier = (id: string) => apiDelete<{ ok: boolean; members: number }>(`/api/members/tiers/${id}`);

/* -------------------------------------------------------------------------- */
/* Importação                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Uma linha da folha, já traduzida para os nomes que a API conhece.
 *
 * Obrigatórios: **nome, número de sócio, telemóvel e categoria**. Tudo o resto é
 * opcional porque a folha do clube não o tem — ver `MemberImportRowDto`.
 */
export type ImportRow = {
  line: number;
  name: string;
  number: number;
  phone: string;
  tier: string;
  email?: string;
  birthdate?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  phoneCountry?: string;
  documentNumber?: string;
  taxId?: string;
  sex?: Sex;
};

export type ImportResult = {
  ok: boolean;
  created: number;
  duplicates: { line: number; name: string }[];
  problems: { line: number; reason: string }[];
  /**
   * As categorias que a folha traz e o clube não tem, quando a importação parou
   * para perguntar. Vazio em todas as outras respostas.
   */
  unknownTiers: string[];
};

/**
 * `createTiers` responde à pergunta que o servidor faz quando a folha traz
 * categorias novas: criá-las, ou parar. Ver `ImportDialog`.
 */
export const importMembers = (rows: ImportRow[], createTiers = false) =>
  apiPost<ImportResult>("/api/members/import", { rows, createTiers });

/** Idade, que é o que decide se alguém cabe numa categoria. */
export function ageOf(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}
