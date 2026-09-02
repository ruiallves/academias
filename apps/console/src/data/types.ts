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
  /**
   * O símbolo do clube.
   *
   * Vazio significa "usa o monograma" — as duas letras do nome curto, que é o
   * que a consola, a app e a landing desenham quando não há emblema. Atravessa o
   * produto todo: o ícone que o pai instala no telemóvel sai daqui.
   */
  logoUrl: string;
  city: string;
  /**
   * Em que fase o clube está com o produto.
   *
   * `TRIAL` é a única que a consola lê para alguma coisa — o resto (SETUP,
   * ACTIVE, CANCELLED…) já decide o que se pode fazer no servidor; aqui só
   * interessa saber se há um período experimental a correr, para o mostrar.
   */
  status: string;
  /** Quando o período experimental acaba. `null` fora de período experimental. */
  trialEndsAt: string | null;
  /** O dia do mês em que as mensalidades vencem. */
  billingDueDay: number;
  /** Os meses (1–12) em que o clube cobra. Vazio antes de carregar. */
  billingMonths: number[];
  /** Quando a academia nasceu — o proxy do início do período experimental. */
  createdAt: string;
  sports: Sport[];
  /**
   * A página pública de adesão a sócio, escrita pelo clube.
   *
   * Vazios significam "usa o que o produto traz por omissão" — a página nunca
   * aparece muda a quem ainda não escreveu nada.
   */
  membershipHeadline: string;
  membershipIntro: string;
  membershipPoints: string[];
};

export type Team = {
  id: string;
  name: string;
  sportId: string;
  /**
   * A idade máxima da equipa: 11 num "Sub-11". 99 é "sem limite".
   *
   * Substituiu `ageGroup`, o escalão em texto. Eram a mesma coisa dita duas
   * vezes — toda a equipa se chamava "Sub-11 Futebol" e tinha "Sub-11" ao lado —
   * e o texto era uma má base para decidir convocatórias. Ver `teamAgeLabel`
   * para o que se mostra, e `birthdateFloor` no servidor para o que decide.
   */
  maxAge: number;
  season: string;
  coachIds: string[];
  /**
   * Quem treina esta equipa, com o nome à frente.
   *
   * Os nomes vêm com a equipa e não se vão buscar à lista de staff, porque essa
   * exige `staff:read` — e um treinador não a tem. Resolver o nome por
   * `coachById` dava-lhe uma equipa "sem treinador" na cara dele. Quem treina uma
   * equipa é parte da equipa, não informação de recursos humanos: a app da
   * família já o mostra pela mesma razão.
   */
  coaches: { id: string; name: string; title: string }[];
  athleteIds: string[];
  /** Dias da semana (0 = domingo) e hora do treino regular. */
  schedule: { weekday: number; start: string; end: string; venue: string }[];
  /**
   * As provas que a equipa disputa esta época.
   *
   * É o que o calendário oferece ao marcar um jogo, e o que a folha de
   * convocatória acaba por imprimir. Vem do catálogo do clube, sem as
   * arquivadas — uma prova que acabou continua ligada aos jogos que teve, mas
   * não aparece onde se escolhe para marcar um jogo novo.
   */
  competitions: { id: string; label: string }[];
  /** O preço por omissão da equipa, em cêntimos. `null` sem `billing:read` ou por configurar. */
  feeCents: number | null;
};

/**
 * As áreas de uma academia. Serve para agrupar o staff e nada mais — quem pode
 * fazer o quê continua a vir do papel de permissões, não daqui.
 */
export type StaffDepartment = "direction" | "technical" | "clinical" | "scouting" | "operations";

export const DEPARTMENT_LABEL: Record<StaffDepartment, string> = {
  direction: "Direção",
  technical: "Equipa técnica",
  clinical: "Departamento clínico",
  scouting: "Departamento de scouting",
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
  /** A fotografia, como link assinado com prazo. Ausente quando não há nenhuma. */
  photoUrl?: string;
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
  /** O papel da academia atribuído a esta pessoa. Nulo = os valores do papel-base. */
  roleId?: string | null;
  roleName?: string | null;
};

