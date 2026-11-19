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
  GOOGLE_PAY: "Google Pay",
  APPLE_PAY: "Apple Pay",
  PAYSAFECARD: "Paysafecard",
  DIRECT_DEBIT: "Débito directo",
  TRANSFER: "Transferência",
  CASH: "Numerário",
};

export type TransactionRow = {
  id: string;
  /**
   * `manual` edita-se aqui. `fees` deriva das cobranças pagas (mensalidades e
   * avulsas, como o equipamento) e `quotas` das quotas dos sócios pagas: só
   * leitura, a verdade delas vive nesses ecrãs.
   */
  source: "manual" | "fees" | "quotas";
  kind: FinanceKind;
  status: FinanceStatus;
  description: string;
  amountCents: number;
  /** O dia do movimento. Numa mensalidade ou quota, o dia em que foi paga. */
  occurredAt: string;
  /**
   * Só nas mensalidades e quotas: o mês a que respeitam (`AAAA-MM`). Nas
   * receitas contam pelo dia do pagamento. Ausente num servidor antigo.
   */
  referenteA?: string | null;
  dueDate: string | null;
  method: string | null;
  counterparty: string | null;
  notes: string | null;
  /** Preenchido quando a linha é um mês de uma despesa (ou receita) fixa. */
  seriesId: string | null;
  /** Quando a linha paga um mês de vencimento: o mês (`AAAA-MM`). Ausente num servidor antigo. */
  salaryPeriod?: string | null;
  salaryId?: string | null;
  category: { id: string; label: string } | null;
  athlete: { id: string; name: string } | null;
  member: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  staffId?: string | null;
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
  /** As quotas de sócios pagas este mês. Ausente num servidor antigo. */
  quotasMes?: number;
  /**
   * Das receitas deste mês, o que é de mensalidades e quotas de meses
   * anteriores (a de setembro paga em outubro). Ausente num servidor antigo.
   */
  recebidoDeMesesAnteriores?: number;
  receitasPrevistas: number;
  despesasPrevistas: number;
  saldoProjetado: number;
  horizonDays: number;
  /** Os quatro horizontes numa resposta — o selector troca sem ir ao servidor. */
  forecast: { days: number; income: number; expense: number }[];
  includeFees: boolean;
  /** Quantos meses tem a série e o "por categoria" (6, 12 ou 24). Ausente num servidor antigo. */
  meses?: number;
  /** `AAAA-MM` do mês corrente, na hora do clube. */
  mesAtual?: string;
  monthly: { month: string; income: number; expense: number }[];
  proximasDespesas: UpcomingRow[];
  proximasReceitas: UpcomingRow[];
  /** Receitas e despesas por categoria, no período da série (mensalidades e quotas incluídas). */
  porCategoria: { kind: FinanceKind; label: string; amountCents: number }[];
  /** A folha de vencimentos em resumo. Ausente num servidor antigo. */
  vencimentos?: ResumoDeVencimentos;
  /** O orçamento da época em curso, em totais. */
  orcamento?: { epoca: string; budgetCents: number; spentCents: number; categorias: number; acima: number } | null;
  /** O que precisa de atenção. Só o que existe. */
  atencao?: Atencao[];
};

export type Atencao =
  | { tipo: "vencimentos-atraso"; n: number; amountCents: number }
  | { tipo: "vencimentos-mes"; n: number; amountCents: number }
  | { tipo: "previstos-vencidos"; n: number; amountCents: number; receitasCents: number }
  | { tipo: "orcamento"; epoca: string; categorias: { label: string; budgetCents: number; spentCents: number }[] }
  | { tipo: "saldo-projetado"; amountCents: number };

/* -------------------------------------------------------------------------- */
/* Vencimentos                                                                 */
/* -------------------------------------------------------------------------- */

/** Um período de vencimento: "600 € por mês de setembro em diante". */
export type PeriodoDeVencimento = {
  id: string;
  amountCents: number;
  /** `AAAA-MM-DD`, sempre o dia 1. */
  startsOn: string;
  /** `AAAA-MM-DD`, o último dia do último mês; nulo = em vigor. */
  endsOn: string | null;
  /** 1–28; nulo = o último dia do mês. */
  payDay: number | null;
  notes: string | null;
  createdAt: string;
};

export type EstadoDoMes = "pago" | "atraso" | "este-mes" | "futuro";

export type MesDeVencimento = {
  /** `AAAA-MM` */
  period: string;
  amountCents: number;
  /** `AAAA-MM-DD` em que vence. */
  vence: string;
  salaryId: string;
  estado: EstadoDoMes;
  pagamento: { id: string; amountCents: number; occurredAt: string; method: string | null } | null;
};

export type PessoaComVencimento = {
  tipo: "staff" | "atleta";
  /** O id da pessoa: `membershipId` no staff, `athleteId` no atleta. */
  id: string;
  nome: string;
  /** O cargo, ou a equipa do atleta. */
  detalhe: string | null;
  ativo: boolean;
  /** O período em vigor no mês corrente. */
  atual: PeriodoDeVencimento | null;
  /** Todos os períodos, do mais recente para trás. */
  periodos: PeriodoDeVencimento[];
  /** Os meses da janela (12 para trás, 1 para a frente), do mais antigo para o mais recente. */
  meses: MesDeVencimento[];
  emAtraso: MesDeVencimento[];
  esteMes: MesDeVencimento | null;
  ultimoPagamento: { id: string; period: string | null; amountCents: number; occurredAt: string } | null;
};

