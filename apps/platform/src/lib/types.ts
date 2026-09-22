/** O que a API do painel devolve. Espelha `apps/api/src/platform`. */

export type PlatformRole = "OWNER" | "ADMIN" | "SUPPORT";

export type Me = { id: string; name: string; email: string; role: PlatformRole; mfaEnabled: boolean };

/* -------------------------------------------------------------------------- */
/* Administradores                                                             */
/* -------------------------------------------------------------------------- */

export type Admin = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  mfaEnabled: boolean;
  createdAt: string;
};

export const ADMIN_ROLE_LABEL: Record<PlatformRole, string> = {
  OWNER: "Dono",
  ADMIN: "Administrador",
  SUPPORT: "Apoio",
};

export type Alert = {
  id: string;
  severity: "risk" | "warn";
  title: string;
  detail: string;
  academyId: string;
  academyName: string;
};

export type Overview = {
  academies: { total: number; setup: number; trial: number; active: number; pastDue: number; cancelled: number; newThisMonth: number; churnThisMonth: number };
  people: { athletes: number; guardians: number; staff: number };
  revenue: { mrrCents: number; arrCents: number };
  usage: number | null;
  /**
   * Quem está a usar o produto **agora**, somado.
   *
   * `usage` e isto são as duas metades da mesma pergunta: `usage` conta clubes
   * que continuam a trabalhar (retenção, em dias), isto conta pessoas que estão
   * lá neste momento (vida, em segundos). `academies` é em quantos clubes há
   * alguém — sem esse número, doze espalhados por seis clubes e doze na mesma
   * sala leem-se igual.
   *
   * Pode vir indefinido durante um deploy, com a API ainda a antiga.
   */
  online?: { total: number; staff: number; family: number; academies: number };
  /** Os emails que saíram do servidor hoje. Ver `emailToday` na API. */
  email: { today: number; failedToday: number; yesterday: number; byKind: { kind: string; count: number }[] };
  alerts: Alert[];
};

export type AcademyStatus = "SETUP" | "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

export type Academy = {
  id: string;
  slug: string;
  name: string;
  status: AcademyStatus;
  createdAt: string;
  trialEndsAt: string | null;
  /** O plano em vigor. `null` num clube criado sem plano nenhum. */
  planId: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  mrrCents: number;
  /**
   * A mensalidade acordada com este clube. `null` é o caso normal: vale o plano.
   *
   * Vem na lista porque é daqui que o diálogo do plano abre — sem ela, reabrir a
   * janela propunha o preço de tabela e a gravação seguinte desfazia o acordo.
   */
  priceCents: number | null;
  athletes: number;
  staff: number;
  guardians: number;
  teams: number;
  onboarding: { done: number; total: number; percent: number };
  /**
   * Quem está a usar o produto **agora**, separado por lado.
   *
   * `staff` é a consola, `family` é a app dos pais. São leituras diferentes: dez
   * pais ao domingo é adopção, dez dirigentes à terça é uso. Vem da memória do
   * servidor e não de uma tabela — ver `presence.service.ts`.
   */
  online: { total: number; staff: number; family: number };
  lastActivity: string | null;
  /**
   * O emblema do clube, quando já o carregou. Vive num bucket público — é o
   * mesmo endereço que vai no manifest da app das famílias.
   */
  logoUrl: string | null;
  /** A cor do clube. Serve de fundo ao monograma de quem ainda não tem emblema. */
  signalColor: string;
};

export type SeriesPoint = { month: string; new_academies: number; cancelled: number; active_end: number };

/**
 * Uma semana de trabalho feito, em toda a plataforma.
 *
 * `people` são pessoas distintas que fizeram alguma coisa — fechar presenças,
 * escrever um comunicado, preencher uma ficha de jogo. Não é quem abriu a app:
 * um separador aberto não é trabalho. Ver a migração `actividade_da_plataforma`
 * para a lista exacta do que conta.
 */
export type ActivityPoint = { week: string; people: number; academies: number; actions: number };

