import { alfa3, estatutoFpf, nomeDoPais } from "./paises";

/**
 * As regras das inscrições federativas, puras.
 *
 * Duas federações, dois boletins: o Modelo 2 da FPF (futebol e futsal) e o
 * Modelo 1 da FPB (basquetebol). Tudo o que decide o que vai escrito vive
 * aqui, sem base de dados nem PDF: a categoria pela idade, o documento, o
 * estatuto, o seguro e o que falta na ficha para a folha sair completa. O
 * serviço junta os dados, isto decide, e `modelo-2.ts` e `modelo-fpb.ts`
 * desenham.
 */

/* -------------------------------------------------------------------------- */
/* O vocabulário                                                               */
/* -------------------------------------------------------------------------- */

export const TIPOS = ["FIRST", "RENEWAL", "TRANSFER_NATIONAL", "TRANSFER_INTERNATIONAL"] as const;
export type Tipo = (typeof TIPOS)[number];

export const ESTADOS = ["GENERATED", "SIGNED", "SUBMITTED", "DONE"] as const;
export type Estado = (typeof ESTADOS)[number];

/** As modalidades com boletim: futebol e futsal (FPF), basquetebol (FPB). */
export type Disciplina = "football" | "futsal" | "basketball";
export type Federacao = "FPF" | "FPB";

export const federacaoDe = (d: Disciplina): Federacao => (d === "basketball" ? "FPB" : "FPF");

/** O boletim da FPB só tem primeira inscrição e revalidação. */
export const tiposDa = (f: Federacao): readonly Tipo[] => (f === "FPB" ? ["FIRST", "RENEWAL"] : TIPOS);

type Cat = { code: string; label: string; ateIdade: number };

/** As categorias do Modelo 2, pela ordem em que lá aparecem. */
const CATEGORIAS_FPF: Cat[] = [
  { code: "01", label: "Sénior", ateIdade: Infinity },
  { code: "03", label: "Júnior A", ateIdade: 19 },
  { code: "05", label: "Júnior B", ateIdade: 17 },
  { code: "07", label: "Júnior C", ateIdade: 15 },
  { code: "09", label: "Júnior D", ateIdade: 13 },
  { code: "12", label: "Benjamim", ateIdade: 11 },
  { code: "15", label: "Traquina", ateIdade: 9 },
  { code: "17", label: "Petiz", ateIdade: 7 },
];

/**
 * Os escalões do Modelo 1 da FPB. Master e BCR (cadeira de rodas) não saem
 * da idade: escolhem-se à mão.
 */
const CATEGORIAS_FPB: Cat[] = [
  { code: "BABY", label: "Baby-Basket", ateIdade: 6 },
  { code: "MINI8", label: "Mini 8", ateIdade: 8 },
  { code: "MINI10", label: "Mini 10", ateIdade: 10 },
  { code: "MINI12", label: "Mini 12", ateIdade: 12 },
  { code: "SUB14", label: "Sub 14", ateIdade: 14 },
  { code: "SUB16", label: "Sub 16", ateIdade: 16 },
  { code: "SUB18", label: "Sub 18", ateIdade: 18 },
  { code: "SENIOR", label: "Sénior", ateIdade: Infinity },
  { code: "MASTER", label: "Master", ateIdade: -1 },
  { code: "BCR", label: "BCR", ateIdade: -1 },
];

export const categoriasDa = (f: Federacao): readonly Cat[] => (f === "FPB" ? CATEGORIAS_FPB : CATEGORIAS_FPF);

export const eTipo = (v: unknown): v is Tipo => typeof v === "string" && (TIPOS as readonly string[]).includes(v);
export const eEstado = (v: unknown): v is Estado => typeof v === "string" && (ESTADOS as readonly string[]).includes(v);
export const eCategoria = (v: unknown, f: Federacao): v is string => categoriasDa(f).some((c) => c.code === v);

/* -------------------------------------------------------------------------- */
/* Época e categoria                                                           */
/* -------------------------------------------------------------------------- */

/** Os dois anos da época, como os boletins os pedem: 2026 e 2027. */
export function anosDaEpoca(epoca: { startsOn: Date; endsOn: Date }): [number, number] {
  const inicio = epoca.startsOn.getUTCFullYear();
  const fim = epoca.endsOn.getUTCFullYear();
  return [inicio, fim > inicio ? fim : inicio + 1];
}

/**
 * A categoria pela data de nascimento.
 *
 * As duas federações contam a idade que o jogador faz no ano em que a época
 * acaba: em 2024/25 os Juniores A (Sub-19) da FPF são os nascidos em 2006 e
 * 2007, e os Sub 14 da FPB os de 2011 e 2012. Cada escalão leva dois anos.
 */
