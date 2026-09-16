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
  /** O valor no período de `billing`: por mês, ou por época numa categoria anual. */
  feeCents: number | null;
  /**
   * Mensal ou anual. Numa anual nasce **uma** quota por época — ver a migração
   * `quota_mensal_ou_anual`. Ausente num servidor antigo: lê-se como mensal.
   */
  billing: "MONTHLY" | "ANNUAL";
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
  tier: { id: string; name: string; feeCents: number | null; billing: "MONTHLY" | "ANNUAL" } | null;
  /** Link assinado com prazo para a fotografia; nulo sem fotografia. Ver `photos.ts`. */
  photoUrl: string | null;
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
  /**
   * Como se chama o período corrente — "Setembro 2026" ou "Época 2026/27".
   *
   * Vem do servidor porque é lá que se sabe se a categoria é mensal ou anual.
   * Sem isto, a ficha de um sócio anual dizia "Este mês · Agosto" em Março.
   */
  currentLabel: string;
  currentKind: "month" | "season";
  /** `dismissed`: não há quota deste período porque a direcção a apagou. */
  currentStatus: "settled" | "open" | "void" | "missing" | "dismissed";
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
  /**
   * Mensal ou anual. O ecrã de lançar muda de unidade com isto: numa categoria
   * anual escolhem-se épocas, e o período de cada quota é o mês em que a época
   * abre. Ausente num servidor antigo: lê-se como mensal.
   */
  billing: "MONTHLY" | "ANNUAL";
  /** Quando o período anual do clube abre — decide que épocas o ecrã oferece. */
  annualStartMonth: number;
  annualStartDay: number;
  taken: string[];
};

/**
 * Em que mês abre o período das quotas anuais — do clube, para todas as
 * categorias anuais. Vive no topo do popup das categorias; lê-se de
 * `academy.memberAnnualStartMonth` e muda-se aqui.
 */
export const setMemberAnnualStart = (startMonth: number, startDay: number) =>
  apiPatch<{ startMonth: number; startDay: number }>("/api/member-annual-period", { startMonth, startDay });

/** Quantos dias tem cada mês, num ano comum — o mesmo tecto do servidor. */
export const DIAS_DO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

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
/**
 * Apagar uma quota. O servidor recusa as pagas online e as que têm um pagamento
 * online em curso, e diz porquê; a apagada não volta pela emissão automática.
 */
export const deleteMemberFee = (id: string) =>
  apiDelete<{ ok: true; period: string; label: string | null }>(`/api/members/fees/${id}`);

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

/* ---------------------------------------------------------------------------- */
/* O período anual                                                               */
/* ---------------------------------------------------------------------------- */

/**
 * Em que ano abre o período anual (com início em `inicio`) a que `d` pertence.
 *
 * Com início em Agosto, Março de 2027 pertence ao período que abriu em 2026;
 * com início em Janeiro, pertence ao de 2027. Gémeo do `inicioDaEpoca` do
 * servidor — o mesmo cálculo dos dois lados, senão o ecrã de lançar abria na
 * época errada.
 */
export function anoDoPeriodoAnual(inicio: number, d: Date, dia = 1): number {
  const m = d.getMonth() + 1;
  const jaAbriu = m > inicio || (m === inicio && d.getDate() >= dia);
  return jaAbriu ? d.getFullYear() : d.getFullYear() - 1;
}

/**
 * O período anual que abre em `inicio` de `ano`: do dia 1 desse mês até um ano
 * depois menos um dia. Janeiro de 2026 dá 1 de Janeiro a 31 de Dezembro de
 * 2026; Agosto dá 1 de Agosto de 2026 a 31 de Julho de 2027; Março dá 1 de
 * Março a 28 de Fevereiro de 2027 — o `Date` trata dos bissextos.
 */
export function periodoAnual(inicio: number, ano: number, dia = 1): { de: Date; ate: Date } {
  return {
    de: new Date(Date.UTC(ano, inicio - 1, dia)),
    // O dia anterior ao de abertura, no ano seguinte. Com `dia` 1 cai no dia 0,
    // que o `Date` lê como o último dia do mês anterior.
    ate: new Date(Date.UTC(ano + 1, inicio - 1, dia - 1)),
  };
}

/** "2026" quando é o ano civil, "2026/27" quando atravessa dois — o mesmo do servidor. */
export function rotuloDoPeriodoAnual(inicio: number, ano: number): string {
  return inicio === 1 ? String(ano) : `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

/** "1 de Agosto de 2026 a 31 de Julho de 2027" — como se lê na ficha da categoria. */
export function descreverPeriodoAnual(inicio: number, ano: number, dia = 1): string {
  const { de, ate } = periodoAnual(inicio, ano, dia);
  const porExtenso = (d: Date) => `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  return `${porExtenso(de)} a ${porExtenso(ate)}`;
}

/** "Jan–Dez", "Ago–Jul" — para uma linha de lista. */
export function janelaDoPeriodoAnual(inicio: number): string {
  const curto = (m: number) => MESES[m - 1].slice(0, 3);
  const fim = inicio === 1 ? 12 : inicio - 1;
  return `${curto(inicio)}–${curto(fim)}`;
}

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
 * Apagar de vez — a ficha, as quotas e os pagamentos dela.
 *
 * Já era recusado a quem tivesse número; deixou de ser, porque o problema que o
 * travão queria resolver (o número voltar à fila) resolveu-se na numeração e não
 * na porta — ver `MembersService.remove`. `freedNumber` é o número que ficou
 * aberto, para o ecrã o poder dizer; nulo quando a ficha nunca teve número.
 */
export const removeMember = (id: string) =>
  apiDelete<{ ok: boolean; freedNumber: number | null }>(`/api/members/${id}`);

export const listTiers = () => apiGet<MemberTier[]>("/api/members/tiers");

export const createTier = (body: Record<string, unknown>) =>
  apiPost<{ id: string; name: string }>("/api/members/tiers", body);

/**
 * `applyToCurrent` é a resposta à pergunta que o formulário faz quando o preço
 * muda: já neste período (as quotas por pagar passam ao valor novo) ou só a
 * partir do próximo. `repriced` diz quantas mudaram.
 */
export const updateTier = (id: string, body: Record<string, unknown>) =>
  apiPatch<{ ok: true; repriced: number }>(`/api/members/tiers/${id}`, body);

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
