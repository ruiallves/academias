import type { Celula, Folha } from "./extrair";
import type { FolhaMapeada, Transformacao } from "./mapear";
import { normalizar } from "../nomes";

/**
 * Aplicar o mapeamento a todas as linhas.
 *
 * Determinístico de ponta a ponta: a mesma folha com o mesmo mapeamento dá
 * sempre as mesmas linhas. O modelo não vê nenhuma destas linhas. O que não
 * encaixa (uma data que não se lê, uma linha sem nome) fica marcado como erro
 * com o número da linha do ficheiro, para quem corrige saber onde olhar.
 */

export type EquipaDoClube = { id: string; name: string; sportId: string; sportName: string };

export type LinhaDeAtleta = {
  /** A linha no ficheiro (1 é o cabeçalho, como nas outras importações). */
  line: number;
  name: string;
  birthdate: string;
  teamName: string;
  teamId?: string;
  taxId?: string;
  idDocLabel?: string;
  idDocNumber?: string;
  email?: string;
  phone?: string;
  position?: string;
  squadNumber?: number;
  medicalValidUntil?: string;
  heightCm?: number;
  weightDg?: number;
  dominantSide?: "RIGHT" | "LEFT" | "BOTH";
  sex?: "FEMALE" | "MALE";
  licenseNumber?: string;
  citizenCardNumber?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  encarregados?: { nome?: string; email?: string; telefone?: string }[];
};

export type EquipaNova = { name: string; maxAge: number; sportId: string; sportName: string; linhas: number };

export type ResultadoDaTransformacao = {
  rows: LinhaDeAtleta[];
  errors: { line: number; name: string; error: string }[];
  equipasNovas: EquipaNova[];
};

const SEM_LIMITE = 99;

