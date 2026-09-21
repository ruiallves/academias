import { exportarPerfil, type Seccao } from "@/lib/perfil-pdf";
import { lerHistorico, nomeDoCampo, valorDoCampo, type TipoDePerfil } from "@/lib/historico";
import {
  athleteAttendanceSummary,
  feeHistory,
  guardiansOf,
  sportById,
  teamById,
} from "@/lib/api";
import { AVAILABILITY_LABEL, availabilityOf, clinicalOf, IMPACT_LABEL, KIND_LABEL } from "@/lib/clinical";
import { dominantSideLabel, summariseSeason, type AthleteMatch } from "@/lib/athlete";
import { coachActivity, matchRecord, teamHistory } from "@/lib/staff";
import { DOC_LABEL, SEX_LABEL, STATUS_LABEL, listMemberFees, type MemberDetail } from "@/lib/members";
import { money, percent, periodLabel, shortDate } from "@/lib/format";
import { can, type Session } from "@/lib/permissions";
import { ROLE_LABEL } from "@/session";
import { DEPARTMENT_LABEL, type Athlete, type StaffMember } from "@/data/types";

/**
 * O que entra na ficha em papel de cada perfil.
 *
 * O desenho é de `perfil-pdf.ts`; aqui decide-se **o que é relevante** — que é
 * uma pergunta de produto e não de tipografia.
 *
 * ## A régua
 *
 * O papel mostra o que a pessoa que exporta já vê no ecrã, e nada mais. Cada
 * secção passa pela mesma permissão que o separador de onde vem: sem
 * `family:read` não saem contactos do encarregado, sem `clinical:read` não sai
 * diagnóstico nenhum (fica só a aptidão, que é o que um treinador precisa de
 * saber e é o que a ficha lhe mostra), sem `billing:read` não saem mensalidades.
 *
 * Isto não substitui o servidor: substitui-o é ninguém. O que estes filtros
 * evitam é o caminho fácil — exportar como forma de ver o que a consola esconde.
 *
 * ## O histórico vai junto
 *
 * A ficha em papel é uma fotografia de hoje; sem o histórico de alterações, uma
 * ficha impressa em Março e outra em Junho não explicam o que mudou pelo meio.
 * Vai no fim, e só quando o servidor o der — quem não pode ler o histórico
 * exporta a ficha sem ele, em vez de ficar sem exportação nenhuma.
 */

/** A idade em anos, como na ficha. */
function anos(iso: string): number {
  const d = new Date(iso);
  const hoje = new Date();
  let n = hoje.getFullYear() - d.getFullYear();
  const antes = hoje.getMonth() < d.getMonth() || (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate());
  return antes ? n - 1 : n;
}

const data = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-PT") : null);

/**
 * O histórico de alterações, como tabela.
 *
 * Silencioso quando não há: um 403 aqui não é um erro a mostrar a quem só queria
 * a ficha — é a resposta a uma pergunta que este documento nem precisava de
 * fazer.
 */
