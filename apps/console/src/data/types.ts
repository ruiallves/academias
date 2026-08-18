/**
 * Modelo do domínio, lado do cliente.
 *
 * Espelha `apps/api/prisma/schema.prisma`. Nada aqui é específico de futebol:
 * `Sport` é configuração da academia, não um enum.
 */

import type { Role } from "@/lib/permissions";

export type Sport = {
  id: string;
  name: string;
  /** Vazio em desportos sem posições (natação, atletismo) — a UI adapta-se por ausência. */
  positions: string[];
  /**
   * Como esta modalidade chama o lado dominante: "Pé dominante" no futebol,
   * "Mão dominante" no basquetebol, ausente na natação. É configuração e não um
   * campo fixo chamado `peDominante` — senão a ficha de um nadador passava a ter
   * um campo que não faz sentido nenhum.
   */
  dominantSideLabel?: string;
  /** Duração normal de um jogo, em minutos. Serve para ler "62 de 90" na ficha. */
  matchMinutes?: number;
  /**
   * Competências avaliadas nesta modalidade. Configuração e não uma lista fixa no
   * código: a natação avalia técnica e resistência, o futebol avalia táctica.
   */
  skills?: string[];
};

export type Academy = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  signalColor: string;
  city: string;
  sports: Sport[];
};

export type Team = {
  id: string;
  name: string;
  sportId: string;
  ageGroup: string;
  season: string;
  coachIds: string[];
  athleteIds: string[];
  /** Dias da semana (0 = domingo) e hora do treino regular. */
  schedule: { weekday: number; start: string; end: string; venue: string }[];
};

/**
 * As áreas de uma academia. Serve para agrupar o staff e nada mais — quem pode
 * fazer o quê continua a vir do papel de permissões, não daqui.
 */
export type StaffDepartment = "direction" | "technical" | "clinical" | "operations";

export const DEPARTMENT_LABEL: Record<StaffDepartment, string> = {
  direction: "Direção",
  technical: "Equipa técnica",
  clinical: "Departamento clínico",
  operations: "Secretaria e operações",
};

/**
 * Uma pessoa que trabalha na academia.
 *
 * Duas coisas separadas de propósito, e é a distinção que faz este modelo aguentar
 * o que vier:
 *
 * - `role` é o **papel de permissões** — o que a pessoa pode fazer no produto.
 *   É um enum fechado porque as permissões têm de ser verificáveis.
 * - `title` é o **cargo** — o que a pessoa faz na academia. Texto livre, porque
 *   "Diretor desportivo", "Nutricionista", "Preparador físico" e "Técnico de
 *   equipamentos" são uma lista sem fim, e um enum aqui só criaria trabalho de
 *   migração de cada vez que uma academia inventasse um cargo.
 *
 * Um nutricionista e um fisioterapeuta partilham `role: "MEDICAL"` e têm títulos
 * diferentes. É isso que evita ter de criar uma permissão nova por cada profissão.
 */
export type StaffMember = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  title: string;
  department: StaffDepartment;
  /** Só para quem trabalha com equipas. Vazio na direção e no departamento clínico. */
  teamIds: string[];
  since: string;
  isActive: boolean;
  /** Excepções de acesso guardadas no servidor — a diferença para o papel. */
  grants?: string[];
  revokes?: string[];
};

export type Guardian = {
  id: string;
  name: string;
  email: string;
  phone: string;
  relation: "Mãe" | "Pai" | "Encarregado";
  athleteIds: string[];
  /** Se a PWA está instalada. É a métrica de adopção que nos distingue. */
  appInstalled: boolean;
};

/** Neutro de propósito: serve o pé no futebol e a mão no basquetebol. */
export type DominantSide = "Direito" | "Esquerdo" | "Ambidestro";

export type Athlete = {
  id: string;
  name: string;
  birthdate: string;
  teamId: string;
  position?: string;
  guardianIds: string[];
  joinedAt: string;
  status: "active" | "paused" | "left";
  /** Ficha médica — a validade é uma das coisas que geram alertas. */
  medicalValidUntil: string;

  /** Ausente na maioria — as academias não têm fotografia de toda a gente. */
  photoUrl?: string;
  heightCm?: number;
  weightKg?: number;
  /** O rótulo vem de `Sport.dominantSideLabel`; aqui só o valor. */
  dominantSide?: DominantSide;
  /** Número de camisola, quando a modalidade os usa. */
  squadNumber?: number;

  /** Boletim clínico — histórico, não só a validade do exame médico. */
  clinical?: ClinicalEntry[];
};

/**
 * O departamento clínico não é só lesões: nutrição e psicologia são
 * acompanhamento contínuo e vivem no mesmo boletim, porque é a mesma pessoa a
 * olhar para o atleta inteiro.
 */