export function transformarAtletas(
  folha: Folha,
  mapa: FolhaMapeada,
  clube: { equipas: EquipaDoClube[]; modalidades: { id: string; name: string }[] },
): ResultadoDaTransformacao {
  const indice = new Map(folha.headers.map((h, i) => [h, i]));
  const colunaDe = (destino: string) => mapa.colunas.find((c) => c.destino === destino && indice.has(c.origem));
  const ler = (linha: Celula[], destino: string): { valor: Celula; transformacao: Transformacao } | null => {
    const c = colunaDe(destino);
    if (!c) return null;
    return { valor: linha[indice.get(c.origem)!] ?? null, transformacao: c.transformacao };
  };
  const texto = (linha: Celula[], destino: string): string | undefined => {
    const r = ler(linha, destino);
    if (!r || r.valor === null) return undefined;
    const s = String(r.valor).trim();
    return s === "" ? undefined : s;
  };

  const equipasPorNome = new Map(clube.equipas.map((e) => [normalizar(e.name), e]));
  const destinoDaEquipa = new Map(mapa.equipas.map((e) => [normalizar(e.origem), e.destino]));
  const novas = new Map<string, EquipaNova>();

  const rows: LinhaDeAtleta[] = [];
  const errors: { line: number; name: string; error: string }[] = [];

  folha.rows.forEach((linha, i) => {
    // A linha como o Excel a mostra; sem a numeração (folhas guardadas antes dela), o velho "índice mais cabeçalho".
    const line = folha.rowNumbers?.[i] ?? i + 2;
    const nome = lerNome(linha, ler, texto);
    if (!nome) {
      errors.push({ line, name: "", error: "Sem nome" });
      return;
    }
    const nascimento = lerData(ler(linha, "birthdate"));
    if (!nascimento) {
      errors.push({ line, name: nome, error: "Data de nascimento em falta ou ilegível" });
      return;
    }
    const equipaDita = texto(linha, "team");
    if (!equipaDita) {
      errors.push({ line, name: nome, error: "Sem equipa" });
      return;
    }

    // A equipa: pelo mapeamento, depois pelo nome, senão é nova.
    const destino = destinoDaEquipa.get(normalizar(equipaDita)) ?? equipaDita;
    const existente = destino !== "nova" ? (equipasPorNome.get(normalizar(destino)) ?? equipasPorNome.get(normalizar(equipaDita))) : undefined;
    const teamName = existente?.name ?? (destino === "nova" ? equipaDita : destino);
    if (!existente) {
      const chave = normalizar(teamName);
      const nova = novas.get(chave) ?? { name: teamName, maxAge: 0, sportId: "", sportName: "", linhas: 0 };
      nova.linhas++;
      nova.maxAge = Math.max(nova.maxAge, idadeNoFimDoAno(nascimento));
      novas.set(chave, nova);
    }

    const peso = lerNumero(texto(linha, "weightKg"));
    const altura = lerNumero(texto(linha, "heightCm"));
    const numero = lerNumero(texto(linha, "squadNumber"));
    const encarregados = [1, 2]
      .map((n) => ({ nome: texto(linha, `guardian${n}Name`), email: texto(linha, `guardian${n}Email`)?.toLowerCase(), telefone: texto(linha, `guardian${n}Phone`) }))
      .filter((e) => e.nome || e.email || e.telefone);

    const row: LinhaDeAtleta = {
      line,
      name: nome,
      birthdate: nascimento,
      teamName,
      ...(existente ? { teamId: existente.id } : {}),
      taxId: soAlgarismos(texto(linha, "taxId")),
      idDocLabel: texto(linha, "idDocLabel"),
      idDocNumber: texto(linha, "idDocNumber"),
      email: texto(linha, "email")?.toLowerCase(),
      phone: texto(linha, "phone"),
      position: texto(linha, "position"),
      squadNumber: numero != null && Number.isInteger(numero) && numero >= 0 && numero <= 999 ? numero : undefined,
      medicalValidUntil: lerData(ler(linha, "medicalValidUntil")) ?? undefined,
      heightCm: altura != null && altura >= 50 && altura <= 250 ? Math.round(altura) : undefined,
      weightDg: peso != null && peso >= 20 && peso <= 200 ? Math.round(peso * 10) : undefined,
      dominantSide: lerLado(texto(linha, "dominantSide")),
      sex: lerSexo(texto(linha, "sex")),
      licenseNumber: texto(linha, "licenseNumber"),
      citizenCardNumber: texto(linha, "citizenCardNumber"),
      address: texto(linha, "address"),
      postalCode: texto(linha, "postalCode"),
      city: texto(linha, "city"),
      ...(encarregados.length ? { encarregados } : {}),
    };
    // Sem `undefined` a viajar para a validação.
    for (const k of Object.keys(row) as (keyof LinhaDeAtleta)[]) if (row[k] === undefined) delete row[k];
    rows.push(row);
  });

  // A modalidade das equipas novas: a única do clube, a que o nome diz, ou a primeira.
  for (const nova of novas.values()) {
    const modalidade =
      clube.modalidades.length === 1
        ? clube.modalidades[0]
        : (clube.modalidades.find((m) => normalizar(nova.name).includes(normalizar(m.name))) ?? clube.modalidades[0]);
    nova.sportId = modalidade?.id ?? "";
    nova.sportName = modalidade?.name ?? "";
    const doNome = idadeDoNome(nova.name);
    nova.maxAge = doNome ?? (nova.maxAge >= 4 && nova.maxAge < SEM_LIMITE ? nova.maxAge : SEM_LIMITE);
  }

  return { rows, errors, equipasNovas: [...novas.values()] };
}

/* -------------------------------------------------------------------------- */
/* Leituras                                                                    */
/* -------------------------------------------------------------------------- */

type Ler = (linha: Celula[], destino: string) => { valor: Celula; transformacao: Transformacao } | null;
type Texto = (linha: Celula[], destino: string) => string | undefined;