export function categoriaPelaIdade(nascimento: Date, epoca: { startsOn: Date; endsOn: Date }, f: Federacao = "FPF"): string {
  const idade = anosDaEpoca(epoca)[1] - nascimento.getUTCFullYear();
  const porIdade = categoriasDa(f).filter((c) => c.ateIdade >= 0).sort((a, b) => a.ateIdade - b.ateIdade);
  for (const c of porIdade) if (idade <= c.ateIdade) return c.code;
  return porIdade[porIdade.length - 1].code;
}

export const nomeDaCategoria = (code: string, f: Federacao = "FPF") => categoriasDa(f).find((c) => c.code === code)?.label ?? code;

/* -------------------------------------------------------------------------- */
/* O documento de identificação                                                */
/* -------------------------------------------------------------------------- */

/** NIC, PAS, AR, CR e TR — as siglas da nota (1) do Modelo 2. */
export type SiglaDoc = "NIC" | "PAS" | "AR" | "CR" | "TR";

export type Documento = {
  sigla: SiglaDoc;
  /** O número de identificação civil (sem o dígito), ou o número do outro documento. */
  numero: string;
  checkDigit: string | null;
  /** O número como está na ficha, por inteiro ("12345678 9 ZZ1"). É o que a FPB pede. */
  completo: string;
  /** O nome que o clube deu ao documento, para o "Outro" da FPB. */
  descricao: string | null;
};

/**
 * O documento que vai no boletim.
 *
 * O Cartão de Cidadão primeiro: é o que as federações querem de um português.
 * No Modelo 2 o número é o de identificação civil (os primeiros oito
 * algarismos), com o dígito de controlo à parte: "12345678 9 ZZ1" dá
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
    const completo = (a.citizenCardNumber ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    const m = /^(\d{6,8}?)(\d)?([A-Z]{2}\d)?$/.exec(cc);
    if (m) {
      // Nove algarismos são oito mais o dígito de controlo; oito ou menos, só o número.
      const digitos = (m[1] + (m[2] ?? "")).length;
      if (digitos === 9 || m[3]) {
        const tudo = m[1] + (m[2] ?? "");
        return { sigla: "NIC", numero: tudo.slice(0, -1), checkDigit: tudo.slice(-1), completo, descricao: null };
      }
      return { sigla: "NIC", numero: m[1] + (m[2] ?? ""), checkDigit: null, completo, descricao: null };
    }
    return { sigla: "NIC", numero: cc.slice(0, 14), checkDigit: null, completo, descricao: null };
  }

  if (a.idDocNumber) {
    const sigla = siglaDoNome(a.idDocLabel);
    return sigla
      ? { sigla, numero: a.idDocNumber.slice(0, 14), checkDigit: null, completo: a.idDocNumber, descricao: a.idDocLabel?.trim() || null }
      : null;
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
  /* O que só a FPB pede. Opcionais para os testes e os chamadores antigos. */
  taxId?: string | null;
  idDocValidUntil?: Date | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  district?: string | null;
  municipality?: string | null;
};

/** O clube nesta modalidade: o nome e a associação (do clube), o código e o seguro (da modalidade). */
export type Clube = {
  name: string;
  federationClubCode: string | null;
  association: string | null;
  insuranceKind?: string | null;
  insurancePolicy?: string | null;
  insuranceCompany?: string | null;
};

export type Seguro = { tipo: "FPB" | "CLUB"; apolice: string | null; companhia: string | null };

/** Tudo o que se escreve numa folha, já decidido. É o que os desenhos usam. */
export type Folha = {
  federacao: Federacao;
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
  categoria: string;
  clube: { codigo: string | null; nome: string };
  /* Só a FPB. */
  nif: string | null;
  validadeDoc: Date | null;
  morada: string | null;
  codigoPostal: string | null;
  localidade: string | null;
  distrito: string | null;
  concelho: string | null;
  seguro: Seguro | null;
};

/**
 * O estatuto do boletim da FPB pela nacionalidade.
 *
 * "FBP" é o jogador formado no basquetebol português; a plataforma propõe-no
 * aos portugueses. Um estrangeiro formado cá também o pode ser: escreve-se à
 * mão. Os outros são "sem FBP", comunitário ou não.
 */
export function estatutoFpb(nacionalidade: string | null): "FBP" | "COMUNITARIO" | "NAO_COMUNITARIO" | null {
  const e = estatutoFpf(nacionalidade);
  if (!e) return null;
  return e === "Português" ? "FBP" : e === "União Europeia" ? "COMUNITARIO" : "NAO_COMUNITARIO";
}

/**
 * O seguro desportivo da modalidade.
 *
 * O clube diz qual é. Sem seguro do clube, vale o da FPB (e a apólice e a
 * companhia ficam em branco); com seguro do clube, vão os dois.
 */