export type Plan = {
  id: string;
  name: string;
  /** A frase que explica o plano numa linha. */
  tagline: string | null;
  amountCents: number;
  perAthleteCents: number;
  includedAthletes: number;
  trialDays: number;
  /** O que traz, pela ordem em que se lê. */
  features: string[];
  /**
   * O que **não** traz.
   *
   * Dito em voz alta: um plano que só lista o que inclui obriga quem compara a
   * descobrir a ausência depois de assinar.
   */
  excludes: string[];
  isRecommended: boolean;
};

/**
 * A ficha de um clube — `GET /academies/:id`.
 *
 * Contagens e agregados. Nenhuma linha de domínio: nem nomes de atletas, nem
 * contactos. Os nomes de equipas entram porque não são de ninguém e são o que dá
 * forma aos números. Ver `academyDetail` na API.
 */
export type AcademyDetail = {
  id: string;
  slug: string;
  name: string;
  status: AcademyStatus;
  createdAt: string;
  trialEndsAt: string | null;
  logoUrl: string | null;
  signalColor: string | null;
  plan: string | null;
  planId: string | null;
  subscriptionStatus: string | null;
  people: {
    staff: number;
    coaches: number;
    guardians: number;
    athletes: number;
    athletesLeft: number;
    teams: number;
  };
  staffByRole: { role: string; count: number }[];
  /** Quantas famílias têm mesmo a app: visita registada **ou** push ligado. */
  app: { installed: number; total: number; percent: number };
  online: { total: number; staff: number; family: number };
  lastActivity: string | null;
  /**
   * Com quem se falou primeiro: a conta de staff mais antiga do clube — a que
   * nasceu do convite de criação. `accepted: false` quando ninguém o resgatou
   * ainda e o nome e o email vêm do próprio convite.
   */
  contact: { name: string; email: string; title: string | null; since: string; accepted: boolean } | null;
  teamsBreakdown: { id: string; name: string; athletes: number; coaches: number }[];
  /** Oito semanas de folhas de presença fechadas, da mais antiga para a actual. */
  activity: { week: string; sessions: number }[];
  /** As mensalidades que o **clube** cobra às famílias — não as nossas. */
  billing: {
    period: string;
    issued: number;
    paid: number;
    billedCents: number;
    collectedCents: number;
    periods: number;
  };
};

export type AuditEntry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  admin: { name: string; email: string } | null;
};

export const STATUS_LABEL: Record<AcademyStatus, string> = {
  SETUP: "Em montagem",
  TRIAL: "Avaliação",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento falhado",
  CANCELLED: "Cancelada",
};

/* -------------------------------------------------------------------------- */
/* Contactos                                                                   */
/* -------------------------------------------------------------------------- */

export type ContactStatus = "NOVO" | "CONTACTADO" | "SEM_RESPOSTA" | "REUNIAO" | "PROPOSTA" | "CLIENTE" | "PERDIDO";
export type ContactChannel = "CHAMADA" | "EMAIL" | "WHATSAPP" | "REUNIAO" | "MENSAGEM" | "OUTRO";

export type ContactTouch = {
  id: string;
  channel: ContactChannel;
  note: string | null;
  status: ContactStatus | null;
  byName: string | null;
  happenedAt: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  club: string | null;
  role: string | null;
  status: ContactStatus;
  notes: string | null;
  owner: { id: string; name: string } | null;
  academy: { id: string; name: string; slug: string } | null;
  lastContactAt: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  touchCount: number;
  lastTouch: { channel: ContactChannel; note: string | null; happenedAt: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Só no detalhe — a lista traz apenas `lastTouch`. */
  touches?: ContactTouch[];
};

/**
 * A ordem importa: é a ordem do funil, e é a ordem por que os filtros aparecem.
 * `CLIENTE` e `PERDIDO` no fim porque são fim de linha — deixam de gerar trabalho.
 */
export const CONTACT_STATUS: ContactStatus[] = ["NOVO", "CONTACTADO", "SEM_RESPOSTA", "REUNIAO", "PROPOSTA", "CLIENTE", "PERDIDO"];

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  NOVO: "Por contactar",
  CONTACTADO: "Contactado",
  SEM_RESPOSTA: "Sem resposta",
  REUNIAO: "Reunião marcada",
  PROPOSTA: "Proposta enviada",
  CLIENTE: "Cliente",
  PERDIDO: "Perdido",
};

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  CHAMADA: "Chamada",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  REUNIAO: "Reunião",
  MENSAGEM: "Mensagem",
  OUTRO: "Outro",
};