function lerNome(linha: Celula[], ler: Ler, texto: Texto): string | null {
  const inteiro = ler(linha, "name");
  if (inteiro && inteiro.valor !== null) {
    let s = String(inteiro.valor).replace(/\s+/g, " ").trim();
    if (inteiro.transformacao === "apelido_nome" && s.includes(",")) {
      const [apelido, nome] = s.split(",").map((p) => p.trim());
      s = `${nome} ${apelido}`.trim();
    }
    return s.length >= 2 ? s.slice(0, 120) : null;
  }
  const primeiro = texto(linha, "firstName");
  const ultimo = texto(linha, "lastName");
  const junto = [primeiro, ultimo].filter(Boolean).join(" ").trim();
  return junto.length >= 2 ? junto.slice(0, 120) : null;
}

/** `AAAA-MM-DD`, ou nulo quando não se lê. */
export function lerData(r: { valor: Celula; transformacao: Transformacao } | null): string | null {
  if (!r || r.valor === null) return null;
  const v = r.valor;
  if (typeof v === "number") {
    // Um número de série do Excel (dias desde 1899-12-30), ou um ano.
    if (v > 20000 && v < 80000) return serialDoExcel(v);
    if (v > 1900 && v < 2100) return `${v}-01-01`;
    return null;
  }
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return valida(+iso[1], +iso[2], +iso[3]);
  if (r.transformacao === "ano_de_nascimento") {
    const ano = /^(\d{4})$/.exec(s);
    if (ano) return `${ano[1]}-01-01`;
    const idade = /^(\d{1,2})$/.exec(s);
    if (idade) return `${new Date().getFullYear() - +idade[1]}-01-01`;
    return null;
  }
  const m = /^(\d{1,4})[/.\-\s](\d{1,2})[/.\-\s](\d{1,4})/.exec(s);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3];
  if (m[1].length === 4) return valida(a, b, c); // aaaa/mm/dd
  const ano = m[3].length === 2 ? (c >= 30 ? 1900 + c : 2000 + c) : c;
  // O formato pedido manda; mas um "mês" acima de 12 só pode ser dia, seja qual for o pedido.
  const dmy = () => valida(ano, b, a);
  const mdy = () => valida(ano, a, b);
  if (r.transformacao === "data_mdy" || r.transformacao === "data_ymd") return mdy() ?? dmy();
  return dmy() ?? mdy();
}

function valida(ano: number, mes: number, dia: number): string | null {
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function serialDoExcel(n: number): string | null {
  const ms = Math.round((n - 25569) * 86_400_000);
  const d = new Date(ms);
  return valida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function lerNumero(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function soAlgarismos(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = s.replace(/\D/g, "");
  return d.length ? d : undefined;
}

function lerSexo(s: string | undefined): "FEMALE" | "MALE" | undefined {
  if (!s) return undefined;
  const n = normalizar(s);
  if (/^(f|fem|feminino|feminina|rapariga|mulher|menina|w|female)$/.test(n)) return "FEMALE";
  if (/^(m|masc|masculino|masculina|rapaz|homem|menino|h|male)$/.test(n)) return "MALE";
  return undefined;
}

function lerLado(s: string | undefined): "RIGHT" | "LEFT" | "BOTH" | undefined {
  if (!s) return undefined;
  const n = normalizar(s);
  if (/^(d|dir|direito|direita|destro|r|right)$/.test(n)) return "RIGHT";
  if (/^(e|esq|esquerdo|esquerda|canhoto|l|left)$/.test(n)) return "LEFT";
  if (/^(a|ambos|ambas|ambidextro|b|both)$/.test(n)) return "BOTH";
  return undefined;
}

/** A idade a 31 de dezembro deste ano, como nos escalões. */
function idadeNoFimDoAno(iso: string): number {
  const ano = Number(iso.slice(0, 4));
  return new Date().getFullYear() - ano;
}

/** "Sub-11" é 11. Igual a `guessMaxAge` da consola. */
export function idadeDoNome(nome: string): number | null {
  const m = /sub[\s.-]*(\d{1,2})\b/i.exec(nome);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 4 && n <= SEM_LIMITE ? n : null;
}