async function seccaoDoHistorico(tipo: TipoDePerfil, id: string): Promise<Seccao[]> {
  try {
    const linhas = await lerHistorico(tipo, id, 40);
    if (linhas.length === 0) return [];
    return [
      {
        tipo: "tabela",
        titulo: "Histórico de alterações",
        colunas: [
          { titulo: "Quando", larg: 0.17 },
          { titulo: "Campo", larg: 0.23 },
          { titulo: "Antes", larg: 0.2 },
          { titulo: "Depois", larg: 0.22 },
          { titulo: "Quem", larg: 0.18 },
        ],
        linhas: linhas.map((l) => [
          new Date(l.createdAt).toLocaleDateString("pt-PT"),
          nomeDoCampo(l.field),
          valorDoCampo(l.field, l.before),
          valorDoCampo(l.field, l.after),
          l.byName ?? "—",
        ]),
      },
    ];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Atleta                                                                      */
/* -------------------------------------------------------------------------- */

const ESTADO_ATLETA: Record<Athlete["status"], string> = {
  active: "Activo",
  paused: "Suspenso",
  left: "Saiu",
};

/*
 * O lado dominante chega em formas diferentes: o enum do servidor (`RIGHT`) e a
 * versão em minúsculas do store. No papel lê-se em português.
 */
const LADO: Record<string, string> = {
  right: "Direito", left: "Esquerdo", both: "Ambidestro",
};
const ladoEmPortugues = (v: string | undefined) => (v ? (LADO[v.toLowerCase()] ?? v) : null);

const ESTADO_MENSALIDADE: Record<string, string> = {
  paid: "Paga",
  processing: "A confirmar",
  pending: "Não paga",
  overdue: "Vencida",
  void: "Anulada",
};

export async function exportarFichaDeAtleta(athlete: Athlete, session: Session, matches: AthleteMatch[]): Promise<void> {
  const equipa = teamById(athlete.teamId);
  const modalidade = sportById(equipa?.sportId ?? "");
  const epoca = summariseSeason(athlete.id, matches);
  const assiduidade = athleteAttendanceSummary(athlete.id);
  const seccoes: Seccao[] = [];

  seccoes.push({
    tipo: "factos",
    titulo: "Identificação",
    pares: [
      ["Data de nascimento", athlete.birthdate ? `${data(athlete.birthdate)} · ${anos(athlete.birthdate)} anos` : null],
      ["Equipa", equipa?.name ?? "Sem equipa"],
      ["Modalidade", modalidade?.name],
      ["Posição", athlete.position],
      ["Número", athlete.squadNumber ? String(athlete.squadNumber) : null],
      // O NIF só vem do servidor a quem tem `family:read` — ver o tipo `Athlete`.
      ["Contribuinte", athlete.taxId],
      ["Na academia desde", data(athlete.joinedAt)],
      ["E-mail do atleta", athlete.email],
    ],
  });

  seccoes.push({
    tipo: "factos",
    titulo: "Ficha física",
    pares: [
      ["Altura", athlete.heightCm ? `${athlete.heightCm} cm` : null],
      ["Peso", athlete.weightKg ? `${String(athlete.weightKg).replace(".", ",")} kg` : null],
      [dominantSideLabel(athlete.id) ?? "Lado dominante", ladoEmPortugues(athlete.dominantSide)],
      ["Exame médico", athlete.medicalValidUntil ? `válido até ${data(athlete.medicalValidUntil)}` : "sem registo"],
      ["Aptidão", AVAILABILITY_LABEL[availabilityOf(athlete.id)]],
    ],
  });

  if (matches.length > 0) {
    seccoes.push({
      tipo: "factos",
      titulo: "A época",
      pares: [
        ["Jogos", `${epoca.played}${epoca.starts ? ` · ${epoca.starts} como titular` : ""}`],
        ["Minutos", String(epoca.minutes)],
        ["Vitórias, empates, derrotas", `${epoca.wins}V ${epoca.draws}E ${epoca.losses}D`],
        ["Média de avaliação", epoca.rating === null ? null : String(epoca.rating)],
      ],
    });
  }

  if (assiduidade.recorded > 0) {
    seccoes.push({
      tipo: "factos",
      titulo: "Assiduidade",
      pares: [
        ["Treinos com registo", String(assiduidade.recorded)],
        ["Presenças", `${assiduidade.present}${assiduidade.late ? ` · ${assiduidade.late} atrasos` : ""}`],
        ["Faltas", `${assiduidade.absent}${assiduidade.justified ? ` · ${assiduidade.justified} justificadas` : ""}`],
        ["Taxa", assiduidade.rate === null ? null : percent(assiduidade.rate)],
      ],
    });
  }

  if (can(session, "family:read")) {
    const encarregados = guardiansOf(athlete.id);
    if (encarregados.length > 0) {
      seccoes.push({
        tipo: "tabela",
        titulo: "Encarregado de educação",
        colunas: [
          { titulo: "Nome", larg: 0.34 },
          { titulo: "Laço", larg: 0.16 },
          { titulo: "Telemóvel", larg: 0.2 },
          { titulo: "E-mail", larg: 0.3 },
        ],
        linhas: encarregados.map((g) => [g.name, g.relation, g.phone, g.email]),
      });
    }
  }

  /*
   * O boletim clínico só a quem o vê no ecrã.
   *
   * `clinical:status` (o treinador) já levou a aptidão na ficha física, que é a
   * informação dele. O diagnóstico é categoria especial no RGPD e fica atrás de
   * `clinical:read` aqui pela mesma razão por que fica no `ClinicalPanel`.
   */
  if (can(session, "clinical:read")) {
    const registos = clinicalOf(athlete.id).slice(0, 20);
    if (registos.length > 0) {
      seccoes.push({
        tipo: "tabela",
        titulo: "Boletim clínico",
        colunas: [
          { titulo: "Data", larg: 0.14 },
          { titulo: "Tipo", larg: 0.16 },
          { titulo: "Registo", larg: 0.42 },
          { titulo: "Impacto", larg: 0.28 },
        ],
        linhas: registos.map((e) => [
          data(e.date) ?? "",
          KIND_LABEL[e.kind],
          [e.title, e.detail].filter(Boolean).join(" · "),
          [IMPACT_LABEL[e.impact], e.expectedReturn ? `retoma ${data(e.expectedReturn)}` : null]
            .filter(Boolean)
            .join(" · "),
        ]),
      });
    }
  }

  if (can(session, "billing:read")) {
    const mensalidades = feeHistory(athlete.id).slice(0, 14);
    if (mensalidades.length > 0) {
      seccoes.push({
        tipo: "tabela",
        titulo: "Mensalidades",
        colunas: [
          { titulo: "Período", larg: 0.3 },
          { titulo: "Valor", larg: 0.18 },
          { titulo: "Estado", larg: 0.22 },
          { titulo: "Pagamento", larg: 0.3 },
        ],
        linhas: mensalidades.map((f) => [
          f.extra ? (f.title ?? "Cobrança") : periodLabel(f.period),
          money(f.amountCents),
          ESTADO_MENSALIDADE[f.status] ?? f.status,
          [f.paidAt ? data(f.paidAt) : null, f.method].filter(Boolean).join(" · "),
        ]),
      });
    }
  }

  if (can(session, "athlete:write")) seccoes.push(...(await seccaoDoHistorico("atletas", athlete.id)));

  await exportarPerfil({
    tipo: "Ficha de atleta",
    nome: athlete.name,
    subtitulo: [equipa?.name, athlete.position].filter(Boolean).join(" · ") || null,
    distintivos: [
      ESTADO_ATLETA[athlete.status],
      athlete.squadNumber ? `N.º ${athlete.squadNumber}` : null,
      athlete.birthdate ? `${anos(athlete.birthdate)} anos` : null,
    ],
    fotoUrl: athlete.photoUrl ?? null,
    seccoes,
  });
}

/* -------------------------------------------------------------------------- */
/* Sócio                                                                       */
/* -------------------------------------------------------------------------- */

const ESTADO_QUOTA: Record<string, string> = { OPEN: "Por pagar", SETTLED: "Paga", VOID: "Anulada" };

export async function exportarFichaDeSocio(m: MemberDetail, session: Session): Promise<void> {
  const seccoes: Seccao[] = [];

  seccoes.push({
    tipo: "factos",
    titulo: "Identificação",
    pares: [
      ["Número de sócio", m.number ? String(m.number) : "por atribuir"],
      ["Estado", STATUS_LABEL[m.status]],
      ["Data de nascimento", m.birthdate ? `${data(m.birthdate)} · ${anos(m.birthdate)} anos` : null],
      ["Sexo", SEX_LABEL[m.sex]],
      [DOC_LABEL[m.documentKind], m.documentNumber],
      ["Contribuinte", m.taxId],
    ],
  });

  seccoes.push({
    tipo: "factos",
    titulo: "Contactos",
    pares: [
      ["E-mail", m.email],
      ["Telemóvel", m.phone ? `${m.phoneCountry} ${m.phone}` : null],
      ["Morada", m.address],
      ["Código postal e localidade", [m.postalCode, m.city].filter(Boolean).join(" ") || null],
      ["País", m.country],
    ],
  });

  seccoes.push({
    tipo: "factos",
    titulo: "Quotas",
    pares: [
      ["Categoria", m.tier ? `${m.tier.name}${m.tier.feeCents ? ` · ${money(m.tier.feeCents)}` : ""}` : "sem categoria"],
      ["Periodicidade", m.tier?.billing === "ANNUAL" ? "Anual" : "Mensal"],
      [m.fees.currentLabel, situacaoDaQuota(m.fees.currentStatus)],
      ["Por liquidar", m.fees.openCount ? `${m.fees.openCount} · ${money(m.fees.openCents)}` : "nada em aberto"],
      ["Última paga", m.fees.lastSettled ? (m.fees.lastSettled.label ?? m.fees.lastSettled.period) : null],
    ],
  });

  seccoes.push({
    tipo: "factos",
    titulo: "Inscrição e consentimentos",
    pares: [
      ["Inscreveu-se", `${data(m.createdAt)}${m.source === "site" ? " · pela página do clube" : ""}`],
      ["Aprovado", m.approvedAt ? `${data(m.approvedAt)}${m.approvedBy ? ` · por ${m.approvedBy}` : ""}` : null],
      ["Termos e condições", m.acceptedTermsAt ? `aceites a ${data(m.acceptedTermsAt)}` : "sem registo"],
      ["Comunicações dos parceiros", m.partnerCommsAt ? `sim, a ${data(m.partnerCommsAt)}` : "não"],
      ["Partilha com parceiros", m.partnerDataAt ? `sim, a ${data(m.partnerDataAt)}` : "não"],
      ["App do clube", m.userId ? "conta ligada" : m.inviteSentAt ? `convite enviado a ${data(m.inviteSentAt)}` : "sem conta"],
    ],
  });

  if (can(session, "billing:read")) {
    /*
     * As quotas vêm do servidor e não da ficha: o cabeçalho traz a situação
     * (em dia, em aberto), mas o livro quota a quota é outro pedido — o mesmo
     * que o separador "Quotas" faz. Uma exportação sem ele obrigava a tirar o
     * PDF e depois uma fotografia da tabela.
     */
    try {
      const quotas = (await listMemberFees(m.id)).slice(0, 24);
      if (quotas.length > 0) {
        seccoes.push({
          tipo: "tabela",
          titulo: "Quotas lançadas",
          colunas: [
            { titulo: "Período", larg: 0.26 },
            { titulo: "Valor", larg: 0.16 },
            { titulo: "Estado", larg: 0.18 },
            { titulo: "Liquidação", larg: 0.4 },
          ],
          linhas: quotas.map((q) => [
            q.label ?? q.period,
            money(q.amountCents),
            ESTADO_QUOTA[q.status] ?? q.status,
            [q.settledAt ? data(q.settledAt) : null, q.method, q.paidBy].filter(Boolean).join(" · "),
          ]),
        });
      }
    } catch {
      // Sem as quotas, a ficha sai na mesma — ver `seccaoDoHistorico`.
    }
  }

  if (m.notes?.trim()) seccoes.push({ tipo: "texto", titulo: "Notas internas", texto: m.notes });

  if (can(session, "member:write")) seccoes.push(...(await seccaoDoHistorico("socios", m.id)));

  await exportarPerfil({
    tipo: "Ficha de sócio",
    nome: m.name,
    subtitulo: m.tier?.name ?? null,
    distintivos: [
      STATUS_LABEL[m.status],
      m.number ? `Sócio n.º ${m.number}` : null,
      m.birthdate ? `${anos(m.birthdate)} anos` : null,
    ],
    fotoUrl: m.photoUrl,
    seccoes,
  });
}

function situacaoDaQuota(estado: MemberDetail["fees"]["currentStatus"]): string {
  if (estado === "settled") return "paga";
  if (estado === "open") return "por pagar";
  if (estado === "void") return "anulada";
  if (estado === "dismissed") return "dispensada";
  return "por lançar";
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                       */
/* -------------------------------------------------------------------------- */

export async function exportarFichaDeStaff(member: StaffMember, session: Session): Promise<void> {
  const seccoes: Seccao[] = [];
  const percurso = teamHistory(member.id);

  seccoes.push({
    tipo: "factos",
    titulo: "Identificação",
    pares: [
      ["Cargo", member.roleName ?? member.title],
      ["Departamento", DEPARTMENT_LABEL[member.department]],
      /*
       * A área só quando acrescenta alguma coisa: num treinador o papel e o
       * departamento dizem os dois "Equipa técnica", e repetir a mesma palavra
       * em duas células faz a ficha parecer preenchida a copiar.
       */
      [
        "Área de acesso",
        (ROLE_LABEL[member.role] ?? member.role) === DEPARTMENT_LABEL[member.department]
          ? null
          : (ROLE_LABEL[member.role] ?? member.role),
      ],
      ["Na academia desde", data(member.since)],
      ["Cargos acrescentados", member.extraRoles?.map((r) => r.name).join(", ") || null],
    ],
  });

  seccoes.push({
    tipo: "factos",
    titulo: "Contactos",
    pares: [
      ["E-mail", member.email],
      ["Telemóvel", member.phone],
    ],
  });

  if (percurso.length > 0) {
    seccoes.push({
      tipo: "tabela",
      titulo: "Percurso no clube",
      colunas: [
        { titulo: "Época", larg: 0.2 },
        { titulo: "Equipa", larg: 0.44 },
        { titulo: "Função", larg: 0.36 },
      ],
      linhas: percurso.map((s) => [s.season, s.teamName, s.title]),
    });
  }

  const actividade = coachActivity(member.id);
  const jogos = matchRecord(member.id);
  if (actividade.sessionsDone > 0 || jogos) {
    seccoes.push({
      tipo: "factos",
      titulo: "Actividade",
      pares: [
        ["Treinos dados", actividade.sessionsDone ? String(actividade.sessionsDone) : null],
        [
          "Presenças registadas",
          actividade.sessionsDone
            ? `${actividade.sessionsRecorded} de ${actividade.sessionsDone}${actividade.sessionsPending ? ` · ${actividade.sessionsPending} por fechar` : ""}`
            : null,
        ],
        ["Jogos", jogos ? `${jogos.played} · ${jogos.wins}V ${jogos.draws}E ${jogos.losses}D` : null],
        ["Golos", jogos ? `${jogos.scored} marcados · ${jogos.conceded} sofridos` : null],
      ],
    });
  }

  /*
   * O acesso é o que esta ficha tem de mais sensível e é o que se audita: quem
   * exporta uma ficha de staff costuma estar a responder a "quem é que tem isto?".
   * Só a quem pode mexer em acessos, como o separador.
   */
  if (can(session, "access:write") || can(session, "settings:write")) {
    seccoes.push({
      tipo: "factos",
      titulo: "Acesso à consola",
      pares: [
        ["Estado", member.isActive ? "Activo" : "Desactivado"],
        ["Permissões dadas à parte", member.grants?.join(", ") || "nenhuma"],
        ["Permissões retiradas à parte", member.revokes?.join(", ") || "nenhuma"],
      ],
    });
  }

  if (can(session, "access:write")) seccoes.push(...(await seccaoDoHistorico("staff", member.id)));

  await exportarPerfil({
    tipo: "Ficha de pessoal",
    nome: member.name,
    subtitulo: [member.roleName ?? member.title, DEPARTMENT_LABEL[member.department]].filter(Boolean).join(" · "),
    distintivos: [
      member.isActive ? "Acesso activo" : "Sem acesso",
      percurso.find((s) => s.current)?.teamName ?? null,
      `Desde ${shortDate(new Date(member.since))}`,
    ],
    fotoUrl: member.photoUrl ?? null,
    seccoes,
  });
}
