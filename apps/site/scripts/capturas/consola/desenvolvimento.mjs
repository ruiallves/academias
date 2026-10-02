/**
 * Avaliações do CD Academias.
 *
 * A escala do produto é de 1 a 5, em números inteiros, por competência da
 * modalidade (Técnica, Tática, Físico, Atitude). A avaliação do Tomás Ferreira
 * de domingo 11/10 é a do guião, arredondada à escala: 4, 4, 4, 5.
 */
import { em } from "./clube.mjs";

const semAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s) => semAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const idDe = (nome) => `a-${chave(nome)}`;

export const PERIODO_ATUAL = "2026/27 · 1.º período";
const PERIODO_DE_JUNHO = "2025/26 · 3.º período";

/** [nome, Técnica, Tática, Físico, Atitude, dia, hora, publicada]. */
const OUTUBRO = [
  ["Afonso Lima", 4, 3, 4, 4, "2026-10-08", "21:10", true],
  ["Bernardo Costa", 3, 3, 4, 4, "2026-10-08", "21:18", true],
  ["Daniel Pinto", 3, 4, 4, 5, "2026-10-08", "21:25", true],
  ["Diogo Reis", 3, 4, 3, 4, "2026-10-08", "21:31", true],
  ["Francisco Sá", 4, 4, 3, 4, "2026-10-09", "22:02", true],
  ["Gabriel Nunes", 4, 3, 5, 3, "2026-10-09", "22:09", true],
  ["Henrique Melo", 4, 3, 4, 4, "2026-10-09", "22:15", true],
  ["João Brito", 5, 4, 3, 4, "2026-10-09", "22:24", true],
  ["Tomás Ferreira", 4, 4, 4, 5, "2026-10-11", "10:00", true],
  ["Duarte Matos", 3, 3, 4, 4, "2026-10-11", "10:08", false],
  ["Rodrigo Leal", 3, 3, 4, 3, "2026-10-11", "10:14", false],
  ["Vicente Maia", 4, 3, 3, 4, "2026-10-11", "10:19", false],
];

const TEXTOS = {
  "Tomás Ferreira": {
    note: "Um mês muito bom. Pede a bola, joga de cabeça levantada e chega mais vezes à área.",
    strengths: "Passe entre linhas. Atitude nos treinos, é dos primeiros a chegar. Lê bem quando deve acelerar o jogo.",
    focus: "Pé esquerdo. Proteger a bola de costas para a baliza. Falar mais com os colegas da linha defensiva.",
  },
};

export function criarDesenvolvimento(clube) {
  const { passou, porId } = clube;
  const SKILLS = ["Técnica", "Tática", "Físico", "Atitude"];

  const linha = (periodo, [nome, t, ta, f, a, dia, hora, publicada]) => {
    const atleta = porId[idDe(nome)];
    const quando = em(dia, hora).toISOString();
    const texto = TEXTOS[nome] ?? { note: null, strengths: null, focus: null };
    return {
      id: `avl-${chave(periodo)}-${atleta.id.slice(2)}`, athleteId: atleta.id, athleteName: atleta.name, teamId: atleta.teamId,
      period: periodo, status: publicada ? "PUBLISHED" : "DRAFT", athleteVisible: true,
      scores: Object.fromEntries(SKILLS.map((s, i) => [s, [t, ta, f, a][i]])),
      ...texto,
      coachId: "st-miguel-antunes", coachName: "Miguel Antunes",
      publishedAt: publicada ? quando : null, createdAt: quando, updatedAt: quando,
    };
  };

  const deOutubro = OUTUBRO.filter(([, , , , , dia, hora]) => passou(em(dia, hora))).map((x) => linha(PERIODO_ATUAL, x));
  // Junho: a época passada, toda entregue. O Tomás subiu na Tática e na Atitude desde então.
  const deJunho = OUTUBRO.map(([nome, t, ta, f, a]) =>
    linha(PERIODO_DE_JUNHO, [nome, nome === "Tomás Ferreira" ? 4 : t, nome === "Tomás Ferreira" ? 3 : Math.max(2, ta - 1), f, nome === "Tomás Ferreira" ? 4 : a, "2026-06-20", "11:00", true]),
  );

  return {
    GET: {
      "/api/evaluations": (q) => {
        const periodo = q.get("period");
        const atleta = q.get("athleteId");
        return [...deOutubro, ...deJunho].filter((e) => (!periodo || e.period === periodo) && (!atleta || e.athleteId === atleta));
      },
      "/api/reports": [],
    },
    PADROES: [],
  };
}
