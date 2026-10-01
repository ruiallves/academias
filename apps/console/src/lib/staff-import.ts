import * as XLSX from "xlsx";
import { apiPost } from "@/lib/http";
import { loadInvites, type PendingInvite } from "@/lib/invites";
import type { AcademyRole } from "@/lib/roles";
import type { StaffMember, Team } from "@/data/types";

/**
 * Importar staff de um ficheiro.
 *
 * Gémeo de `team-import.ts`: as boas linhas entram, as más voltam com o número
 * da linha e o motivo, e nada chumba o ficheiro inteiro.
 *
 * ## O que uma linha cria
 *
 * Um convite **guardado**, e não uma conta: a pessoa fica na lista do clube com
 * o cargo e as equipas, e a conta nasce quando ela abrir o convite e escolher a
 * palavra-passe. Importar não manda email a ninguém, a não ser que quem importa
 * o peça; os convites enviam-se depois, na página do Staff, um a um ou todos.
 *
 * ## As colunas são as da exportação
 *
 * "Nome", "Email", "Cargo" e "Equipas" têm os mesmos cabeçalhos da folha que o
 * botão Exportar escreve (`COLUNAS_EXPORT_STAFF`). Exportar, corrigir e voltar a
 * importar funciona; as outras colunas da exportação (Departamento, Telemóvel,
 * Desde, Estado) são ignoradas aqui, porque o departamento vem do cargo e o
 * resto é da pessoa, que o preenche ao entrar.
 *
 * ## O cargo e as equipas vêm escritos
 *
 * Pelo nome, como estão nas Definições e em Equipas. Resolve-se aqui, no
 * browser, para a pessoa ver o problema antes de enviar: "cargo desconhecido" na
 * linha 7 corrige-se na folha em dez segundos.
 */

export const STAFF_COLUMNS = [
  { key: "name", header: "Nome", required: true, example: "Rui Machado" },
  { key: "email", header: "Email", required: true, example: "rui.machado@exemplo.pt" },
  { key: "role", header: "Cargo", required: true, example: "Treinador" },
  { key: "teams", header: "Equipas", required: false, example: "Sub-11 Futebol, Sub-13 Futebol" },
] as const;

export type StaffRow = {
  line: number;
  name: string;
  email: string;
  academyRoleId: string;
  roleName: string;
  teamIds: string[];
  teamNames: string[];
};
export type StaffRowError = { line: number; name: string; error: string };
export type StaffParseResult = { rows: StaffRow[]; errors: StaffRowError[]; missingColumns: string[] };