export function seguroDe(c: Clube): Seguro | null {
  if (c.insuranceKind === "CLUB") return { tipo: "CLUB", apolice: c.insurancePolicy ?? null, companhia: c.insuranceCompany ?? null };
  if (c.insuranceKind === "FPB") return { tipo: "FPB", apolice: null, companhia: null };
  return null;
}

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
  categoria: string;
  licenca: string | null;
  contactoDoEncarregado?: { email: string | null; phone: string | null };
}): Folha {
  const { atleta } = p;
  const federacao = federacaoDe(p.disciplina);
  const pais = (c: string | null) => {
    const nome = nomeDoPais(c);
    const codigo = alfa3(c);
    return nome && codigo ? { nome, codigo } : null;
  };
  return {
    federacao,
    epoca: anosDaEpoca(p.epoca),
    associacao: p.clube.association,
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
    estatuto: federacao === "FPB" ? estatutoFpb(atleta.nationality) : estatutoFpf(atleta.nationality),
    categoria: p.categoria,
    clube: { codigo: p.clube.federationClubCode, nome: p.clube.name },
    nif: atleta.taxId ?? null,
    validadeDoc: atleta.idDocValidUntil ?? null,
    morada: atleta.address ?? null,
    codigoPostal: atleta.postalCode ?? null,
    localidade: atleta.city ?? null,
    distrito: atleta.district ?? null,
    concelho: atleta.municipality ?? null,
    seguro: federacao === "FPB" ? seguroDe(p.clube) : null,
  };
}

/** Os boletins têm nove casas para o telefone: sem indicativo nem espaços. */
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
  if (f.federacao === "FPF" && f.documento?.sigla === "NIC" && !f.documento.checkDigit) falta.push("dígito de controlo do CC");
  if (f.federacao === "FPB" && f.documento && !f.validadeDoc) falta.push("validade do documento");
  if (!f.paisNascimento) falta.push("país de nascimento");
  if (!f.nacionalidade) falta.push("nacionalidade");
  if (!f.genero) falta.push("sexo");
  if (!f.email) falta.push("email");
  if (!f.telefone) falta.push("telefone");
  if (f.federacao === "FPB") {
    if (!f.nif) falta.push("NIF");
    if (!f.morada) falta.push("morada");
    if (!f.codigoPostal) falta.push("código postal");
    if (!f.localidade) falta.push("localidade");
    if (!f.distrito) falta.push("distrito");
    if (!f.concelho) falta.push("concelho");
  }
  return falta;
}

/** O que falta ao clube nesta modalidade, que vale para todas as folhas dela. */
export function emFaltaNoClube(c: Clube, f: Federacao): string[] {
  const falta: string[] = [];
  if (!c.federationClubCode && f === "FPF") falta.push("código do clube");
  if (!c.association) falta.push(f === "FPB" ? "associação de basquetebol" : "associação de futebol");
  if (f === "FPB") {
    if (!c.insuranceKind) falta.push("seguro desportivo");
    else if (c.insuranceKind === "CLUB" && (!c.insurancePolicy || !c.insuranceCompany)) falta.push("apólice e companhia do seguro");
  }
  return falta;
}

/** O tipo de boletim que se propõe: revalidação para quem já teve licença nesta modalidade. */
export function tipoProposto(temLicencaAnterior: boolean): Tipo {
  return temLicencaAnterior ? "RENEWAL" : "FIRST";
}

/* -------------------------------------------------------------------------- */
/* O clube na federação                                                        */
/* -------------------------------------------------------------------------- */

/**
 * As associações distritais e regionais. O que se guarda é o nome, sem o
 * prefixo: "Braga" é a AF Braga numa modalidade de futebol e a AB Braga numa
 * de basquetebol.
 */
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

const textoLivre = (v: string | undefined): string | null => (v ?? "").trim().replace(/\s+/g, " ") || null;

/**
 * Os campos da federação que vieram no pedido de uma modalidade, prontos a
 * gravar. Só os que vieram; vazio limpa. Lança `Error` com a frase do erro.
 */
export function federacaoDaModalidade(dto: {
  federationClubCode?: string;
  insuranceKind?: string;
  insurancePolicy?: string;
  insuranceCompany?: string;
}) {
  const out: {
    federationClubCode?: string | null;
    insuranceKind?: string | null;
    insurancePolicy?: string | null;
    insuranceCompany?: string | null;
  } = {};
  if (dto.federationClubCode !== undefined) out.federationClubCode = normalizarCodigoDoClube(dto.federationClubCode);
  if (dto.insuranceKind !== undefined) {
    if (dto.insuranceKind && dto.insuranceKind !== "FPB" && dto.insuranceKind !== "CLUB") throw new Error("Seguro desconhecido");
    out.insuranceKind = dto.insuranceKind || null;
    // O seguro da FPB não tem apólice do clube: o que lá estava deixa de valer.
    if (dto.insuranceKind !== "CLUB") {
      out.insurancePolicy = null;
      out.insuranceCompany = null;
    }
  }
  if (dto.insurancePolicy !== undefined && out.insurancePolicy === undefined) out.insurancePolicy = textoLivre(dto.insurancePolicy);
  if (dto.insuranceCompany !== undefined && out.insuranceCompany === undefined) out.insuranceCompany = textoLivre(dto.insuranceCompany);
  return out;
}
