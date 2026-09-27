import { apiGet, apiPost, apiPut } from "@/lib/http";
import { academy, teams } from "@/lib/store";
import { getCatalog } from "@/lib/catalogs";

/**
 * Importar o calendário de um ficheiro Excel.
 *
 * ## Porque é que são três folhas e não uma
 *
 * Porque três tipos de evento pedem coisas diferentes, e uma folha só teria de
 * as pedir todas: um treino não tem adversário nem prova, um jogo não se
 * repete às terças e quintas, e só um evento genérico tem título próprio. Numa
 * folha única, metade das colunas fica vazia em metade das linhas — e uma
 * coluna que quase nunca se preenche é uma coluna que se preenche mal.
 *
 * Cada folha tem as colunas do seu tipo, e o ficheiro pode trazer só as que
 * interessam: um clube que só queira carregar os treinos apaga as outras duas.
 *
 * ## O que este ficheiro decide, e o que não decide
 *
 * Aqui faz-se a leitura e a **conveniência**: as colunas certas, as datas
 * plausíveis, os nomes que a academia não conhece. Quem decide o que entra é o
 * servidor (`EventsImportService`), e é lá que os conflitos são apanhados — um
 * balneário ocupado por um treino de outro escalão não se vê a partir daqui.
 *
 * ## A repetição
 *
 * "Repetir até" mais "Dias da semana" — é a repetição que um calendário de
 * clube usa ("terças e quintas até 30 de Junho"). Sem os dias, repete no dia da
 * semana da primeira data. Diária e mensal ficam de fora de propósito: são
 * raras, e duas colunas a mais em todas as linhas custam mais do que valem.
 * Quem precisar delas marca esse evento no calendário.
 */

export type SheetKey = "training" | "match" | "other";

type Coluna = { header: string; required?: boolean; example: string; nota?: string };

/** As três folhas, com as colunas de cada uma. A ordem é o contrato. */
export const SHEETS: { key: SheetKey; nome: string; kind: string; colunas: Coluna[] }[] = [
  {
    key: "training",
    nome: "Treinos",
    kind: "TRAINING",
    colunas: [
      { header: "Equipa", required: true, example: "Sub-13 Futebol" },
      { header: "Data", required: true, example: "2026-09-08" },
      { header: "Início", required: true, example: "18:30" },
      { header: "Fim", required: true, example: "20:00" },
      { header: "Local", required: true, example: "Campo 1" },
      { header: "Balneários", example: "Balneário 2", nota: "vários separados por vírgula" },
      { header: "Quem avisa faltas", example: "Encarregado", nota: "Encarregado ou Atleta" },
      { header: "Repetir até", example: "2027-06-30" },
      { header: "Dias da semana", example: "Ter, Qui" },
    ],
  },
  {
    key: "match",
    nome: "Jogos",
    kind: "MATCH",
    colunas: [
      { header: "Equipa", required: true, example: "Sub-13 Futebol" },
      { header: "Data", required: true, example: "2026-09-13" },
      { header: "Início", required: true, example: "10:00" },
      { header: "Fim", required: true, example: "11:30" },
      { header: "Local", required: true, example: "Campo 1" },
      { header: "Balneários", example: "Balneário 1" },
      { header: "Adversário", required: true, example: "Académico FC" },
      { header: "Casa/Fora", example: "Casa", nota: "Casa ou Fora" },
      { header: "Competição", required: true, example: "Campeonato Distrital" },
    ],
  },
  {
    key: "other",
    nome: "Outros",
    kind: "OTHER",
    colunas: [
      { header: "Tipo", required: true, example: "Torneio", nota: "dos tipos de evento do clube" },
      { header: "Equipa", example: "Sub-13 Futebol", nota: "vazio é toda a academia" },
      { header: "Título", example: "Torneio de Natal" },
      { header: "Data", required: true, example: "2026-12-20" },
      { header: "Início", required: true, example: "09:00" },
      { header: "Fim", required: true, example: "18:00" },
      { header: "Local", required: true, example: "Pavilhão" },
      { header: "Balneários", example: "" },
      { header: "Repetir até", example: "" },
      { header: "Dias da semana", example: "" },
    ],
  },
];