/** Compara nomes sem acentos, maiúsculas nem espaços a mais. */
const chave = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const eEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** O modelo, com os cargos e as equipas do clube numa segunda folha. */
export function downloadStaffTemplate(academyName: string, roles: AcademyRole[], teams: Team[]): void {
  const sheet = XLSX.utils.aoa_to_sheet([STAFF_COLUMNS.map((c) => c.header), STAFF_COLUMNS.map((c) => c.example)]);
  sheet["!cols"] = [{ wch: 28 }, { wch: 30 }, { wch: 24 }, { wch: 36 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Staff");

  const linhas = Math.max(roles.length, teams.length);
  const ajuda = XLSX.utils.aoa_to_sheet([
    ["Cargos (escreve exactamente assim)", "Equipas (várias separadas por vírgula)"],
    ...Array.from({ length: linhas }, (_, i) => [roles[i]?.name ?? "", teams[i]?.name ?? ""]),
    [],
    ["As Equipas podem ficar vazias: a pessoa entra sem equipas e atribuem-se depois."],
  ]);
  ajuda["!cols"] = [{ wch: 40 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ajuda, "Cargos e equipas");

  XLSX.writeFile(wb, `staff-${academyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`);
}

/**
 * Lê o ficheiro e separa o que serve do que não serve. Nada sai daqui para o
 * servidor.
 *
 * `staff` e `invites` são quem o clube já tem: uma linha com o email de alguém
 * que já cá está, ou que já tem convite, sai como problema aqui, com o nome à
 * frente, em vez de voltar do servidor como um erro sem contexto.
 */
export async function parseStaffFile(
  file: File,
  ctx: { roles: AcademyRole[]; teams: Team[]; staff: StaffMember[]; invites: PendingInvite[] },
): Promise<StaffParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const obrigatorias = STAFF_COLUMNS.filter((c) => c.required).map((c) => c.header);
  if (!sheet) return { rows: [], errors: [], missingColumns: obrigatorias };

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const present = raw.length ? Object.keys(raw[0]) : (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []);
  const missingColumns = obrigatorias.filter((h) => !present.includes(h));
  if (missingColumns.length > 0) return { rows: [], errors: [], missingColumns };

  const cargoPorNome = new Map(ctx.roles.map((r) => [chave(r.name), r]));
  const equipaPorNome = new Map(ctx.teams.map((t) => [chave(t.name), t]));
  const jaStaff = new Map(ctx.staff.filter((s) => s.isActive).map((s) => [s.email.toLowerCase(), s]));
  const jaConvidado = new Set(ctx.invites.map((i) => i.email.toLowerCase()));

  const rows: StaffRow[] = [];
  const errors: StaffRowError[] = [];
  const vistos = new Set<string>();

  raw.forEach((r, i) => {
    const line = i + 2; // +1 base-0, +1 cabeçalho
    const get = (h: string) => String(r[h] ?? "").trim();
    const name = get("Nome");
    const email = get("Email").toLowerCase();
    const rotulo = name || email || "(linha vazia)";
    const falha = (error: string) => void errors.push({ line, name: rotulo, error });

    if (!name && !email && !get("Cargo")) return; // linha em branco no meio da folha
    if (name.length < 2) return falha("Falta o nome");
    if (!eEmail(email)) return falha(email ? "Email inválido" : "Falta o email");
    if (vistos.has(email)) return falha("Email repetido dentro do ficheiro");

    const cargo = cargoPorNome.get(chave(get("Cargo")));
    if (!cargo) return falha(get("Cargo") ? `Cargo desconhecido: "${get("Cargo")}"` : "Falta o cargo");

    /*
     * Já cá está: quem tem conta activa com o mesmo papel-base é recusado pelo
     * servidor. Diz-se aqui, com o nome, que é mais útil do que o erro de lá.
     * Uma folha exportada e reimportada cai quase toda aqui, e é o certo.
     */
    const existente = jaStaff.get(email);
    if (existente && existente.role === cargo.baseRole) return falha("Já faz parte do staff");
    if (jaConvidado.has(email)) return falha("Já tem um convite por aceitar");

    const nomesDeEquipas = get("Equipas").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    const equipas: Team[] = [];
    for (const n of nomesDeEquipas) {
      const t = equipaPorNome.get(chave(n));
      if (!t) return falha(`Equipa desconhecida: "${n}"`);
      if (!equipas.includes(t)) equipas.push(t);
    }

    vistos.add(email);
    rows.push({
      line,
      name,
      email,
      academyRoleId: cargo.id,
      roleName: cargo.name,
      teamIds: equipas.map((t) => t.id),
      teamNames: equipas.map((t) => t.name),
    });
  });

  return { rows, errors, missingColumns: [] };
}

/** Envia, em blocos. O servidor volta a validar tudo (ver `InvitesService.createMany`). */
export async function importStaff(rows: StaffRow[], enviar: boolean) {
  const BLOCO = 100;
  let created = 0;
  let emailed = 0;
  const errors: StaffRowError[] = [];
  try {
    for (let i = 0; i < rows.length; i += BLOCO) {
      const bloco = rows.slice(i, i + BLOCO);
      const r = await apiPost<{ created: number; emailed: number; errors: { row: number; name: string; error: string }[] }>(
        "/api/invites/importar",
        {
          rows: bloco.map((x) => ({ name: x.name, email: x.email, academyRoleId: x.academyRoleId, teamIds: x.teamIds })),
          enviar,
        },
      );
      created += r.created;
      emailed += r.emailed;
      errors.push(...r.errors.map((e) => ({ line: bloco[e.row]?.line ?? 0, name: e.name, error: e.error })));
    }
  } finally {
    // Mesmo a meio de uma falha: o que entrou tem de aparecer na lista.
    await loadInvites();
  }
  return { created, emailed, errors };
}
