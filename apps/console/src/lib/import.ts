import { apiPost } from "@/lib/http";
import { academy, teams } from "@/lib/store";
import { sportById } from "@/lib/api";
import { guessMaxAge } from "@/lib/team-age";

/**
 * Importação de atletas a partir de um ficheiro Excel.
 *
 * ## Onde acontece a validação
 *
 * Aqui, no browser, faz-se a validação de **conveniência**: as colunas certas, os
 * tipos plausíveis, a equipa reconhecida. Serve para dar resposta imediata a quem
 * está a olhar para o ecrã e evitar uma ida ao servidor com lixo.
 *
 * A validação **que conta** é a do servidor (`AthletesService`): é lá que se
 * decide o que entra na base de dados, e é lá que a segurança vive. O cliente pode
 * mentir; o servidor não confia nele. Ver `docs/05-seguranca.md`.
 *
 * ## Porque é que o SheetJS é carregado sob procura
 *
 * A biblioteca de Excel é pesada e só serve a quem importa — que é uma vez, no
 * arranque de uma academia. `import()` dinâmico mantém-na fora do arranque da
 * consola, que toda a gente paga todos os dias.
 */

/** As colunas do template, na ordem em que aparecem. A ordem é o contrato. */
export const COLUMNS = [
  { key: "name", header: "Nome", required: true, example: "Martim Bragança" },
  { key: "birthdate", header: "Data de nascimento", required: true, example: "2015-03-14" },
  { key: "team", header: "Equipa", required: true, example: "Sub-11 Futebol" },
  // Opcional, mas é a coluna que decide se a família consegue instalar a app e
  // ligar-se a este atleta. Vem logo a seguir às obrigatórias por isso mesmo:
  // quem preenche o ficheiro tem de a ver antes de decidir saltá-la.
  { key: "taxId", header: "NIF", required: true, example: "123456789" },
  { key: "position", header: "Posição", required: false, example: "Médio" },
  { key: "squadNumber", header: "Número", required: false, example: "7" },
  { key: "medicalValidUntil", header: "Ficha médica válida até", required: false, example: "2027-01-20" },
  { key: "heightCm", header: "Altura (cm)", required: false, example: "148" },
  { key: "weightKg", header: "Peso (kg)", required: false, example: "41.5" },
  { key: "dominantSide", header: "Lado dominante", required: false, example: "Direito" },
] as const;

/** Uma linha depois de validada no cliente, pronta para o servidor. */
export type ParsedRow = {
  line: number;
  name: string;
  birthdate: string;
  /** O que veio escrito na coluna "Equipa" — o que a pessoa reconhece. */
  teamName: string;
  /**
   * A equipa, quando já existe.
   *
   * Ausente quando o ficheiro traz uma equipa que a academia ainda não tem: aí
   * o id só existe depois de ela ser criada, e é o diálogo que o preenche antes
   * de enviar (ver `createTeams`).
   */
  teamId?: string;
  taxId?: string;
  position?: string;
  squadNumber?: number;
  medicalValidUntil?: string;
  heightCm?: number;
  weightDg?: number;
  dominantSide?: "RIGHT" | "LEFT" | "BOTH";
};

export type RowError = { line: number; name: string; error: string };

export type ParseResult = {
  valid: ParsedRow[];
  errors: RowError[];
  /** Colunas em falta no ficheiro — se houver, o ficheiro está errado à cabeça. */
  missingColumns: string[];
  /**
   * Equipas do ficheiro que a academia ainda não tem, pela ordem em que aparecem.
   *
   * **Não são um erro.** Um clube que está a arrancar traz o plantel todo numa
   * folha, e as equipas dele vêm nessa mesma folha — obrigá-lo a criá-las uma a
   * uma antes de poder importar era mandá-lo fazer à mão exactamente o trabalho
   * que o import existe para poupar. Quem decide se se criam é quem está a
   * importar, no passo de revisão.
   */
  newTeams: string[];
};

/** O que se vai criar para uma equipa que ainda não existe. */
export type NewTeamPlan = {
  /** O nome tal como está escrito no ficheiro. É a chave que liga às linhas. */
  name: string;
  sportId: string;
  /** A idade máxima. Ver `lib/team-age.ts`. */
  maxAge: number;
};

/**
 * Gera o template `.xlsx` e devolve-o como Blob para download.
 *
 * A primeira folha tem os cabeçalhos e **uma linha de exemplo**, para quem
 * preenche ver o formato esperado de cada célula — uma data escrita à mão como
 * "14/03/2015" seria rejeitada, e o exemplo mostra `2015-03-14`. Uma segunda folha
 * lista os nomes exactos das equipas, para não haver dúvida sobre como as escrever.
 */
