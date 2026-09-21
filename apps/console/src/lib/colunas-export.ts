import type { ColunaExport } from "@/lib/exportar";
import { dataISO } from "@/lib/exportar";
import { EXPORT_COLUMNS, sexoParaFolha } from "@/lib/member-sheet";
import { ladoParaFolha } from "@/lib/import";
import { STATUS_LABEL, type MemberRow } from "@/lib/members";
import { DEPARTMENT_LABEL, type Athlete, type Guardian, type StaffMember, type Team } from "@/data/types";
import { athleteById, sportById, teamById } from "@/lib/api";
import { teamAgeLabel } from "@/lib/team-age";
import { STAGE_LABEL, ageOf as idadeDe, type ProspectRow } from "@/lib/scouting";

/**
 * As colunas de cada lista exportada.
 *
 * ## Porquê num ficheiro só
 *
 * Porque são listas de pessoas, e as perguntas que um clube lhes faz são as
 * mesmas: quem é, como se contacta, a que pertence. Tê-las lado a lado é o que
 * impede que a lista de atletas saia com "Telemóvel" e a de famílias com
 * "Contacto".
 *
 * ## Duas destas listas fecham um ciclo
 *
 * **Sócios** e **atletas** saem com exactamente as colunas que a importação lê,
 * e por isso as suas cabeças vêm de lá (`EXPORT_COLUMNS`, `COLUMNS`) e não
 * estão escritas aqui. É o que permite o que os clubes pediram: exportar,
 * corrigir um campo em toda a gente numa folha de cálculo, e voltar a carregar.
 *
 * Staff e famílias não têm importação — e não devem ter: uma folha de cálculo
 * que cria contas e atribui cargos é uma porta que não vale a pena abrir. Essas
 * duas saem com as colunas que servem para o que os clubes fazem com elas: a
 * acta, o seguro, a reunião de pais.
 */

/* -------------------------------------------------------------------------- */
/* Sócios                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O livro de sócios, com as colunas da importação.
 *
 * Os cabeçalhos e a ordem vêm de `EXPORT_COLUMNS`; o que está aqui é só como se
 * tira cada valor da linha. Assim, renomear uma coluna muda os dois lados de
 * uma vez e o ida-e-volta não parte em silêncio.
 */
const VALOR_SOCIO: Record<string, (m: MemberRow) => string | number | null | undefined> = {
  number: (m) => m.number,
  name: (m) => m.name,
  tier: (m) => m.tier?.name,
  // Sem o indicativo: a importação lê nove dígitos, e "+351 912..." não passa.
  phone: (m) => m.phone,
  email: (m) => m.email,
  birthdate: (m) => dataISO(m.birthdate),
  address: (m) => m.address,
  postalCode: (m) => m.postalCode,
  city: (m) => m.city,
  documentNumber: (m) => m.documentNumber,
  taxId: (m) => m.taxId,
  sex: (m) => sexoParaFolha(m.sex),
};

export const COLUNAS_EXPORT_SOCIOS: ColunaExport<MemberRow>[] = [
  ...EXPORT_COLUMNS.map((c) => ({
    header: c.header,
    largura: c.largura,
    valor: VALOR_SOCIO[c.key],
  })),
  /*
   * O estado vai no fim e **não** é lido de volta pela importação como as
   * outras: é informação para quem lê a folha, não para a reescrever. Um clube
   * que exporte para conferir o livro quer ver quem está suspenso.
   */
  { header: "Estado", valor: (m) => STATUS_LABEL[m.status], largura: 12 },
];

/* -------------------------------------------------------------------------- */
/* Atletas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * O plantel, com as colunas da importação de atletas — pela mesma ordem.
 *
 * A **equipa** sai pelo nome e não pelo id, porque é assim que a importação a
 * lê e é a única forma de a folha ser legível por uma pessoa.
 */
export const COLUNAS_EXPORT_ATLETAS: ColunaExport<Athlete>[] = [
  { header: "Nome", valor: (a) => a.name, largura: 28 },
  { header: "Data de nascimento", valor: (a) => dataISO(a.birthdate), largura: 18 },
  { header: "Equipa", valor: (a) => teamById(a.teamId)?.name, largura: 20 },
  { header: "NIF", valor: (a) => a.taxId, largura: 12 },
  { header: "Email", valor: (a) => a.email, largura: 26 },
  { header: "Posição", valor: (a) => a.position, largura: 16 },
  { header: "Número", valor: (a) => a.squadNumber, largura: 10 },
  { header: "Ficha médica válida até", valor: (a) => dataISO(a.medicalValidUntil), largura: 22 },
  { header: "Altura (cm)", valor: (a) => a.heightCm, largura: 12 },
  { header: "Peso (kg)", valor: (a) => a.weightKg, largura: 12 },
  { header: "Lado dominante", valor: (a) => ladoParaFolha(a.dominantSide), largura: 16 },
  /*
   * O estado fica no fim, fora das colunas da importação — que não o lê. Uma
   * folha exportada com os que saíram serve para conferir; reimportá-la não os
   * traz de volta, e não deve.
   */
  { header: "Estado", valor: (a) => ESTADO_ATLETA[a.status], largura: 10 },
];

const ESTADO_ATLETA: Record<Athlete["status"], string> = {
  active: "Activo",
  paused: "Em pausa",
  left: "Saiu",
};

/* -------------------------------------------------------------------------- */
/* Staff                                                                       */
/* -------------------------------------------------------------------------- */

