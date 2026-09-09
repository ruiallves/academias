import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";

/**
 * Contas, do lado do cliente. Tipos e chamadas, sem estado — como o inventário,
 * e pela mesma razão: o dinheiro muda a cada registo, e uma cópia local seria
 * uma cópia velha.
 *
 * Todos os valores em **cêntimos**. A formatação é de quem desenha.
 */

export type FinanceKind = "INCOME" | "EXPENSE";
export type FinanceStatus = "PLANNED" | "PENDING" | "COMPLETED" | "CANCELLED";

export const STATUS_LABEL: Record<FinanceStatus, string> = {
  PLANNED: "Previsto",
  PENDING: "Pendente",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

export const STATUS_TONE: Record<FinanceStatus, "neutral" | "warn" | "ok" | "risk"> = {
  PLANNED: "neutral",
  PENDING: "warn",
  COMPLETED: "ok",
  CANCELLED: "risk",
};

export const METHOD_LABEL: Record<string, string> = {
  MBWAY: "MB WAY",
  MULTIBANCO: "Multibanco",
  CARD: "Cartão",
  TRANSFER: "Transferência",
  CASH: "Dinheiro",
};

export type TransactionRow = {
  id: string;
  /** `manual` edita-se aqui; `fees` deriva das Mensalidades e é só leitura. */
  source: "manual" | "fees";
  kind: FinanceKind;
  status: FinanceStatus;
  description: string;
  amountCents: number;
  occurredAt: string;
  dueDate: string | null;
  method: string | null;
  counterparty: string | null;
  notes: string | null;
  /** Preenchido quando a linha é um mês de uma despesa (ou receita) fixa. */
  seriesId: string | null;
  category: { id: string; label: string } | null;
  athlete: { id: string; name: string } | null;
  member: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  staffName: string | null;
  match: { id: string; label: string; teamName: string } | null;
  calendarEvent: { id: string; title: string } | null;
  createdBy: string | null;
};

export type UpcomingRow = {
  id: string;
  description: string;
  amountCents: number;
  occurredAt: string;
  status: FinanceStatus;
  category: string | null;
  eventLabel: string | null;
};

export type Overview = {
  saldo: number;
  saldoInicial: number;
  receitasMes: number;
  despesasMes: number;
  resultadoMes: number;
  mensalidadesMes: number;
  receitasPrevistas: number;
  despesasPrevistas: number;
  saldoProjetado: number;
  horizonDays: number;
  /** Os quatro horizontes numa resposta — o selector troca sem ir ao servidor. */
  forecast: { days: number; income: number; expense: number }[];
  includeFees: boolean;
  monthly: { month: string; income: number; expense: number }[];
  proximasDespesas: UpcomingRow[];
  proximasReceitas: UpcomingRow[];
  porCategoria: { kind: FinanceKind; label: string; amountCents: number }[];
};

export type FinanceSettings = {
  id: string;
  initialBalanceCents: number;
  initialBalanceAt: string | null;
  includeFees: boolean;
  includeQuotas: boolean;
};

export type BudgetRows = {
  season: { id: string; label: string };
  rows: { categoryId: string; label: string; budgetCents: number; spentCents: number }[];
};

export type TransactionFilters = {
  kind?: string; status?: string; categoryId?: string; q?: string;
  from?: string; to?: string; matchId?: string; calendarEventId?: string; athleteId?: string; teamId?: string;
};

/* -------------------------------------------------------------------------- */

export const getOverview = (horizon?: number) =>
  apiGet<Overview>("/api/finance/overview", horizon ? { horizon: String(horizon) } : undefined);

export const listTransactions = (f: TransactionFilters = {}) =>
  apiGet<TransactionRow[]>("/api/finance/transactions", f as Record<string, string | undefined>);

/* -------------------------------------------------------------------------- */
/* O dinheiro de um evento, lembrado                                           */
/* -------------------------------------------------------------------------- */

/**
 * Os movimentos de um evento, com memória entre aberturas da gaveta.
 *
 * ## Porque é que isto existe
 *
 * A gaveta do calendário lê tudo o resto do que já está em memória — o evento,
 * a equipa, o treinador — e desenha-se num instante. Só o painel do dinheiro é
 * que ia à rede, e por isso aparecia depois de todo o resto, como se tivesse
 * sido esquecido e chegasse atrasado.
 *
 * Percorrer uma semana no calendário é abrir e fechar a mesma gaveta muitas
 * vezes. Da segunda vez em diante a resposta já cá está, e o painel nasce
 * completo com o resto.
 *
 * ## O que a memória **não** faz
 *
 * Não esconde uma alteração. Qualquer escrita (registar, confirmar, apagar)
 * limpa o que estava guardado — ver `esquecerMovimentos`, chamado pelas três.
 * E a memória morre com a página: é um atalho entre dois cliques, não uma
 * cópia da base.
 */
const memoriaDeEventos = new Map<string, TransactionRow[]>();

const chaveDoEvento = (link: { matchId?: string; calendarEventId?: string }) =>
  `${link.matchId ?? ""}|${link.calendarEventId ?? ""}`;

/** O que já se sabe deste evento, ou `undefined` se ainda não se perguntou. */
export const movimentosLembrados = (link: { matchId?: string; calendarEventId?: string }) =>
  memoriaDeEventos.get(chaveDoEvento(link));

export async function movimentosDoEvento(link: {
  matchId?: string;
  calendarEventId?: string;
}): Promise<TransactionRow[]> {
  const rows = await listTransactions(link);
  memoriaDeEventos.set(chaveDoEvento(link), rows);
  return rows;
}

/**
 * Esquecer o que se sabia — de um evento, ou de todos.
 *
 * Sem argumento limpa tudo: um movimento registado na página das Contas pode
 * pertencer a um evento qualquer, e adivinhar qual seria mais frágil do que
 * voltar a perguntar.
 */
export function esquecerMovimentos(link?: { matchId?: string; calendarEventId?: string }): void {
  if (link) memoriaDeEventos.delete(chaveDoEvento(link));
  else memoriaDeEventos.clear();
}

export const createTransaction = async (body: Record<string, unknown>) => {
  const r = await apiPost<{ id: string; created: number; seriesId?: string }>("/api/finance/transactions", body);
  esquecerMovimentos();
  return r;
};

export const updateTransaction = async (id: string, body: Record<string, unknown>) => {
  const r = await apiPatch<{ ok: true }>(`/api/finance/transactions/${id}`, body);
  esquecerMovimentos();
  return r;
};

/**
 * Apagar um movimento lançado à mão.
 *
 * Não é o par do cancelar — é a saída para o que nunca devia ter existido (ver
 * a regra 3 no serviço). `scope: "series"` leva também os meses seguintes da
 * mesma série; devolve quantas linhas desapareceram, para o ecrã o poder dizer.
 */
export const deleteTransaction = async (id: string, scope?: "one" | "series") => {
  const r = await apiDelete<{ ok: true; deleted: number }>(
    `/api/finance/transactions/${id}`,
    scope ? { scope } : {},
  );
  esquecerMovimentos();
  return r;
};

export const getSettings = () => apiGet<FinanceSettings>("/api/finance/settings");

export const updateSettings = (body: Record<string, unknown>) => apiPut<{ ok: true }>("/api/finance/settings", body);

export const getBudgets = (seasonId?: string) =>
  apiGet<BudgetRows>("/api/finance/budgets", seasonId ? { seasonId } : undefined);

export const setBudget = (body: { seasonId: string; categoryId: string; amountCents: number }) =>
  apiPut<{ ok: true }>("/api/finance/budgets", body);

/* -------------------------------------------------------------------------- */

/** "€24 850,40" — vírgula decimal, espaço fino de milhares. Português. */
export function euros(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** "+€3 240,20" / "−€1 230,50" — o sinal sempre à vista, que é o ponto. */
export function eurosComSinal(cents: number): string {
  const abs = euros(Math.abs(cents));
  return cents >= 0 ? `+${abs}` : `−${abs}`;
}