export type ClinicalKind = "injury" | "exam" | "physio" | "nutrition" | "psychology" | "note";

/**
 * O que a entrada faz à disponibilidade do atleta.
 *
 * `out` é a baixa — o atleta não treina nem joga. `limited` é o trabalho
 * condicionado: treina, não compete. `none` é acompanhamento que não afasta
 * ninguém, que é o caso da maioria das consultas de nutrição.
 */
export type ClinicalImpact = "none" | "limited" | "out";

/**
 * `done` é um registo do que aconteceu; `scheduled` é um agendamento futuro —
 * exame, consulta de nutrição, reavaliação. É a mesma entidade porque é a mesma
 * coisa em dois momentos: o agendamento de hoje é o registo de amanhã, e separá-los
 * em duas tabelas obrigaria a copiar dados de uma para a outra na consulta.
 */
export type ClinicalStatus = "done" | "scheduled" | "cancelled";

export type ClinicalEntry = {
  id: string;
  /** `2026-03-14` — quando aconteceu, ou quando vai acontecer. */
  date: string;
  status?: ClinicalStatus;
  /** Hora, só em agendamentos. `14:30` */
  time?: string;
  /** Onde — clínica, sede da academia. Só em agendamentos. */
  location?: string;
  kind: ClinicalKind;
  title: string;
  detail?: string;
  impact: ClinicalImpact;
  /** Retoma prevista. É o que o treinador precisa de saber para planear. */
  expectedReturn?: string;
  /** Dias de paragem previstos; ausente numa entrada que não afasta o atleta. */
  outDays?: number;
  /** Alta clínica. Enquanto for nulo e `impact` não for "none", o atleta está afectado. */
  clearedOn?: string;
  /** Quem registou — o boletim tem de ser rastreável. */
  authorId?: string;
};

/** `void` = mensalidade anulada pela direção (bolsa, atleta que saiu) — nem devida nem paga. */
export type FeeStatus = "paid" | "pending" | "overdue" | "processing" | "void";

export type Fee = {
  id: string;
  athleteId: string;
  /** `2026-08` */
  period: string;
  amountCents: number;
  dueDate: string;
  status: FeeStatus;
  paidAt?: string;
  method?: "MB Way" | "Multibanco" | "Cartão" | "Transferência";
  /** Referência euPago, quando gerada. */
  reference?: string;
};

export type AbsenceKind = "absent" | "justified" | "late";

/**
 * Presenças de um treino — guardadas como **lista de faltas**, não de presenças.
 *
 * É como o treinador trabalha: num plantel de dezoito, faltam dois. Marcar os
 * dois é um gesto; marcar os dezasseis presentes é trabalho a fingir. Guardar a
 * excepção em vez da norma também torna o registo mais honesto — um treino sem
 * ninguém na lista significa "estiveram todos", e não "ninguém foi verificado".
 * O ecrã continua a chamar-se "Registar presenças", que é como se diz.
 */
export type SessionAttendance = {
  /** `note` guarda o motivo de uma falta **justificada** — vazio nas outras. */
  absences: { athleteId: string; kind: AbsenceKind; note?: string }[];
  recordedAt: string;
};

export type TrainingSession = {
  id: string;
  teamId: string;
  /** ISO com hora local. */
  start: string;
  end: string;
  venue: string;
  coachId?: string;
  /**
   * O nome de quem dá o treino, tal como o servidor o devolve.
   *
   * Vem com a sessão e não se procura na lista de staff, porque um treinador não
   * tem `staff:read` — essa lista chega-lhe vazia, e procurar lá dava sempre
   * "sem treinador" para os treinos dele próprio.
   */
  coachName?: string;
  status: "scheduled" | "done" | "cancelled";
  /** Nulo enquanto o treinador não registar presenças. */
  attendance?: SessionAttendance;
};

export type Evaluation = {
  id: string;
  athleteId: string;
  coachId: string;
  period: string;
  status: "draft" | "published";
  updatedAt: string;
  /** 1–5 por competência. As competências vêm do desporto, não do código. */
  scores: Record<string, number>;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  /** Rótulo do público: "Geral", "Pais" ou "Treinadores". */
  audience: string;
  publishedAt: string;
  authorId: string;
  /** O nome de quem publicou, tal como o servidor o devolve. */
  authorName?: string;
  /** Quantas notificações saíram e quantas foram lidas. */
  reach: number;
  read: number;
};

/** Uma linha de "Precisa de atenção". Um facto, um verbo, um destino. */
export type AttentionItem = {
  id: string;
  severity: "risk" | "warn" | "info";
  title: string;
  detail: string;
  to: string;
  action: string;
};