export const COLUNAS_EXPORT_STAFF: ColunaExport<StaffMember>[] = [
  { header: "Nome", valor: (s) => s.name, largura: 28 },
  { header: "Cargo", valor: (s) => s.title, largura: 22 },
  { header: "Departamento", valor: (s) => DEPARTMENT_LABEL[s.department], largura: 22 },
  { header: "Email", valor: (s) => s.email, largura: 26 },
  { header: "Telemóvel", valor: (s) => s.phone, largura: 14 },
  /* As equipas pelo nome, separadas por vírgula: uma pessoa pode ter várias e
     uma coluna por equipa dava uma folha diferente em cada clube. */
  {
    header: "Equipas",
    valor: (s) => s.teamIds.map((id) => teamById(id)?.name).filter(Boolean).join(", "),
    largura: 30,
  },
  { header: "Desde", valor: (s) => dataISO(s.since), largura: 12 },
  { header: "Estado", valor: (s) => (s.isActive ? "Activo" : "Inactivo"), largura: 10 },
];

/* -------------------------------------------------------------------------- */
/* Famílias                                                                    */
/* -------------------------------------------------------------------------- */

export const COLUNAS_EXPORT_FAMILIAS: ColunaExport<Guardian>[] = [
  { header: "Nome", valor: (g) => g.name, largura: 28 },
  { header: "Relação", valor: (g) => g.relation, largura: 14 },
  { header: "Email", valor: (g) => g.email, largura: 26 },
  { header: "Telemóvel", valor: (g) => g.phone, largura: 14 },
  /*
   * Os educandos numa coluna, pelo nome.
   *
   * É a razão pela qual um clube exporta esta lista: o contacto **e** de quem.
   * Uma lista de encarregados sem os filhos ao lado não diz a quem telefonar
   * quando falta um miúdo.
   */
  {
    header: "Educandos",
    valor: (g) => g.athleteIds.map((id) => athleteById(id)?.name).filter(Boolean).join(", "),
    largura: 34,
  },
  {
    header: "Equipas",
    valor: (g) =>
      [
        ...new Set(
          g.athleteIds
            .map((id) => athleteById(id))
            .map((a) => (a ? teamById(a.teamId)?.name : undefined))
            .filter(Boolean),
        ),
      ].join(", "),
    largura: 24,
  },
  { header: "App instalada", valor: (g) => (g.appInstalled ? "Sim" : "Não"), largura: 14 },
  { header: "Estado", valor: (g) => (g.isActive ? "Activo" : "Inactivo"), largura: 10 },
];

/* -------------------------------------------------------------------------- */
/* Equipas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * As equipas da época, com o que um clube precisa de ter em papel: quem treina,
 * quantos são, quando treinam e quanto custa.
 *
 * Não fecha ciclo com a importação de equipas — essa lê três colunas (nome,
 * modalidade, idade) e nasceu para arrancar um clube, não para o manter. Aqui
 * interessa o retrato.
 */
export const COLUNAS_EXPORT_EQUIPAS: ColunaExport<Team>[] = [
  { header: "Equipa", valor: (t) => t.name, largura: 24 },
  { header: "Modalidade", valor: (t) => sportById(t.sportId)?.name, largura: 18 },
  { header: "Escalão", valor: (t) => teamAgeLabel(t.maxAge), largura: 12 },
  { header: "Época", valor: (t) => t.season, largura: 12 },
  { header: "Treinador", valor: (t) => t.headCoach?.name ?? t.coaches.map((c) => c.name).join(", "), largura: 26 },
  { header: "Atletas", valor: (t) => t.athleteIds.length, largura: 10 },
  { header: "Duração do jogo (min)", valor: (t) => t.matchMinutes, largura: 20 },
  {
    header: "Treinos",
    valor: (t) => t.schedule.map((h) => `${DIAS[h.weekday]} ${h.start}-${h.end} ${h.venue}`).join(" · "),
    largura: 40,
  },
  { header: "Competições", valor: (t) => t.competitions.map((c) => c.label).join(", "), largura: 30 },
  /* O preço só sai preenchido a quem tem `billing:read` — o servidor manda-o a
     nulo aos outros, e uma célula vazia é a resposta certa para quem não o pode
     ver. Ver `teams()` na API. */
  { header: "Mensalidade (€)", valor: (t) => (t.feeCents == null ? "" : t.feeCents / 100), largura: 16 },
];

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/* -------------------------------------------------------------------------- */
/* Scouting                                                                    */
/* -------------------------------------------------------------------------- */

export const COLUNAS_EXPORT_PROSPECTS: ColunaExport<ProspectRow>[] = [
  { header: "Nome", valor: (p) => p.name, largura: 28 },
  { header: "Data de nascimento", valor: (p) => dataISO(p.birthdate), largura: 18 },
  { header: "Idade", valor: (p) => idadeDe(p.birthdate), largura: 8 },
  { header: "Etapa", valor: (p) => STAGE_LABEL[p.stage], largura: 16 },
  { header: "Posição", valor: (p) => p.position, largura: 16 },
  { header: "Modalidade", valor: (p) => sportById(p.sportId)?.name, largura: 16 },
  { header: "Clube actual", valor: (p) => p.currentClub, largura: 24 },
  { header: "Equipa actual", valor: (p) => p.currentTeam, largura: 20 },
  { header: "Responsável", valor: (p) => p.owner, largura: 22 },
  { header: "Observações", valor: (p) => p.observations, largura: 14 },
  { header: "Última observação", valor: (p) => dataISO(p.lastObservedAt), largura: 18 },
];