/** Uma linha lida e pronta para o servidor. Nomes, não ids — ver o DTO. */
export type LinhaDoCalendario = {
  linha: number;
  folha: string;
  kind: string;
  team?: string;
  title?: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  dressingRooms?: string[];
  type?: string;
  opponent?: string;
  isHome?: boolean;
  competition?: string;
  respondBy?: "GUARDIAN" | "ATHLETE";
  repeatUntil?: string;
  freq?: "WEEKLY";
  weekdays?: number[];
};

export type ErroDeLinha = { folha: string; linha: number; erro: string };

export type LeituraDoCalendario = {
  rows: LinhaDoCalendario[];
  erros: ErroDeLinha[];
  /** Folhas que vieram no ficheiro sem uma coluna obrigatória. */
  colunasEmFalta: { folha: string; colunas: string[] }[];
  /** Nenhuma das três folhas apareceu — o ficheiro não é deste modelo. */
  semFolhas: boolean;
  /** O que a academia ainda não tem, pela ordem em que aparece. */
  novos: { venues: string[]; dressingRooms: string[]; competitions: string[]; eventTypes: string[] };
  /** As provas que cada equipa usa no ficheiro e ainda não disputa. */
  provasPorLigar: { teamId: string; teamName: string; competicoes: string[] }[];
};

/* -------------------------------------------------------------------------- */
/* O modelo                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O modelo, com uma folha por tipo e uma de consulta.
 *
 * A folha "Como preencher" traz os nomes exactos das equipas, dos locais, dos
 * balneários, das provas e dos tipos — é o que evita a linha recusada por
 * "Sub13" em vez de "Sub-13 Futebol", que é o erro que mais custa a encontrar
 * numa folha de trezentas linhas.
 */