export type ResumoDeVencimentos = {
  pessoas: number;
  folhaMensal: number;
  pagoEsteMes: { n: number; amountCents: number };
  porPagarEsteMes: { n: number; amountCents: number };
  emAtraso: { n: number; amountCents: number };
};

export type Folha = {
  hoje: string;
  mesAtual: string;
  resumo: ResumoDeVencimentos;
  pessoas: PessoaComVencimento[];
};

export const ESTADO_DO_MES_LABEL: Record<EstadoDoMes, string> = {
  pago: "Pago",
  atraso: "Em atraso",
  "este-mes": "Por pagar",
  futuro: "A vencer",
};

/** A folha inteira, ou a de uma pessoa. */
export const getFolha = (filtro: { membershipId?: string; athleteId?: string } = {}) =>
  apiGet<Folha>("/api/finance/salaries", filtro);

export const createSalary = async (body: {
  membershipId?: string;
  athleteId?: string;
  amountCents: number;
  startsOn: string;
  payDay: number | null;
  notes?: string;
}) => {
  const r = await apiPost<{ id: string }>("/api/finance/salaries", body);
  esquecerMovimentos();
  return r;
};

export const updateSalary = (id: string, body: Record<string, unknown>) =>
  apiPatch<{ ok: true }>(`/api/finance/salaries/${id}`, body);

export const deleteSalary = (id: string) => apiDelete<{ ok: true }>(`/api/finance/salaries/${id}`);

export const paySalary = async (
  id: string,
  body: { period: string; paidOn?: string; amountCents?: number; method?: string; notes?: string },
) => {
  const r = await apiPost<{ id: string; amountCents: number }>(`/api/finance/salaries/${id}/pagar`, body);
  esquecerMovimentos();
  return r;
};

export const payMonth = async (body: { period: string; salaryIds?: string[]; paidOn?: string; method?: string }) => {
  const r = await apiPost<{ pagos: number; amountCents: number }>("/api/finance/salaries/pagar-mes", body);
  esquecerMovimentos();
  return r;
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
  from?: string; to?: string; matchId?: string; calendarEventId?: string; trainingSessionId?: string; athleteId?: string; teamId?: string;
};

/* -------------------------------------------------------------------------- */

export const getOverview = (opts: { horizon?: number; meses?: number } = {}) =>
  apiGet<Overview>("/api/finance/overview", {
    ...(opts.horizon ? { horizon: String(opts.horizon) } : {}),
    ...(opts.meses ? { meses: String(opts.meses) } : {}),
  });

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

const chaveDoEvento = (link: { matchId?: string; calendarEventId?: string; trainingSessionId?: string }) =>
  `${link.matchId ?? ""}|${link.calendarEventId ?? ""}|${link.trainingSessionId ?? ""}`;

/** O que já se sabe deste evento, ou `undefined` se ainda não se perguntou. */
export const movimentosLembrados = (link: { matchId?: string; calendarEventId?: string; trainingSessionId?: string }) =>
  memoriaDeEventos.get(chaveDoEvento(link));

export async function movimentosDoEvento(link: {
  matchId?: string;
  calendarEventId?: string;
  trainingSessionId?: string;
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
export function esquecerMovimentos(link?: { matchId?: string; calendarEventId?: string; trainingSessionId?: string }): void {
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

/** Uma época no histórico do orçamento: o planeado contra o gasto. */
export type BudgetSeason = {
  seasonId: string;
  label: string;
  startsOn: string;
  endsOn: string;
  current: boolean;
  budgetCents: number;
  categoriasOrcamentadas: number;
  spentCents: number;
};

/** Todas as épocas, da mais recente para trás. */
export const getBudgetHistory = () => apiGet<BudgetSeason[]>("/api/finance/budgets/historico");

/** Copia o orçamento de uma época para outra, sem escrever por cima do que já lá está. */
export const copyBudget = (fromSeasonId: string, toSeasonId: string) =>
  apiPost<{ copiadas: number; mantidas: number }>("/api/finance/budgets/copiar", { fromSeasonId, toSeasonId });

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

/** "2,4 mil €" / "850 €": para os eixos dos gráficos, onde a casa decimal não cabe. */
export function eurosCurtos(cents: number): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} M€`;
  if (abs >= 10_000) return `${Math.round(v / 1000).toLocaleString("pt-PT")} mil €`;
  if (abs >= 1_000) return `${(v / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} mil €`;
  return `${Math.round(v).toLocaleString("pt-PT")} €`;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "nov" / "nov 26" a partir de "2026-11". */
export function mesCurto(chave: string, comAno = false): string {
  const [ano, mes] = chave.split("-");
  const nome = MESES_CURTOS[Number(mes) - 1] ?? chave;
  return comAno ? `${nome} ${ano.slice(2)}` : nome;
}

/** "novembro de 2026" a partir de "2026-11". */
export function mesLongo(chave: string): string {
  const [ano, mes] = chave.split("-");
  const nome = MESES_LONGOS[Number(mes) - 1];
  return nome ? `${nome} de ${ano}` : chave;
}

/** `AAAA-MM` mais `n` meses. */
export function somarMeses(chave: string, n: number): string {
  const [a, m] = chave.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  return `${ano}-${String(total - ano * 12 + 1).padStart(2, "0")}`;
}
