import { alfa3, estatutoFpf, nomeDoPais } from "./paises";

/**
 * As regras das inscrições na FPF, puras.
 *
 * Tudo o que decide o que vai escrito no Modelo 2 vive aqui, sem base de dados
 * nem PDF: a categoria pela idade, o tipo e o número do documento, o estatuto,
 * e o que falta na ficha para a folha sair completa. O serviço junta os dados,
 * isto decide, e `modelo-2.ts` desenha.
 */

/* -------------------------------------------------------------------------- */
/* O vocabulário                                                               */
/* -------------------------------------------------------------------------- */

export const TIPOS = ["FIRST", "RENEWAL", "TRANSFER_NATIONAL", "TRANSFER_INTERNATIONAL"] as const;
export type Tipo = (typeof TIPOS)[number];

export const ESTADOS = ["GENERATED", "SIGNED", "SUBMITTED", "DONE"] as const;
export type Estado = (typeof ESTADOS)[number];

/** As categorias do boletim, pela ordem em que lá aparecem. */
export const CATEGORIAS = [
  { code: "01", label: "Sénior", ateIdade: Infinity },
  { code: "03", label: "Júnior A", ateIdade: 19 },
  { code: "05", label: "Júnior B", ateIdade: 17 },
  { code: "07", label: "Júnior C", ateIdade: 15 },
  { code: "09", label: "Júnior D", ateIdade: 13 },
  { code: "12", label: "Benjamim", ateIdade: 11 },
  { code: "15", label: "Traquina", ateIdade: 9 },
  { code: "17", label: "Petiz", ateIdade: 7 },
] as const;
export type Categoria = (typeof CATEGORIAS)[number]["code"];

export const eTipo = (v: unknown): v is Tipo => typeof v === "string" && (TIPOS as readonly string[]).includes(v);
export const eEstado = (v: unknown): v is Estado => typeof v === "string" && (ESTADOS as readonly string[]).includes(v);
export const eCategoria = (v: unknown): v is Categoria => CATEGORIAS.some((c) => c.code === v);

/** Só futebol e futsal têm Modelo 2. */
export type Disciplina = "football" | "futsal";

/* -------------------------------------------------------------------------- */
/* Época e categoria                                                           */
/* -------------------------------------------------------------------------- */

/** Os dois anos da época, como o boletim os pede: 2026 e 2027. */
export function anosDaEpoca(epoca: { startsOn: Date; endsOn: Date }): [number, number] {
  const inicio = epoca.startsOn.getUTCFullYear();
  const fim = epoca.endsOn.getUTCFullYear();
  return [inicio, fim > inicio ? fim : inicio + 1];
}

/**
 * A categoria FPF pela data de nascimento.
 *
 * A federação conta a idade que o jogador faz no ano em que a época acaba: em
 * 2024/25 os Juniores A (Sub-19) são os nascidos em 2006 e 2007. Cada
 * categoria leva dois anos, e acima de 19 é Sénior.
 */
export function categoriaPelaIdade(nascimento: Date, epoca: { startsOn: Date; endsOn: Date }): Categoria {
  const idade = anosDaEpoca(epoca)[1] - nascimento.getUTCFullYear();
  // Do mais novo para o mais velho: a primeira em que cabe.
  for (const c of [...CATEGORIAS].reverse()) if (idade <= c.ateIdade) return c.code;
  return "01";
}

export const nomeDaCategoria = (code: string) => CATEGORIAS.find((c) => c.code === code)?.label ?? code;

/* -------------------------------------------------------------------------- */
/* O documento de identificação                                                */
/* -------------------------------------------------------------------------- */

/** NIC, PAS, AR, CR e TR — as siglas da nota (1) do boletim. */
export type SiglaDoc = "NIC" | "PAS" | "AR" | "CR" | "TR";

export type Documento = { sigla: SiglaDoc; numero: string; checkDigit: string | null };