export async function buildCalendarTemplate(): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  for (const folha of SHEETS) {
    const sheet = XLSX.utils.aoa_to_sheet([folha.colunas.map((c) => c.header), folha.colunas.map((c) => c.example)]);
    sheet["!cols"] = folha.colunas.map((c) => ({ wch: Math.max(c.header.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, sheet, folha.nome);
  }

  const lista = (titulo: string, xs: string[]) => [[titulo], ...(xs.length ? xs.map((x) => [x]) : [["(nenhum)"]]), [""]];
  const ajuda = XLSX.utils.aoa_to_sheet([
    ["Uma folha por tipo de evento. Apaga as que não precisares."],
    ["Escreve os nomes exactamente como estão em baixo."],
    ["As datas em AAAA-MM-DD e as horas em HH:MM."],
    ["Balneários: vários na mesma célula, separados por vírgula."],
    ["Repetir até + Dias da semana: repete todas as semanas nesses dias, até esse dia inclusive."],
    ["Sem Dias da semana, repete no dia da semana da data."],
    [""],
    ...lista("Equipas", teams.map((t) => t.name)),
    ...lista("Locais", getCatalog("venues").filter((v) => !v.archived).map((v) => v.label)),
    ...lista("Balneários", getCatalog("dressingRooms").filter((v) => !v.archived).map((v) => v.label)),
    ...lista("Competições", getCatalog("competitions").filter((v) => !v.archived).map((v) => v.label)),
    ...lista("Tipos de evento", getCatalog("eventTypes").filter((v) => !v.archived).map((v) => v.label)),
    ["Dias da semana"],
    ["Seg, Ter, Qua, Qui, Sex, Sáb, Dom"],
  ]);
  ajuda["!cols"] = [{ wch: 52 }];
  XLSX.utils.book_append_sheet(wb, ajuda, "Como preencher");

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function downloadCalendarTemplate(): Promise<void> {
  const blob = await buildCalendarTemplate();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `calendario-${academy.slug || "modelo"}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* A leitura                                                                   */
/* -------------------------------------------------------------------------- */

const chave = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const DIAS: Record<string, number> = {
  dom: 0, domingo: 0,
  seg: 1, segunda: 1, "segunda-feira": 1, "2a": 1,
  ter: 2, terca: 2, "terca-feira": 2, "3a": 2,
  qua: 3, quarta: 3, "quarta-feira": 3, "4a": 3,
  qui: 4, quinta: 4, "quinta-feira": 4, "5a": 4,
  sex: 5, sexta: 5, "sexta-feira": 5, "6a": 5,
  sab: 6, sabado: 6,
};

export async function parseCalendarFile(file: File): Promise<LeituraDoCalendario> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });

  const rows: LinhaDoCalendario[] = [];
  const erros: ErroDeLinha[] = [];
  const colunasEmFalta: LeituraDoCalendario["colunasEmFalta"] = [];

  /* O que a academia já tem, por nome comparável. */
  const equipaPorNome = new Map(teams.map((t) => [chave(t.name), t]));
  const conhecidos = (k: "venues" | "dressingRooms" | "competitions" | "eventTypes") =>
    new Set(getCatalog(k).filter((i) => !i.archived).map((i) => chave(i.label)));
  const locais = conhecidos("venues");
  const balnearios = conhecidos("dressingRooms");
  const provas = conhecidos("competitions");
  const tipos = conhecidos("eventTypes");

  /* Os novos, pela ordem em que aparecem e sem repetir. */
  const novos = {
    venues: new Map<string, string>(),
    dressingRooms: new Map<string, string>(),
    competitions: new Map<string, string>(),
    eventTypes: new Map<string, string>(),
  };
  /** Equipa → provas que o ficheiro lhe dá e que ela ainda não disputa. */
  const porLigar = new Map<string, { teamId: string; teamName: string; competicoes: Map<string, string> }>();

  let encontrouFolha = false;

  for (const folha of SHEETS) {
    const nomeNoFicheiro = wb.SheetNames.find((n) => chave(n) === chave(folha.nome));
    if (!nomeNoFicheiro) continue;
    encontrouFolha = true;

    const sheet = wb.Sheets[nomeNoFicheiro];
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const presentes = linhas.length
      ? Object.keys(linhas[0])
      : (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []);

    const faltam = folha.colunas
      .filter((c) => c.required && !presentes.some((p) => chave(String(p)) === chave(c.header)))
      .map((c) => c.header);
    if (faltam.length) {
      colunasEmFalta.push({ folha: folha.nome, colunas: faltam });
      continue;
    }

    linhas.forEach((raw, i) => {
      const linha = i + 2; // +1 base-0, +1 cabeçalho
      /* Os cabeçalhos comparam-se sem acentos: "Inicio" e "Início" são o mesmo. */
      const get = (header: string) => {
        const k = Object.keys(raw).find((x) => chave(x) === chave(header));
        return String(k ? (raw[k] ?? "") : "").trim();
      };
      const falha = (erro: string) => erros.push({ folha: folha.nome, linha, erro });

      /* Uma linha em branco arrastada sem querer não é um erro. */
      if (folha.colunas.every((c) => !get(c.header))) return;

      const data = normalizarData(get("Data"));
      if (!data) return void falha("Data em falta ou mal escrita (usa AAAA-MM-DD)");

      const inicio = normalizarHora(get("Início"));
      const fim = normalizarHora(get("Fim"));
      if (!inicio || !fim) return void falha("Hora em falta ou mal escrita (usa HH:MM)");
      if (fim <= inicio) return void falha("O fim tem de ser depois do início");

      const local = get("Local");
      if (!local) return void falha("Falta o local");
      if (!locais.has(chave(local))) novos.venues.set(chave(local), local);

      const salas = get("Balneários")
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of salas) if (!balnearios.has(chave(s))) novos.dressingRooms.set(chave(s), s);

      /* A equipa: obrigatória no treino e no jogo, opcional no evento genérico. */
      const nomeDaEquipa = get("Equipa");
      const equipa = nomeDaEquipa ? equipaPorNome.get(chave(nomeDaEquipa)) : undefined;
      if (nomeDaEquipa && !equipa) {
        return void falha(`Equipa desconhecida: "${nomeDaEquipa}". Cria-a primeiro, ou corrige o nome.`);
      }
      if (!nomeDaEquipa && folha.key !== "other") {
        return void falha(folha.key === "training" ? "Um treino é sempre de uma equipa" : "Um jogo é sempre de uma equipa");
      }

      const row: LinhaDoCalendario = {
        linha,
        folha: folha.nome,
        kind: folha.kind,
        date: data,
        start: inicio,
        end: fim,
        venue: local,
        ...(salas.length ? { dressingRooms: salas } : {}),
        ...(equipa ? { team: equipa.name } : {}),
      };

      if (folha.key === "match") {
        const adversario = get("Adversário");
        if (!adversario) return void falha("Falta o adversário");
        const prova = get("Competição");
        if (!prova) return void falha('Falta a competição (escreve "Amigável" se não for de nenhuma prova)');
        if (!provas.has(chave(prova))) novos.competitions.set(chave(prova), prova);

        /*
         * Um jogo só entra numa prova que a equipa dispute — é a regra do
         * servidor. Aqui só se regista quais faltam ligar, para o diálogo poder
         * perguntar de uma vez em vez de devolver dez linhas recusadas.
         */
        if (equipa && !equipa.competitions.some((c) => chave(c.label) === chave(prova))) {
          const alvo = porLigar.get(equipa.id) ?? { teamId: equipa.id, teamName: equipa.name, competicoes: new Map() };
          alvo.competicoes.set(chave(prova), prova);
          porLigar.set(equipa.id, alvo);
        }

        const casa = chave(get("Casa/Fora"));
        row.opponent = adversario;
        row.competition = prova;
        row.isHome = casa ? !casa.startsWith("f") : true;
      } else {
        if (folha.key === "other") {
          const tipo = get("Tipo");
          if (!tipo) return void falha("Falta o tipo de evento");
          if (!tipos.has(chave(tipo))) novos.eventTypes.set(chave(tipo), tipo);
          row.type = tipo;
          const titulo = get("Título");
          if (titulo) row.title = titulo;
        } else {
          const quem = chave(get("Quem avisa faltas"));
          if (quem.startsWith("atl")) row.respondBy = "ATHLETE";
        }

        const ate = get("Repetir até");
        if (ate) {
          const ateISO = normalizarData(ate);
          if (!ateISO) return void falha('"Repetir até" mal escrita (usa AAAA-MM-DD)');
          if (ateISO < data) return void falha('"Repetir até" é antes da data do evento');
          row.repeatUntil = ateISO;
          row.freq = "WEEKLY";

          const dias = get("Dias da semana")
            .split(/[,;/ ]+/)
            .map((d) => chave(d))
            .filter(Boolean);
          const desconhecido = dias.find((d) => DIAS[d] === undefined);
          if (desconhecido) return void falha(`Dia da semana desconhecido: "${desconhecido}"`);
          if (dias.length) row.weekdays = [...new Set(dias.map((d) => DIAS[d]))].sort();
        } else if (get("Dias da semana")) {
          return void falha('Tem "Dias da semana" mas não tem "Repetir até" — sem a data de fim não há repetição');
        }
      }

      rows.push(row);
    });
  }

  return {
    rows,
    erros,
    colunasEmFalta,
    semFolhas: !encontrouFolha,
    novos: {
      venues: [...novos.venues.values()],
      dressingRooms: [...novos.dressingRooms.values()],
      competitions: [...novos.competitions.values()],
      eventTypes: [...novos.eventTypes.values()],
    },
    provasPorLigar: [...porLigar.values()].map((p) => ({
      teamId: p.teamId,
      teamName: p.teamName,
      competicoes: [...p.competicoes.values()],
    })),
  };
}

/** `14/03/2026`, `2026-03-14` ou o número de série do Excel → `2026-03-14`. */
function normalizarData(value: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const pt = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (pt) return `${pt[3]}-${pt[2].padStart(2, "0")}-${pt[1].padStart(2, "0")}`;

  /*
   * O Excel guarda datas como dias desde 1899-12-30, e uma célula com hora traz
   * a fracção do dia agarrada — daí o `Math.floor`. Sem ele, uma célula
   * formatada como data-e-hora lia-se um dia ao lado de meia em meia vez.
   */
  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 1 && serial < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  return "";
}

/** `18:30`, `8:5`, `18h30` ou a fracção de dia do Excel → `18:30`. */
function normalizarHora(value: string): string {
  if (!value) return "";

  /*
   * A fracção do dia primeiro, e a ordem não é indiferente.
   *
   * Uma célula formatada como hora chega assim (0,7708333… = 18:30). Estava
   * depois do padrão `h:m`, e o ponto decimal é um dos separadores que ele
   * aceita — "0.7708333" lia-se como zero horas e 77 minutos, e a linha era
   * recusada por "hora mal escrita". Um clube que formate a coluna como hora,
   * que é o que o Excel faz sozinho, perdia o ficheiro inteiro.
   *
   * Arredonda-se ao minuto: 18:30 guardado é 0,77083333…, e a conta directa
   * dava 18:29.
   */
  const fraccao = Number(value.replace(",", "."));
  if (Number.isFinite(fraccao) && fraccao > 0 && fraccao < 1) {
    const minutos = Math.round(fraccao * 1440);
    return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
  }

  const hm = /^(\d{1,2})[:h.](\d{1,2})$/.exec(value);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) return "";
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /* Só o número da hora: "18" são 18:00. Zero é meia-noite, e é uma hora. */
  if (/^\d{1,2}$/.test(value)) {
    const h = Number(value);
    return h <= 23 ? `${String(h).padStart(2, "0")}:00` : "";
  }

  return "";
}

/* -------------------------------------------------------------------------- */
/* O servidor                                                                  */
/* -------------------------------------------------------------------------- */

export type ResultadoDoCalendario = {
  total: number;
  criados: number;
  ensaio: boolean;
  porTipo: { treinos: number; jogos: number; outros: number };
  erros: { linha: number; folha: string; erro: string }[];
  conflitos: { linha: number; folha: string; quando: string; motivo: string }[];
};

/** Corre tudo no servidor sem escrever nada — é o que o ecrã mostra antes de perguntar. */
export const ensaiarCalendario = (rows: LinhaDoCalendario[]) =>
  apiPost<ResultadoDoCalendario>("/api/events/import", { rows, ensaio: true });

export const importarCalendario = (rows: LinhaDoCalendario[]) =>
  apiPost<ResultadoDoCalendario>("/api/events/import", { rows, ensaio: false });

/** Liga cada equipa às provas que o ficheiro lhe dá, sem tirar as que já tinha. */
export async function ligarProvas(porLigar: LeituraDoCalendario["provasPorLigar"]): Promise<void> {
  const porNome = new Map(getCatalog("competitions").map((c) => [chave(c.label), c.id]));
  for (const p of porLigar) {
    const equipa = teams.find((t) => t.id === p.teamId);
    if (!equipa) continue;
    const ids = [
      ...equipa.competitions.map((c) => c.id),
      ...p.competicoes.map((nome) => porNome.get(chave(nome))).filter((v): v is string => Boolean(v)),
    ];
    await apiPut(`/api/teams/${p.teamId}/competicoes`, { competitionIds: [...new Set(ids)] });
  }
}

/* -------------------------------------------------------------------------- */
/* Exportar                                                                    */
/* -------------------------------------------------------------------------- */

export type LinhaExportada = {
  team: string | null;
  date: string;
  start: string;
  end: string;
  venue: string;
  dressingRooms: string[];
  cancelled: boolean;
  respondBy?: "GUARDIAN" | "ATHLETE";
  opponent?: string;
  isHome?: boolean;
  competition?: string | null;
  type?: string | null;
  title?: string;
};

export type CalendarioExportado = { treinos: LinhaExportada[]; jogos: LinhaExportada[]; outros: LinhaExportada[] };

/**
 * O calendário de um período, em Excel, **com as colunas da importação**.
 *
 * É o ida-e-volta que faz disto útil: exportar a época, mudar o local de todos
 * os treinos do Sub-13 numa folha de cálculo, e voltar a importar. Por isso as
 * três folhas e os cabeçalhos são os de `SHEETS`, pela mesma ordem, e as horas
 * saem no relógio do clube. Cada evento sai na sua linha: a repetição não se
 * reconstrói, e "Repetir até" fica vazio.
 *
 * Uma folha sem eventos sai à mesma, só com o cabeçalho: é o que deixa usar o
 * ficheiro como modelo para acrescentar o que falta.
 *
 * Os cancelados só vêm quando se pedem, e com uma coluna **Estado** no fim, que
 * a importação não lê — reimportá-los criava-os de novo como marcados.
 */
export async function exportarCalendario(opcoes: {
  from: string;
  to: string;
  /** As equipas escolhidas. Vazio é todas (e aí os eventos da academia vêm sempre). */
  teamIds?: string[];
  /** Com equipas escolhidas: trazer também os eventos de toda a academia. */
  incluirDaAcademia?: boolean;
  /** Os tipos escolhidos, pelo nome do catálogo. Vazio é todos. */
  tipos?: string[];
  incluirCancelados?: boolean;
}): Promise<{ total: number }> {
  const qs = new URLSearchParams({
    from: new Date(`${opcoes.from}T00:00:00`).toISOString(),
    to: new Date(`${opcoes.to}T23:59:59`).toISOString(),
    ...(opcoes.teamIds?.length ? { equipas: opcoes.teamIds.join(",") } : {}),
    ...(opcoes.teamIds?.length && opcoes.incluirDaAcademia ? { academia: "1" } : {}),
    ...(opcoes.tipos?.length ? { tipos: opcoes.tipos.join(",") } : {}),
    ...(opcoes.incluirCancelados ? { cancelados: "1" } : {}),
  });
  const dados = await apiGet<CalendarioExportado>(`/api/events/export?${qs.toString()}`);

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const folhas = folhasDoCalendario(dados, opcoes.incluirCancelados === true);
  for (const folha of SHEETS) {
    const linhas = folhas[folha.key];
    const sheet = XLSX.utils.aoa_to_sheet(linhas);
    sheet["!cols"] = (linhas[0] as string[]).map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, sheet, folha.nome);
  }

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `calendario-${academy.slug || "clube"}-${opcoes.from}-a-${opcoes.to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);

  return { total: dados.treinos.length + dados.jogos.length + dados.outros.length };
}

/**
 * As três folhas da exportação, cabeçalho incluído — sem ficheiro nem rede.
 *
 * Separado de `exportarCalendario` para o ida-e-volta poder ser testado: estas
 * linhas, escritas num livro, têm de passar pelo `parseCalendarFile` sem uma
 * queixa (ver `test-calendario.ts`). É essa a promessa da exportação.
 */
export function folhasDoCalendario(dados: CalendarioExportado, incluirCancelados: boolean): Record<SheetKey, unknown[][]> {
  const salas = (e: LinhaExportada) => e.dressingRooms.join(", ");
  const estado = (e: LinhaExportada) => (incluirCancelados ? [e.cancelled ? "Cancelado" : "Marcado"] : []);
  const cabecalho = (key: SheetKey) => [
    ...SHEETS.find((f) => f.key === key)!.colunas.map((c) => c.header),
    ...(incluirCancelados ? ["Estado"] : []),
  ];

  return {
    training: [
      cabecalho("training"),
      ...dados.treinos.map((e) => [
        e.team ?? "", e.date, e.start, e.end, e.venue, salas(e),
        e.respondBy === "ATHLETE" ? "Atleta" : "Encarregado", "", "", ...estado(e),
      ]),
    ],
    match: [
      cabecalho("match"),
      ...dados.jogos.map((e) => [
        e.team ?? "", e.date, e.start, e.end, e.venue, salas(e),
        e.opponent ?? "", e.isHome === false ? "Fora" : "Casa", e.competition ?? "", ...estado(e),
      ]),
    ],
    other: [
      cabecalho("other"),
      ...dados.outros.map((e) => [
        e.type ?? "Evento", e.team ?? "", e.title ?? "", e.date, e.start, e.end, e.venue, salas(e), "", "", ...estado(e),
      ]),
    ],
  };
}