export type Guardian = {
  id: string;
  name: string;
  email: string;
  phone: string;
  relation: "Mãe" | "Pai" | "Encarregado";
  /** `id` é o `membershipId` — é ele que se desactiva. */
  isActive: boolean;
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
  /**
   * NIF. É com ele e a data de nascimento que a família se liga a este atleta ao
   * instalar a app — ver `FamilyInviteDialog`. Ausente quando ninguém o preencheu,
   * ou quando quem está a ler não tem `family:read`.
   */
  taxId?: string;
  teamId: string;
  position?: string;
  guardianIds: string[];
  joinedAt: string;
  status: "active" | "paused" | "left";
  /**
   * Até quando o exame médico é válido. **`null` quando não há nenhum.**
   *
   * Era `string`, e o store mapeava a ausência para `""` — uma data vazia que
   * `new Date("")` transforma em `Invalid Date` e que atravessava o produto
   * inteiro a fingir que era uma data. Um atleta inscrito sem exame (o caso
   * normal: inscreve-se primeiro, o exame vem depois) fazia a lista de atletas
   * rebentar no `render` de uma coluna.
   *
   * `null` obriga cada ecrã a decidir o que dizer — "sem ficha médica" é uma
   * informação, e uma data inventada não é.
   */
  medicalValidUntil: string | null;

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
  /**
   * Não é a mensalidade do mês: é uma cobrança avulsa — o equipamento, o
   * torneio, a viagem. Vive na mesma tabela e no mesmo período porque do lado
   * da família é a mesma coisa (ver `ChargeKind` no `schema.prisma`); o que
   * muda é o rótulo, e é isto que o diz.
   */
  extra: boolean;
  /** O que se cobrou. Só nas avulsas — o título de uma mensalidade é o mês. */
  title?: string;
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
  /** Onde a equipa se equipa. Ausente quando a academia não os gere. */
  dressingRoom?: string;
  coachId?: string;
  /**
   * O nome de quem dá o treino, tal como o servidor o devolve.
   *
   * Vem com a sessão e não se procura na lista de staff, porque um treinador não
   * tem `staff:read` — essa lista chega-lhe vazia, e procurar lá dava sempre
   * "sem treinador" para os treinos dele próprio.
   */
  coachName?: string;
  /** O nome da equipa, vindo com o treino. Ver `teamName` no evento. */
  teamName?: string;
  /**
   * Este treino é de uma equipa minha?
   *
   * O calendário passou a mostrar o clube todo — um treinador precisa de saber
   * quando o campo está ocupado. O que é dele continua a ser só o dele: as
   * presenças, o registo, a edição. É o servidor que o decide (ver
   * `inTeamScope`); isto é o que ele responde, para a interface não ter de
   * adivinhar a partir do âmbito da sessão.
   */
  mine?: boolean;
  /**
   * Marcado, dado ou desmarcado.
   *
   * **`done` não chega da API.** O servidor cria os treinos em `SCHEDULED` e
   * nunca os passa a `DONE` — nem quando a hora passa, nem quando as presenças
   * são registadas. O valor fica aqui porque o enum do Prisma o tem e um dia
   * pode começar a ser escrito; até lá, quem quiser saber se um treino **já
   * aconteceu** pergunta ao relógio (`start <= agora` e não cancelado), nunca a
   * este campo.
   *
   * Custou uma vez: `unrecordedSessions` exigia `done`, e por isso um treino
   * marcado para ontem não aparecia em lado nenhum das Presenças.
   */
  status: "scheduled" | "done" | "cancelled";
  /** Nulo enquanto o treinador não registar presenças. Nunca vem de equipas que não são minhas. */
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
