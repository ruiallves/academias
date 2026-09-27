/**
 * O leitor do calendário, contra ficheiros a sério.
 *
 * ## O que se está a proteger
 *
 * A importação de calendário é a única do produto que ninguém confere depois:
 * os eventos ficam espalhados por doze meses, e um engano só aparece no dia em
 * que a equipa não está no campo. Por isso o que este teste guarda não é só
 * "lê o ficheiro" — é **o que faz a cada engano possível na folha**: a data
 * escrita à portuguesa, a hora que o Excel converteu em fracção do dia, a
 * equipa com o nome quase certo, a repetição sem data de fim.
 *
 * Corre o código verdadeiro: o mesmo `parseCalendarFile` da consola, agrupado
 * com esbuild. O store e os catálogos são substituídos por um clube de teste
 * (ver `scripts/stubs/`), porque num script não há sessão.
 *
 * O primeiro caso é o mais importante: **o modelo que a consola oferece é lido
 * pelo leitor da consola, sem uma única queixa**. Um exemplo mal escrito no
 * modelo manda toda a gente corrigir linhas que nós é que escrevemos.
 *
 * Uso: npm run test:calendario
 */
import * as XLSX from "xlsx";
import { SHEETS, buildCalendarTemplate, folhasDoCalendario, parseCalendarFile } from "../src/lib/calendar-import";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

/** Um `File` a partir das folhas, como o que o browser entrega ao diálogo. */
function ficheiro(folhas: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(folhas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome);
  }
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "calendario.xlsx");
}

const cabecalho = (key: "training" | "match" | "other") =>
  SHEETS.find((s) => s.key === key)!.colunas.map((c) => c.header);