export type CalendarFeed = { url: string; reachable: boolean; googleAddUrl: string };

/* ---------------------------------------------------------------------------- */
/* Contas da plataforma                                                          */
/* ---------------------------------------------------------------------------- */

/**
 * O dinheiro do negócio: o que entra, o que sai, e o que aí vem.
 *
 * Os valores viajam sempre em cêntimos e **com IVA**; o líquido vem calculado
 * pela API onde interessa (é o líquido que paga os custos). Ver
 * `platform-finance.service.ts`.
 */
export type FinanceKind = "INCOME" | "EXPENSE";
export type FinanceStatus = "COMPLETED" | "PENDING";
export type Recurrence = "MONTHLY" | "ANNUAL";

export type Transacao = {
  id: string;
  kind: FinanceKind;
  status: FinanceStatus;
  description: string;
  amountCents: number;
  vatRate: number;
  occurredAt: string;
  dueDate: string | null;
  category: string | null;
  counterparty: string | null;
  notes: string | null;
  academyId: string | null;
  academy: { id: string; name: string; slug: string } | null;
  /** Quando veio de uma mensalidade paga. Um ganho destes não se edita à mão. */
  noticeId: string | null;
  recurringId: string | null;
  recurring: { id: string; description: string } | null;
};

export type GastoFixo = {
  id: string;
  description: string;
  amountCents: number;
  vatRate: number;
  recurrence: Recurrence;
  dayOfMonth: number;
  month: number | null;
  category: string | null;
  counterparty: string | null;
  notes: string | null;
  startsOn: string;
  endsOn: string | null;
  isActive: boolean;
};

export type MensalidadeDoClube = {
  id: string;
  academyId: string;
  academy: { id: string; name: string; slug: string };
  periodStart: string;
  periodEnd: string;
  issuedOn: string;
  dueOn: string;
  amountCents: number;
  planName: string;
  billingPeriod: "MONTHLY" | "ANNUAL";
  sentAt: string | null;
  paidAt: string | null;
  paidNote: string | null;
};

export type ContasResumo = {
  mes: {
    ganhosCents: number;
    ganhosLiquidosCents: number;
    gastosCents: number;
    gastosLiquidosCents: number;
    saldoLiquidoCents: number;
  };
  ano: { ganhosLiquidosCents: number; gastosLiquidosCents: number; saldoLiquidoCents: number };
  porReceber: { count: number; cents: number; vencidas: number };
  settings: { openingBalanceCents: number; subscriptionVatRate: number; subscriptionVatIncluded: boolean };
};

export type PrevisaoMes = {
  /** `AAAA-MM` */
  mes: string;
  receitaCents: number;
  /** Só com a simulação ligada. Vem à parte para o ecrã a poder marcar. */
  receitaSimuladaCents: number;
  gastosCents: number;
  saldoCents: number;
  acumuladoCents: number;
  clubes: number;
};

export type Previsao = {
  meses: PrevisaoMes[];
  fixos: { mensalCents: number; anualCents: number; porMesCents: number };
  clubes: number;
  /** O primeiro mês em que o contratado cobre os gastos. Nulo quando nenhum cobre. */
  cobreEm: string | null;
};

export type ContasSettings = {
  id: string;
  openingBalanceCents: number;
  openingBalanceAt: string | null;
  subscriptionVatRate: number;
  subscriptionVatIncluded: boolean;
};
