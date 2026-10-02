/**
 * Scouting e sócios do CD Academias.
 *
 * Nomes, clubes e números inventados. A Carla Ferreira é a sócia do guião:
 * n.º 1284, categoria Adulto, 5,00 € por mês, com as quotas pagas até outubro.
 */
import { SPORT } from "./clube.mjs";

const semAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s) => semAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* -------------------------------------------------------------------------- */
/* Scouting                                                                    */
/* -------------------------------------------------------------------------- */

/** [nome, nascimento, fase, posição, clube, escalão, última observação, observações]. */
const PROSPETOS = [
  ["Ivan Marçal", "2014-04-11", "TRIAL", "Extremo esquerdo", "GD Vale do Rio", "Sub-13", "2026-10-07", 4],
  ["Matias Proença", "2013-09-02", "OBSERVED", "Defesa central", "União da Serra", "Sub-13", "2026-10-10", 3],
  ["Noah Sequeira", "2014-01-23", "OBSERVED", "Médio centro", "FC Ribeira Nova", "Sub-13", "2026-09-26", 2],
  ["Tiago Valadares", "2012-06-30", "WATCHING", "Avançado", "Estrela do Norte", "Sub-15", "2026-09-13", 1],
  ["Rúben Catarino", "2015-03-08", "WATCHING", "Guarda-redes", "AD Monte Alto", "Sub-11", "2026-10-03", 1],
  ["Isaac Portela", "2012-11-17", "DISCOVERED", "Lateral direito", "Académico da Vila", "Sub-15", null, 0],
  ["Lucas Arantes", "2013-02-05", "RECRUITED", "Médio defensivo", "Juventude da Ponte", "Sub-15", "2026-08-29", 5],
];

/* -------------------------------------------------------------------------- */
/* Sócios                                                                      */
/* -------------------------------------------------------------------------- */

const CATEGORIAS = [
  { id: "cat-adulto", name: "Adulto", description: "Sócio efetivo, com direito a voto.", benefits: ["Entrada livre nos jogos em casa", "Voto na assembleia geral", "10% na loja do clube"], feeCents: 500, billing: "MONTHLY", minAge: 18, maxAge: null, isPublic: true, order: 0 },
  { id: "cat-jovem", name: "Jovem", description: "Até aos 17 anos.", benefits: ["Entrada livre nos jogos em casa"], feeCents: 200, billing: "MONTHLY", minAge: null, maxAge: 17, isPublic: true, order: 1 },
  { id: "cat-familia", name: "Família", description: "Dois adultos e os filhos menores.", benefits: ["Entrada livre nos jogos em casa", "Um voto por agregado"], feeCents: 800, billing: "MONTHLY", minAge: null, maxAge: null, isPublic: true, order: 2 },
  { id: "cat-anual", name: "Benemérito", description: "Quota anual de apoio ao clube.", benefits: ["Lugar reservado", "Nome no mural dos beneméritos"], feeCents: 12000, billing: "ANNUAL", minAge: 18, maxAge: null, isPublic: true, order: 3 },
];