export async function buildTemplate(): Promise<Blob> {
  const XLSX = await import("xlsx");

  const header = COLUMNS.map((c) => c.header);
  const example = COLUMNS.map((c) => c.example);
  const sheet = XLSX.utils.aoa_to_sheet([header, example]);
  sheet["!cols"] = COLUMNS.map((c) => ({ wch: Math.max(c.header.length, 16) }));

  const teamsSheet = XLSX.utils.aoa_to_sheet([
    ["As equipas que já existem — escreve o nome exactamente como aqui:"],
    ...teams.map((t) => [t.name]),
    [""],
    ["Uma equipa que ainda não exista pode ser escrita à mesma."],
    ["Ao importar, perguntamos se a queres criar."],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Atletas");
  XLSX.utils.book_append_sheet(wb, teamsSheet, "Equipas");

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Descarrega o template com o nome da academia — um ficheiro por clube. */
export async function downloadTemplate(): Promise<void> {
  const blob = await buildTemplate();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `atletas-${academy.slug || "modelo"}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Lê o ficheiro e valida cada linha contra os dados reais da academia.
 *
 * Devolve as boas e as más à parte. A equipa é resolvida pelo **nome** — é o que a
 * pessoa escreveu no Excel — para o id da equipa, que é o que o servidor quer. Um
 * nome de equipa que não existe é um erro de linha, não um pedido rejeitado
 * inteiro.
 */
export async function parseFile(file: File): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  // Colunas presentes? Compara os cabeçalhos do ficheiro com os obrigatórios.
  const present = rows.length ? Object.keys(rows[0]) : XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? [];
  const missingColumns = COLUMNS.filter((c) => c.required && !present.includes(c.header)).map((c) => c.header);
  if (missingColumns.length) return { valid: [], errors: [], missingColumns, newTeams: [] };

  const teamByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t]));
  const valid: ParsedRow[] = [];
  const errors: RowError[] = [];
  const newTeams = new Map<string, string>(); // chave em minúsculas → nome como veio escrito

  rows.forEach((raw, i) => {
    const line = i + 2; // +1 base-0, +1 cabeçalho
    const get = (header: string) => String(raw[header] ?? "").trim();

    const name = get("Nome");
    // Uma linha em branco (arrastada sem querer) não é um erro — ignora-se.
    if (!name && !get("Data de nascimento") && !get("Equipa")) return;

    if (name.length < 2) return void errors.push({ line, name: name || "(sem nome)", error: "Falta o nome" });

    const birthdate = normalizeDate(get("Data de nascimento"));
    if (!birthdate) return void errors.push({ line, name, error: "Data de nascimento em falta ou mal escrita (usa AAAA-MM-DD)" });

    const teamName = get("Equipa");
    if (!teamName) return void errors.push({ line, name, error: "Falta a equipa" });

    /*
     * Uma equipa desconhecida deixou de ser um erro de linha.
     *
     * Era: "Equipa X não existe nesta academia" — verdade, e inútil. A pessoa
     * está a montar o clube a partir da folha, sabe que a equipa não existe, e
     * a única coisa que aquela mensagem lhe dizia era "vai criá-la à mão e
     * volta". Agora o nome fica registado e a decisão — criar ou não — é
     * apresentada no passo de revisão, que é onde ela tem contexto para a tomar.
     */
    const team = teamByName.get(teamName.toLowerCase());
    if (!team) newTeams.set(teamName.toLowerCase(), teamName);

    const row: ParsedRow = { line, name, birthdate, teamName, ...(team ? { teamId: team.id } : {}) };

    const taxId = get("NIF").replace(/[\s.]/g, "");
    // Obrigatório, como na inscrição à mão. Uma folha importada sem NIF dava um
    // plantel inteiro que nenhuma família consegue reclamar — e a correcção seria
    // depois, ficha a ficha.
    if (!taxId) return void errors.push({ line, name, error: "NIF em falta" });
    if (!/^\d{9}$/.test(taxId)) return void errors.push({ line, name, error: "NIF inválido — são nove dígitos" });
    row.taxId = taxId;

    const position = get("Posição");
    if (position) {
      // Só se valida contra a modalidade quando a equipa já existe — de uma
      // equipa por criar ainda não se sabe a modalidade, e é o servidor que dá
      // a última palavra de qualquer maneira.
      const positions = team ? (sportById(team.sportId)?.positions ?? []) : [];
      // Sem posições na modalidade (natação), aceita-se o que vier; com posições,
      // exige-se uma delas — senão a ficha do atleta fica com uma posição que a
      // modalidade não conhece.
      if (team && positions.length && !positions.some((p) => p.toLowerCase() === position.toLowerCase())) {
        errors.push({ line, name, error: `Posição "${position}" não existe em ${sportById(team.sportId)?.name}` });
        return;
      }
      row.position = position;
    }

    const num = get("Número");
    if (num) {
      const n = Number(num);
      if (!Number.isInteger(n) || n < 0 || n > 999) return void errors.push({ line, name, error: "Número inválido" });
      row.squadNumber = n;
    }

    const medical = normalizeDate(get("Ficha médica válida até"));
    if (get("Ficha médica válida até") && !medical) return void errors.push({ line, name, error: "Data da ficha médica mal escrita" });
    if (medical) row.medicalValidUntil = medical;

    const height = get("Altura (cm)");
    if (height) {
      const h = Number(height);
      if (h >= 50 && h <= 250) row.heightCm = Math.round(h);
    }

    const weight = get("Peso (kg)");
    if (weight) {
      const w = Number(weight.replace(",", "."));
      if (w >= 20 && w <= 200) row.weightDg = Math.round(w * 10);
    }

    const side = get("Lado dominante").toLowerCase();
    if (side.startsWith("dir") || side === "right") row.dominantSide = "RIGHT";
    else if (side.startsWith("esq") || side === "left") row.dominantSide = "LEFT";
    else if (side.startsWith("amb") || side === "both") row.dominantSide = "BOTH";

    valid.push(row);
  });

  return { valid, errors, missingColumns: [], newTeams: [...newTeams.values()] };
}

/* -------------------------------------------------------------------------- */
/* Equipas que ainda não existem                                               */
/* -------------------------------------------------------------------------- */

/**
 * O que uma equipa nova vai ser, adivinhado a partir do nome.
 *
 * O modelo dá o exemplo "Sub-11 Futebol", que é a forma como a consola compõe os
 * nomes — idade e modalidade. Lê-se cada um de dentro do nome escrito, e o que
 * não se encontrar fica num valor de partida para quem importa corrigir no ecrã.
 *
 * Adivinhar não é decidir: a proposta aparece à vista, editável, e nada é criado
 * sem alguém carregar em Importar.
 */
export function planTeam(name: string): NewTeamPlan {
  const lower = name.toLowerCase();

  const sport =
    academy.sports.find((s) => lower.includes(s.name.toLowerCase())) ?? academy.sports[0];

  return {
    name,
    sportId: sport?.id ?? "",
    // Sem número no nome, propõe-se o mais comum na formação. Quem importa vê-o
    // e muda-o — o que não se pode é deixar vazio, que o servidor recusa.
    maxAge: guessMaxAge(name) ?? 11,
  };
}

/**
 * Cria as equipas escolhidas. Devolve o nome (em minúsculas) para o id, e as que
 * falharam.
 *
 * ## Porque é que não deixa rebentar
 *
 * Uma a uma e sem propagar o erro. Se a quarta falhar, as três primeiras já
 * estão criadas na base de dados — deixar a excepção subir perdia essa
 * informação, e a pessoa voltava a carregar o mesmo ficheiro e criava as três
 * outra vez. `Team` não tem restrição de nome único, por isso ninguém a
 * impediria: ficaria com duas "Sub-11 Futebol" e sem perceber de onde vieram.
 *
 * Assim, o que correu bem fica registado no mapa, o que correu mal fica em
 * `failed`, e o diálogo conta os atletas dessas equipas como recusados — a
 * importação continua para todos os outros.
 *
 * O horário fica vazio e marca-se depois, na ficha da equipa: um ficheiro de
 * atletas não sabe a que horas a equipa treina.
 */
export async function createTeams(
  plans: NewTeamPlan[],
  season: string,
): Promise<{ ids: Map<string, string>; failed: { name: string; error: string }[] }> {
  const ids = new Map<string, string>();
  const failed: { name: string; error: string }[] = [];

  for (const plan of plans) {
    try {
      const team = await apiPost<{ id: string }>("/api/teams", {
        name: plan.name,
        sportId: plan.sportId,
        maxAge: plan.maxAge,
        season,
        schedule: [],
      });
      ids.set(plan.name.trim().toLowerCase(), team.id);
    } catch (e) {
      failed.push({ name: plan.name, error: e instanceof Error ? e.message : "não foi possível criar" });
    }
  }

  return { ids, failed };
}

/**
 * Aceita uma data escrita de várias formas e devolve `AAAA-MM-DD`, ou vazio.
 *
 * O Excel guarda datas como número de série; escritas à mão vêm como texto em
 * qualquer formato. Isto normaliza os casos comuns — `2015-03-14`, `14/03/2015`,
 * `14-03-2015` — para o único que o servidor aceita.
 */
function normalizeDate(value: string): string {
  if (!value) return "";

  // Já em ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return value;

  // DD/MM/AAAA ou DD-MM-AAAA.
  const pt = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (pt) {
    const [, d, m, y] = pt;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Número de série do Excel (dias desde 1899-12-30).
  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 1 && serial < 60000) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return date.toISOString().slice(0, 10);
  }

  return "";
}

/**
 * Envia as linhas para o servidor. O servidor revalida tudo.
 *
 * `teamName` não segue: serviu para ligar a linha à equipa e o servidor só
 * conhece ids. Uma linha sem `teamId` a esta altura é uma linha cuja equipa
 * ficou por criar, e não é enviada — o diálogo já a contou como recusada.
 */
export function importAthletes(rows: ParsedRow[]) {
  return apiPost<{ created: number; errors: RowError[] }>("/api/athletes/import", {
    rows: rows
      .filter((r) => r.teamId)
      .map(({ line: _line, teamName: _teamName, ...r }) => r),
  });
}