/**
 * O documento que vai no boletim.
 *
 * O Cartão de Cidadão primeiro: é o que a federação quer de um português, e o
 * número que se escreve é o de identificação civil (os primeiros oito
 * algarismos), com o dígito de controlo à parte. "12345678 9 ZZ1" dá
 * `12345678` e `9`.
 *
 * Sem CC, o outro documento da ficha (o de quem não tem NIF). A sigla sai do
 * nome que o clube lhe deu: "Passaporte" é PAS, "Título de residência" é TR.
 * Um nome que não diz que documento é (`null`) fica por preencher.
 */
export function documentoDoAtleta(a: {
  citizenCardNumber: string | null;
  idDocLabel: string | null;
  idDocNumber: string | null;
}): Documento | null {
  const cc = (a.citizenCardNumber ?? "").toUpperCase().replace(/[\s.-]/g, "");
  if (cc) {
    const m = /^(\d{6,8}?)(\d)?([A-Z]{2}\d)?$/.exec(cc);
    if (m) {
      // Nove algarismos são oito mais o dígito de controlo; oito ou menos, só o número.
      const digitos = (m[1] + (m[2] ?? "")).length;
      if (digitos === 9 || m[3]) {
        const tudo = m[1] + (m[2] ?? "");
        return { sigla: "NIC", numero: tudo.slice(0, -1), checkDigit: tudo.slice(-1) };
      }
      return { sigla: "NIC", numero: m[1] + (m[2] ?? ""), checkDigit: null };
    }
    return { sigla: "NIC", numero: cc.slice(0, 14), checkDigit: null };
  }

  if (a.idDocNumber) {
    const sigla = siglaDoNome(a.idDocLabel);
    return sigla ? { sigla, numero: a.idDocNumber.slice(0, 14), checkDigit: null } : null;
  }
  return null;
}

export function siglaDoNome(nome: string | null): SiglaDoc | null {
  const n = (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!n) return null;
  if (/passa?porte|passport|\bpas\b/.test(n)) return "PAS";
  if (/autoriza/.test(n) || /^ar$/.test(n.trim())) return "AR";
  if (/titulo/.test(n) || /^tr$/.test(n.trim())) return "TR";
  if (/cartao\s+de\s+resid|^cr$/.test(n.trim())) return "CR";
  if (/cidadao|bilhete|\bbi\b|\bcc\b|\bnic\b/.test(n)) return "NIC";
  return null;
}

/* -------------------------------------------------------------------------- */
/* A folha de um jogador                                                       */
/* -------------------------------------------------------------------------- */

export type AtletaParaFolha = {
  name: string;
  birthdate: Date;
  sex: "MALE" | "FEMALE" | null;
  citizenCardNumber: string | null;
  idDocLabel: string | null;
  idDocNumber: string | null;
  birthCountry: string | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
};

export type Clube = { name: string; fpfClubCode: string | null; footballAssociation: string | null };

/** Tudo o que se escreve numa folha, já decidido. É o que `modelo-2.ts` desenha. */
export type Folha = {
  epoca: [number, number];
  associacao: string | null;
  disciplina: Disciplina;
  genero: "MALE" | "FEMALE" | null;
  tipo: Tipo;
  licenca: string | null;
  nome: string;
  nascimento: Date;
  documento: Documento | null;
  paisNascimento: { nome: string; codigo: string } | null;
  nacionalidade: { nome: string; codigo: string } | null;
  email: string | null;
  telefone: string | null;
  estatuto: string | null;
  categoria: Categoria;
  clube: { codigo: string | null; nome: string };
};

/**
 * Monta a folha.
 *
 * O género vem do atleta e, sem ele, da equipa (uma equipa feminina só tem
 * jogadoras). Uma equipa mista não decide nada.
 */