/** [número, nome, categoria, nascimento, última quota paga, app, estado]. */
const SOCIOS = [
  [1291, "Vasco Antunes", "cat-adulto", "1984-02-19", null, "invited", "PENDING"],
  [1290, "Helena Brandão", "cat-adulto", "1991-07-04", "2026-10", "account", "ACTIVE"],
  [1289, "Rogério Pimenta", "cat-anual", "1958-11-30", "2026-08", "noemail", "ACTIVE"],
  [1288, "Beatriz Lacerda", "cat-jovem", "2010-05-12", "2026-10", "account", "ACTIVE"],
  [1287, "Família Quintela", "cat-familia", "1979-09-21", "2026-09", "account", "ACTIVE"],
  [1286, "Artur Meireles", "cat-adulto", "1967-01-08", "2026-10", "none", "ACTIVE"],
  [1285, "Fátima Regalo", "cat-adulto", "1972-12-02", "2026-06", "invited", "ACTIVE"],
  [1284, "Carla Ferreira", "cat-adulto", "1983-06-27", "2026-10", "account", "ACTIVE"],
  [1283, "Jaime Bettencourt", "cat-adulto", "1955-03-15", "2026-10", "noemail", "ACTIVE"],
  [1282, "Lúcia Travassos", "cat-adulto", "1988-08-09", "2026-10", "account", "ACTIVE"],
  [1281, "Miguel Antunes", "cat-adulto", "1986-10-22", "2026-10", "account", "ACTIVE"],
  [1280, "Olívia Sampaio", "cat-jovem", "2011-02-14", "2026-09", "account", "ACTIVE"],
  [1279, "Guilherme Falcão", "cat-adulto", "1994-04-03", "2026-10", "account", "ACTIVE"],
  [1278, "Albertina Rosário", "cat-anual", "1949-07-19", "2026-08", "noemail", "ACTIVE"],
  [1277, "Duarte Vilela", "cat-adulto", "1990-11-11", "2026-03", "account", "SUSPENDED"],
  [1276, "Família Noronha", "cat-familia", "1981-05-25", "2026-10", "account", "ACTIVE"],
  [1275, "Sebastião Couto", "cat-adulto", "1963-09-07", "2026-10", "none", "ACTIVE"],
  [1274, "Mafalda Teles", "cat-adulto", "1996-01-29", "2026-10", "account", "ACTIVE"],
  [1273, "Paulo Rebelo", "cat-adulto", "1975-12-18", "2026-10", "account", "ACTIVE"],
  [1272, "Irene Sarmento", "cat-adulto", "1969-06-06", "2026-09", "invited", "ACTIVE"],
];

export function criarOutros(clube) {
  const prospetos = PROSPETOS.map(([nome, nascimento, fase, posicao, clubeAtual, escalao, vista, n]) => ({
    id: `pr-${chave(nome)}`, name: nome, birthdate: `${nascimento}T00:00:00.000Z`, stage: fase, position: posicao,
    currentClub: clubeAtual, currentTeam: escalao, sportId: SPORT.id,
    lastObservedAt: vista ? `${vista}T15:00:00.000Z` : null,
    ownerId: "st-bruno-teixeira", owner: "Bruno Teixeira", observations: n,
  }));

  const categorias = CATEGORIAS.map((c) => ({ ...c, members: SOCIOS.filter((s) => s[2] === c.id).length }));
  const socios = SOCIOS.map(([numero, nome, categoria, nascimento, paga, app, estado], i) => {
    const c = CATEGORIAS.find((x) => x.id === categoria);
    const apelido = chave(nome.replace("Família ", ""));
    return {
      id: `soc-${numero}`, number: estado === "PENDING" ? null : numero, name: nome,
      email: app === "noemail" ? null : `${apelido.replace(/-/g, ".")}@exemplo.pt`,
      phone: `91${String(3000000 + numero * 3571).slice(0, 7)}`, phoneCountry: "+351",
      birthdate: `${nascimento}T00:00:00.000Z`, city: "Vila Nova da Serra", address: null, postalCode: null, country: "PT",
      documentKind: "CC", documentNumber: null, taxId: null, sex: "UNSPECIFIED",
      annualStart: "2026-08-01T00:00:00.000Z", status: estado,
      createdAt: `${2019 + (i % 7)}-0${1 + (i % 9)}-1${i % 9}T10:00:00.000Z`,
      approvedAt: estado === "PENDING" ? null : `${2019 + (i % 7)}-0${1 + (i % 9)}-1${i % 9}T10:00:00.000Z`,
      source: i % 3 === 0 ? "PUBLIC_FORM" : "MANUAL",
      tier: { id: c.id, name: c.name, feeCents: c.feeCents, billing: c.billing },
      photoUrl: null, app, inviteSentAt: app === "invited" ? "2026-10-02T09:00:00.000Z" : null,
      lastPaidPeriod: paga,
    };
  });
  const contagens = {};
  for (const s of socios) contagens[s.status] = (contagens[s.status] ?? 0) + 1;

  return {
    GET: {
      "/api/scouting/prospects": (q) => {
        const fase = q.get("stage");
        return prospetos.filter((p) => !fase || p.stage === fase);
      },
      "/api/members/tiers": categorias,
      "/api/members": (q) => {
        const estado = q.get("status"), categoria = q.get("tierId");
        return {
          members: socios.filter((s) => (!estado || s.status === estado) && (!categoria || s.tier.id === categoria)),
          counts: contagens,
        };
      },
    },
    PADROES: [],
  };
}