async function main() {
  console.log("=== O modelo lê-se a si próprio ===");
  {
    const blob = await buildCalendarTemplate();
    const lido = await parseCalendarFile(new File([await blob.arrayBuffer()], "modelo.xlsx"));
    check("as três folhas são reconhecidas", !lido.semFolhas);
    check("nenhuma coluna obrigatória em falta", lido.colunasEmFalta.length === 0, JSON.stringify(lido.colunasEmFalta));
    check("nenhuma linha de exemplo recusada", lido.erros.length === 0, JSON.stringify(lido.erros));
    check("as três linhas de exemplo entram", lido.rows.length === 3, String(lido.rows.length));
    check(
      "e nada do exemplo é novo para o clube",
      lido.novos.venues.length + lido.novos.competitions.length + lido.novos.eventTypes.length === 0,
      JSON.stringify(lido.novos),
    );
    const treino = lido.rows.find((r) => r.kind === "TRAINING");
    check("o treino de exemplo repete às terças e quintas", JSON.stringify(treino?.weekdays) === "[2,4]", JSON.stringify(treino));
  }

  console.log("\n=== As folhas e as colunas ===");
  {
    const lido = await parseCalendarFile(ficheiro({ Atletas: [["Nome"], ["Alguém"]] }));
    check("um ficheiro de outra coisa diz que não tem folhas", lido.semFolhas);
  }
  {
    const lido = await parseCalendarFile(
      ficheiro({ Treinos: [["Equipa", "Data", "Início"], ["Sub-13 Futebol", "2026-09-08", "18:30"]] }),
    );
    check("uma folha sem colunas obrigatórias é apontada", lido.colunasEmFalta[0]?.colunas.join(",") === "Fim,Local");
    check("e não deixa passar linhas", lido.rows.length === 0);
  }
  {
    /* Só os treinos: quem não quer as outras folhas apaga-as. */
    const lido = await parseCalendarFile(
      ficheiro({ Treinos: [cabecalho("training"), ["Sub-13 Futebol", "2026-09-08", "18:30", "20:00", "Campo 1", "", "", "", ""]] }),
    );
    check("um ficheiro só com Treinos vale", lido.rows.length === 1 && !lido.semFolhas, JSON.stringify(lido.erros));
  }

  console.log("\n=== Datas e horas, como o Excel as entrega ===");
  {
    const lido = await parseCalendarFile(
      ficheiro({
        Treinos: [
          cabecalho("training"),
          ["Sub-13 Futebol", "08/09/2026", "18h30", "20:00", "Campo 1", "", "", "", ""],
          // 46274 = 2026-09-09; 0,770833… = 18:30 (é assim que uma célula de hora chega)
          ["Sub-13 Futebol", 46274, 0.7708333333333334, 0.8333333333333334, "Campo 1", "", "", "", ""],
          ["Sub-13 Futebol", "2026-09-10", "18", "19", "Campo 1", "", "", "", ""],
        ],
      }),
    );
    check("data à portuguesa e hora com h", lido.rows[0]?.date === "2026-09-08" && lido.rows[0]?.start === "18:30", JSON.stringify(lido.rows[0]));
    check(
      "número de série e fracção do dia",
      lido.rows[1]?.date === "2026-09-09" && lido.rows[1]?.start === "18:30" && lido.rows[1]?.end === "20:00",
      JSON.stringify(lido.rows[1]),
    );
    check("só a hora são horas certas", lido.rows[2]?.start === "18:00" && lido.rows[2]?.end === "19:00");
    check("nenhuma delas dá erro", lido.erros.length === 0, JSON.stringify(lido.erros));
  }
  {
    const lido = await parseCalendarFile(
      ficheiro({
        Treinos: [
          cabecalho("training"),
          ["Sub-13 Futebol", "2026-09-08", "20:00", "18:30", "Campo 1", "", "", "", ""],
          ["Sub-13 Futebol", "amanhã", "18:30", "20:00", "Campo 1", "", "", "", ""],
          ["Sub-13 Futebol", "2026-09-08", "25:00", "20:00", "Campo 1", "", "", "", ""],
          ["", "", "", "", "", "", "", "", ""],
        ],
      }),
    );
    check("fim antes do início é recusado", lido.erros.some((e) => e.erro.includes("fim tem de ser depois")));
    check("data impossível é recusada", lido.erros.some((e) => e.erro.includes("Data em falta")));
    check("hora impossível é recusada", lido.erros.some((e) => e.erro.includes("Hora em falta")));
    check("a linha em branco não conta", lido.erros.length === 3 && lido.rows.length === 0, JSON.stringify(lido.erros));
  }

  console.log("\n=== O que a academia ainda não tem ===");
  {
    const lido = await parseCalendarFile(
      ficheiro({
        Treinos: [
          cabecalho("training"),
          ["Sub-13 Futebol", "2026-09-08", "18:30", "20:00", "Campo 3", "Balneário 5, Balneário 2", "", "", ""],
        ],
        Outros: [
          cabecalho("other"),
          ["Estágio", "", "Estágio de Natal", "2026-12-27", "09:00", "18:00", "Pavilhão", "", "", ""],
        ],
      }),
    );
    check("o local novo é apanhado", lido.novos.venues.join() === "Campo 3", JSON.stringify(lido.novos.venues));
    check("o balneário novo também, e só ele", lido.novos.dressingRooms.join() === "Balneário 5", JSON.stringify(lido.novos.dressingRooms));
    check("o tipo de evento novo também", lido.novos.eventTypes.join() === "Estágio");
    check("os dois balneários ficam na linha", JSON.stringify(lido.rows[0]?.dressingRooms) === '["Balneário 5","Balneário 2"]');
    check("um evento genérico pode não ter equipa", lido.rows[1]?.team === undefined && lido.rows[1]?.title === "Estágio de Natal");
  }
  {
    const lido = await parseCalendarFile(
      ficheiro({
        Treinos: [cabecalho("training"), ["Sub13", "2026-09-08", "18:30", "20:00", "Campo 1", "", "", "", ""]],
      }),
    );
    check("equipa desconhecida é erro de linha, não um nome novo", lido.erros[0]?.erro.startsWith("Equipa desconhecida"));
  }
  {
    /* O arquivado não conta como conhecido: foi tirado dos menus de propósito. */
    const lido = await parseCalendarFile(
      ficheiro({
        Treinos: [cabecalho("training"), ["Sub-13 Futebol", "2026-09-08", "18:30", "20:00", "Campo Velho", "", "", "", ""]],
      }),
    );
    check("um local arquivado volta a ser novo", lido.novos.venues.join() === "Campo Velho");
  }

  console.log("\n=== A repetição ===");
  {
    const lido = await parseCalendarFile(
      ficheiro({
        Treinos: [
          cabecalho("training"),
          ["Sub-13 Futebol", "2026-09-08", "18:30", "20:00", "Campo 1", "", "Atleta", "2027-06-30", "Ter, Qui"],
          ["Sub-15 Futebol", "2026-09-09", "18:30", "20:00", "Campo 1", "", "", "2027-06-30", ""],
          ["Sub-13 Futebol", "2026-09-10", "18:30", "20:00", "Campo 1", "", "", "", "Ter"],
          ["Sub-13 Futebol", "2026-09-11", "18:30", "20:00", "Campo 1", "", "", "2026-09-01", "Ter"],
          ["Sub-13 Futebol", "2026-09-12", "18:30", "20:00", "Campo 1", "", "", "2026-10-01", "Tuesday"],
        ],
      }),
    );
    check("dias da semana em português", JSON.stringify(lido.rows[0]?.weekdays) === "[2,4]");
    check("quem avisa as faltas", lido.rows[0]?.respondBy === "ATHLETE");
    check("sem dias, repete no dia da data", lido.rows[1]?.repeatUntil === "2027-06-30" && lido.rows[1]?.weekdays === undefined);
    check("dias sem data de fim é recusado", lido.erros.some((e) => e.erro.includes('não tem "Repetir até"')));
    check("fim antes do início da repetição é recusado", lido.erros.some((e) => e.erro.includes("é antes da data do evento")));
    check("dia da semana em inglês é recusado", lido.erros.some((e) => e.erro.includes("Dia da semana desconhecido")));
  }

  console.log("\n=== Os jogos ===");
  {
    const lido = await parseCalendarFile(
      ficheiro({
        Jogos: [
          cabecalho("match"),
          ["Sub-15 Futebol", "2026-09-13", "10:00", "11:30", "Campo 1", "Balneário 1", "Académico FC", "Casa", "Campeonato Distrital"],
          ["Sub-13 Futebol", "2026-09-13", "12:00", "13:30", "Campo 1", "", "Académico FC", "Fora", "Campeonato Distrital"],
          ["Sub-13 Futebol", "2026-09-20", "12:00", "13:30", "Campo 1", "", "", "Casa", "Amigável"],
          ["Sub-13 Futebol", "2026-09-27", "12:00", "13:30", "Campo 1", "", "Outro FC", "Casa", ""],
          ["Sub-13 Futebol", "2026-10-04", "12:00", "13:30", "Campo 1", "", "Outro FC", "Casa", "Taça Nova"],
        ],
      }),
    );
    check("casa por omissão e fora quando o diz", lido.rows[0]?.isHome === true && lido.rows[1]?.isHome === false);
    check("sem adversário é recusado", lido.erros.some((e) => e.erro === "Falta o adversário"));
    check("sem competição é recusado", lido.erros.some((e) => e.erro.includes("Falta a competição")));
    check("a prova nova é apanhada", lido.novos.competitions.join() === "Taça Nova");
    check(
      "a equipa que não disputa a prova fica para ligar",
      lido.provasPorLigar.some((p) => p.teamName === "Sub-13 Futebol" && p.competicoes.includes("Campeonato Distrital")),
      JSON.stringify(lido.provasPorLigar),
    );
    check(
      "quem já a disputa não aparece",
      !lido.provasPorLigar.some((p) => p.teamName === "Sub-15 Futebol"),
      JSON.stringify(lido.provasPorLigar),
    );
    check("um jogo nunca leva repetição", lido.rows.every((r) => r.repeatUntil === undefined));
  }

  console.log("\n=== Exportar e voltar a importar ===");
  {
    /* O que o servidor devolve para um período: um de cada, com tudo preenchido. */
    const dados = {
      treinos: [
        { team: "Sub-13 Futebol", date: "2026-10-06", start: "18:30", end: "20:00", venue: "Campo 1",
          dressingRooms: ["Balneário 1", "Balneário 2"], cancelled: false, respondBy: "ATHLETE" as const },
      ],
      jogos: [
        { team: "Sub-15 Futebol", date: "2026-10-10", start: "10:00", end: "11:30", venue: "Campo 1",
          dressingRooms: ["Balneário 2"], cancelled: false, opponent: "Académico FC", isHome: false,
          competition: "Campeonato Distrital" },
      ],
      outros: [
        { team: null, date: "2026-12-20", start: "09:00", end: "18:00", venue: "Pavilhão",
          dressingRooms: [], cancelled: false, type: "Torneio", title: "Torneio de Natal" },
      ],
    };
    const livro = (cancelados: boolean) => {
      const f = folhasDoCalendario(dados, cancelados);
      return ficheiro({ Treinos: f.training, Jogos: f.match, Outros: f.other });
    };

    for (const cancelados of [false, true]) {
      const lido = await parseCalendarFile(livro(cancelados));
      const sufixo = cancelados ? " (com a coluna Estado)" : "";
      check(`os três eventos voltam a entrar${sufixo}`, lido.rows.length === 3 && lido.erros.length === 0, JSON.stringify(lido.erros));
      check(
        `e nada é novo para o clube${sufixo}`,
        lido.novos.venues.length + lido.novos.dressingRooms.length + lido.novos.competitions.length === 0,
        JSON.stringify(lido.novos),
      );
    }

    const lido = await parseCalendarFile(livro(false));
    const treino = lido.rows.find((r) => r.kind === "TRAINING");
    const jogo = lido.rows.find((r) => r.kind === "MATCH");
    const outro = lido.rows.find((r) => r.kind === "OTHER");
    check("o treino volta com os dois balneários", JSON.stringify(treino?.dressingRooms) === '["Balneário 1","Balneário 2"]', JSON.stringify(treino));
    check("e com quem avisa as faltas", treino?.respondBy === "ATHLETE");
    check("e não volta a repetir", treino?.repeatUntil === undefined);
    check("o jogo volta fora, com a prova", jogo?.isHome === false && jogo?.competition === "Campeonato Distrital", JSON.stringify(jogo));
    check(
      "o evento de toda a academia volta sem equipa",
      outro?.team === undefined && outro?.type === "Torneio" && outro?.title === "Torneio de Natal",
      JSON.stringify(outro),
    );

    const vazio = folhasDoCalendario({ treinos: [], jogos: [], outros: [] }, false);
    check(
      "um período vazio sai com os cabeçalhos das três folhas",
      vazio.training.length === 1 && vazio.match.length === 1 && vazio.other.length === 1,
    );
  }

  console.log(`\n${ok} OK, ${bad} FALHA`);
  if (bad > 0) process.exit(1);
}

void main();