export function montarFolha(p: {
  atleta: AtletaParaFolha;
  clube: Clube;
  epoca: { startsOn: Date; endsOn: Date };
  disciplina: Disciplina;
  generoDaEquipa: "MALE" | "FEMALE" | null;
  tipo: Tipo;
  categoria: Categoria;
  licenca: string | null;
  contactoDoEncarregado?: { email: string | null; phone: string | null };
}): Folha {
  const { atleta } = p;
  const pais = (c: string | null) => {
    const nome = nomeDoPais(c);
    const codigo = alfa3(c);
    return nome && codigo ? { nome, codigo } : null;
  };
  return {
    epoca: anosDaEpoca(p.epoca),
    associacao: p.clube.footballAssociation,
    disciplina: p.disciplina,
    genero: atleta.sex ?? p.generoDaEquipa,
    tipo: p.tipo,
    licenca: p.licenca,
    nome: atleta.name.trim().replace(/\s+/g, " "),
    nascimento: atleta.birthdate,
    documento: documentoDoAtleta(atleta),
    paisNascimento: pais(atleta.birthCountry),
    nacionalidade: pais(atleta.nationality),
    email: atleta.email ?? p.contactoDoEncarregado?.email ?? null,
    telefone: telefoneDaFolha(atleta.phone ?? p.contactoDoEncarregado?.phone ?? null),
    estatuto: estatutoFpf(atleta.nationality),
    categoria: p.categoria,
    clube: { codigo: p.clube.fpfClubCode, nome: p.clube.name },
  };
}

/** O boletim tem nove casas para o telefone: sem indicativo nem espaços. */
export function telefoneDaFolha(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/[^\d]/g, "").replace(/^00351|^351(?=\d{9}$)/, "");
  return d ? d.slice(-9) : null;
}

/**
 * O que falta na ficha para a folha sair completa, em português.
 *
 * Não impede ninguém de gerar: a folha sai com esses campos em branco, para
 * escrever à mão. Serve para o ecrã dizer o que corrigir antes, e onde.
 */
export function emFalta(f: Folha): string[] {
  const falta: string[] = [];
  if (!f.documento) falta.push("documento de identificação");
  if (f.documento?.sigla === "NIC" && !f.documento.checkDigit) falta.push("dígito de controlo do CC");
  if (!f.paisNascimento) falta.push("país de nascimento");
  if (!f.nacionalidade) falta.push("nacionalidade");
  if (!f.genero) falta.push("sexo");
  if (!f.email) falta.push("email");
  if (!f.telefone) falta.push("telefone");
  return falta;
}

/** O que falta ao clube, que vale para todas as folhas. */
export function emFaltaNoClube(c: Clube): string[] {
  const falta: string[] = [];
  if (!c.fpfClubCode) falta.push("código do clube");
  if (!c.footballAssociation) falta.push("associação de futebol");
  return falta;
}

/** O tipo de boletim que se propõe: revalidação para quem já teve licença nesta modalidade. */
export function tipoProposto(temLicencaAnterior: boolean): Tipo {
  return temLicencaAnterior ? "RENEWAL" : "FIRST";
}

/* -------------------------------------------------------------------------- */
/* O clube na federação                                                        */
/* -------------------------------------------------------------------------- */

/** As 22 associações distritais e regionais. O que se guarda é o nome, sem o "AF". */
export const ASSOCIACOES = [
  "Algarve", "Angra do Heroísmo", "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco",
  "Coimbra", "Évora", "Guarda", "Horta", "Leiria", "Lisboa", "Madeira", "Ponta Delgada",
  "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu",
] as const;

export function associacaoValida(v: string): boolean {
  return (ASSOCIACOES as readonly string[]).includes(v);
}

/** O código do clube: só algarismos, até dez. Vazio é nulo. */
export function normalizarCodigoDoClube(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, "");
  if (!t) return null;
  if (!/^\d{1,10}$/.test(t)) throw new Error("O código do clube tem só algarismos");
  return t;
}
