import * as XLSX from "xlsx";
import { apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";

/**
 * Importar equipas de um ficheiro.
 *
 * Gémeo de `lib/import.ts` — o mesmo desenho, para as duas importações se
 * explicarem uma à outra: as boas linhas entram, as más voltam com o número da
 * linha e o motivo, e nada chumba o ficheiro inteiro.
 *
 * ## A modalidade e a época vêm escritas
 *
 * E não como ids. Quem exporta um ficheiro de equipas do sistema antigo não tem
 * os nossos ids, e obrigá-lo a procurá-los tornava a importação mais lenta do que
 * escrever as equipas à mão — que é exactamente o que isto existe para evitar.
 */

export const TEAM_COLUMNS = [
  { key: "name", header: "Nome", required: true, example: "Sub-11 Futebol" },
  { key: "sport", header: "Modalidade", required: true, example: "Futebol" },
  { key: "ageGroup", header: "Escalão", required: true, example: "Sub-11" },
  { key: "season", header: "Época", required: false, example: "2026/27" },
] as const;

export type TeamRow = { name: string; sport: string; ageGroup: string; season?: string };
export type TeamRowError = { line: number; name: string; error: string };
export type TeamParseResult = { rows: TeamRow[]; errors: TeamRowError[]; missingColumns: string[] };

/** O modelo, com os nomes das modalidades que a academia tem — para não haver dúvida. */
export function downloadTeamTemplate(academyName: string, sports: string[]): void {
  const header = TEAM_COLUMNS.map((c) => c.header);
  const example = TEAM_COLUMNS.map((c) => c.example);
  const sheet = XLSX.utils.aoa_to_sheet([header, example]);
  sheet["!cols"] = TEAM_COLUMNS.map((c) => ({ wch: Math.max(c.header.length, 18) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Equipas");

  if (sports.length > 0) {
    const ajuda = XLSX.utils.aoa_to_sheet([
      ["Escreve a modalidade exactamente como aqui:"],
      ...sports.map((s) => [s]),
      [],
      ["A Época pode ficar vazia — usa a época actual do clube."],
    ]);
    ajuda["!cols"] = [{ wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ajuda, "Modalidades");
  }

  XLSX.writeFile(wb, `equipas-${academyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`);
}

/** Lê o ficheiro e separa o que serve do que não serve. Nada sai daqui para o servidor. */
export async function parseTeamFile(file: File): Promise<TeamParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], errors: [], missingColumns: TEAM_COLUMNS.filter((c) => c.required).map((c) => c.header) };

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const present = raw.length
    ? Object.keys(raw[0])
    : (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []);

  const missingColumns = TEAM_COLUMNS.filter((c) => c.required && !present.includes(c.header)).map((c) => c.header);
  if (missingColumns.length > 0) return { rows: [], errors: [], missingColumns };

  const rows: TeamRow[] = [];
  const errors: TeamRowError[] = [];
  // Nomes repetidos **dentro do ficheiro** — o servidor não os vê como duplicados
  // porque o primeiro ainda não existia quando o segundo foi lido.
  const vistos = new Set<string>();

  raw.forEach((r, i) => {
    const line = i + 2; // +1 base-0, +1 cabeçalho
    const get = (h: string) => String(r[h] ?? "").trim();

    const name = get("Nome");
    if (name.length < 2) {
      errors.push({ line, name: name || "(sem nome)", error: "Falta o nome da equipa" });
      return;
    }
    if (vistos.has(name.toLowerCase())) {
      errors.push({ line, name, error: "Nome repetido dentro do ficheiro" });
      return;
    }
    const sport = get("Modalidade");
    if (!sport) return void errors.push({ line, name, error: "Falta a modalidade" });

    const ageGroup = get("Escalão") || get("Escalao");
    if (!ageGroup) return void errors.push({ line, name, error: "Falta o escalão" });

    vistos.add(name.toLowerCase());
    rows.push({ name, sport, ageGroup, ...(get("Época") || get("Epoca") ? { season: get("Época") || get("Epoca") } : {}) });
  });

  return { rows, errors, missingColumns: [] };
}

/** Envia. O servidor volta a validar tudo — ver `importTeams`. */
export async function importTeams(rows: TeamRow[]) {
  const result = await apiPost<{ created: number; errors: { row: number; name: string; error: string }[] }>(
    "/api/teams/import",
    { rows },
  );
  await reloadAcademy();
  return result;
}
