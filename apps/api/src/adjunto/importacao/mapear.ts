import { amostraMascarada, type Folha } from "./extrair";

/**
 * O mapeamento: o que cada coluna do ficheiro é, para nós.
 *
 * ## A regra que importa
 *
 * A IA mapeia, o código transforma. O modelo vê os cabeçalhos e cinco linhas
 * mascaradas de cada folha, e decide **uma vez**: esta folha são atletas, a
 * coluna "DN" é a data de nascimento em dia/mês/ano, "Escalão" é a equipa e
 * "Infantis B" é o nosso "Sub-12". Depois é o código que aplica isso às 300
 * linhas, de forma determinística. É o que impede um NIF inventado na linha
 * 212.
 *
 * ## As dúvidas
 *
 * Quando o modelo não tem a certeza (03/04/2014 tanto é 3 de abril como 4 de
 * março), não adivinha: devolve uma dúvida com as opções, e a consola mostra
 * botões. Cada botão corrige o mapeamento e ensaia outra vez.
 */

export const ENTIDADES = ["atletas", "staff", "socios", "calendario", "inventario", "ignorar"] as const;
export type Entidade = (typeof ENTIDADES)[number];

/** Os campos de um atleta, na forma da importação de sempre (`lib/import.ts` da consola). */
export const CAMPOS_DE_ATLETA = [
  "name", "birthdate", "team", "taxId", "idDocLabel", "idDocNumber", "email", "position", "squadNumber",
  "medicalValidUntil", "heightCm", "weightKg", "dominantSide", "sex", "licenseNumber", "citizenCardNumber",
  "address", "postalCode", "city", "phone",
  "guardian1Name", "guardian1Email", "guardian1Phone", "guardian2Name", "guardian2Email", "guardian2Phone",
  // Duas colunas que os clubes têm e que nós juntamos no nome, ou separamos.
  "firstName", "lastName",
  "ignorar",
] as const;
export type CampoDeAtleta = (typeof CAMPOS_DE_ATLETA)[number];

export const TRANSFORMACOES = [
  "nenhuma",
  /** dd/mm/aaaa, o normal em Portugal. */
  "data_dmy",
  /** mm/dd/aaaa, de folhas feitas em programas americanos. */
  "data_mdy",
  /** aaaa-mm-dd ou aaaa/mm/dd. */
  "data_ymd",
  /** A coluna traz a idade ou o ano de nascimento, não a data. */
  "ano_de_nascimento",
  /** "Apelido, Nome" → "Nome Apelido". */
  "apelido_nome",
  /** Texto para número (altura, peso, camisola). */
  "numero",
  /** M/F, Masculino/Feminino, H/M. */
  "sexo",
  /** Direito/Esquerdo/Ambos, D/E. */
  "lado",
  /** Sim/Não, X, 1/0. */
  "sim_nao",
] as const;
export type Transformacao = (typeof TRANSFORMACOES)[number];

export type ColunaMapeada = {
  origem: string;
  destino: string;
  transformacao: Transformacao;
  nota: string;
};

export type Duvida = {
  /** A coluna a que a dúvida se refere. */
  coluna: string;
  texto: string;
  opcoes: { label: string; transformacao: Transformacao }[];
};

export type EquipaMapeada = {
  /** Como vem no ficheiro: "Infantis B". */
  origem: string;
  /** O nome da nossa equipa, ou "nova" para criar com este nome. */
  destino: string;
};

export type FolhaMapeada = {
  nome: string;
  entidade: Entidade;
  confianca: "alta" | "media" | "baixa";
  colunas: ColunaMapeada[];
  equipas: EquipaMapeada[];
  duvidas: Duvida[];
};

export type Mapeamento = {
  folhas: FolhaMapeada[];
  /** Uma ou duas frases para a pessoa: o que se percebeu e o que se assumiu. */
  resumo: string;
};

/** O que o modelo vê sobre o clube, para encaixar equipas e modalidades. */
export type ClubeParaOMapeamento = {
  equipas: { nome: string; modalidade: string }[];
  modalidades: string[];
};

const str = { type: "string" } as const;

export const SCHEMA_DO_MAPEAMENTO: Record<string, unknown> = {
  type: "object",
  properties: {
    folhas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: str,
          entidade: { type: "string", enum: [...ENTIDADES] },
          confianca: { type: "string", enum: ["alta", "media", "baixa"] },
          colunas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                origem: str,
                destino: str,
                transformacao: { type: "string", enum: [...TRANSFORMACOES] },
                nota: str,
              },
              required: ["origem", "destino", "transformacao", "nota"],
              additionalProperties: false,
            },
          },
          equipas: {
            type: "array",
            items: { type: "object", properties: { origem: str, destino: str }, required: ["origem", "destino"], additionalProperties: false },
          },
          duvidas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                coluna: str,
                texto: str,
                opcoes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { label: str, transformacao: { type: "string", enum: [...TRANSFORMACOES] } },
                    required: ["label", "transformacao"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["coluna", "texto", "opcoes"],
              additionalProperties: false,
            },
          },
        },
        required: ["nome", "entidade", "confianca", "colunas", "equipas", "duvidas"],
        additionalProperties: false,
      },
    },
    resumo: str,
  },
  required: ["folhas", "resumo"],
  additionalProperties: false,
};

export const INSTRUCOES_DO_MAPEAMENTO = [
  "Vais mapear as folhas de um ficheiro que um clube desportivo português mandou para a sua plataforma de gestão.",
  "Para cada folha, diz que entidade é e o que é cada coluna. Vês os cabeçalhos e cinco linhas de amostra com os valores mascarados na forma (#### é um número, x@x.pt um email, 'Martim B.' um nome).",
  "",
  "Entidades: atletas (jogadores, inscritos, plantel), staff (treinadores, dirigentes), socios, calendario (treinos, jogos), inventario (equipamento, material), ignorar (uma folha de notas, totais, ou sem dados úteis).",
  "Só a entidade atletas é importada já; as outras ficam marcadas para depois. Mapeia-as na mesma, com o melhor destino que conseguires, mas não gastes esforço nelas.",
  "",
  `Campos de atletas: ${CAMPOS_DE_ATLETA.filter((c) => c !== "ignorar").join(", ")}. Uma coluna que não serve leva destino "ignorar".`,
  "- name é o nome completo. Se o ficheiro tiver o nome em duas colunas, usa firstName e lastName e o código junta-as.",
  "- team é a equipa ou escalão (Sub-11, Infantis B, Petizes). Em `equipas`, liga cada valor distinto dessa coluna a uma equipa do clube pelo nome, ou a \"nova\" se o clube não tiver nenhuma que corresponda. Escalões portugueses: Petizes Sub-7, Traquinas Sub-9, Benjamins Sub-11, Infantis Sub-13, Iniciados Sub-15, Juvenis Sub-17, Juniores Sub-19. Um 'Infantis B' corresponde a um 'Sub-13' ou 'Sub-12' do clube quando só houver um; com dúvida, \"nova\".",
  "- birthdate é a data de nascimento. Se as amostras vierem como AAAA-MM-DD a transformação é nenhuma. Se vierem dd/mm/aaaa é data_dmy; se não der para distinguir de mm/dd/aaaa, mete data_dmy (o normal em Portugal) e cria uma dúvida com as duas opções.",
  "- taxId é o NIF (9 algarismos). citizenCardNumber o Cartão de Cidadão. idDocNumber outro documento (passaporte). licenseNumber o número de licença federativa.",
  "- guardian1Name/Email/Phone e guardian2Name/Email/Phone são os encarregados de educação (pai, mãe, mãe/pai, EE, contacto).",
  "- medicalValidUntil é a validade do exame médico. heightCm e weightKg a altura e o peso. dominantSide o pé ou mão dominante. sex o sexo. squadNumber o número da camisola. position a posição.",
  "",
  "Transformações: nenhuma, data_dmy, data_mdy, data_ymd, ano_de_nascimento (a coluna traz só o ano ou a idade), apelido_nome ('Silva, João'), numero, sexo, lado, sim_nao.",
  "Em `duvidas` põe só o que muda o resultado e que a pessoa consegue responder com um botão: o formato de uma data, se uma coluna é equipa ou posição. Nada de perguntas abertas.",
  "O `resumo` tem uma a três frases em português de Portugal, diretas, sem travessões: o que percebeste e o que assumiste.",
].join("\n");

/** A entrada do modelo: as folhas em resumo mais o clube. */
export function entradaDoMapeamento(folhas: Folha[], clube: ClubeParaOMapeamento): string {
  const partes = folhas.map((f) => {
    const amostra = amostraMascarada(f);
    const equipasVistas = new Set<string>();
    // Os valores distintos das colunas que parecem equipa, para o modelo os ligar.
    for (const [i, h] of f.headers.entries()) {
      if (/equipa|escal|categoria|turma|grupo|team/i.test(h)) {
        for (const linha of f.rows) {
          const v = linha[i];
          if (typeof v === "string" && equipasVistas.size < 40) equipasVistas.add(v);
        }
      }
    }
    return [
      `Folha "${f.name}": ${f.rows.length} linhas${f.cortadas ? ` (mais ${f.cortadas} cortadas)` : ""}.`,
      `Colunas: ${f.headers.map((h) => `"${h}"`).join(", ")}`,
      `Amostra: ${JSON.stringify(amostra)}`,
      equipasVistas.size ? `Valores distintos nas colunas de equipa: ${[...equipasVistas].map((v) => `"${v}"`).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `Clube: modalidades ${clube.modalidades.join(", ") || "(nenhuma)"}; equipas desta época: ${clube.equipas.map((e) => `"${e.nome}" (${e.modalidade})`).join(", ") || "(nenhuma)"}.`,
    "",
    ...partes,
  ].join("\n\n");
}

/** Lê e sanea o que o modelo devolveu: nomes de folha e colunas têm de existir. */
export function lerMapeamento(texto: string, folhas: Folha[]): Mapeamento {
  let bruto: Mapeamento;
  try {
    bruto = JSON.parse(texto) as Mapeamento;
  } catch {
    throw new Error("O mapeamento não veio em JSON válido");
  }
  return sanearMapeamento(bruto, folhas);
}

export function sanearMapeamento(bruto: Partial<Mapeamento>, folhas: Folha[]): Mapeamento {
  const porNome = new Map(folhas.map((f) => [f.name, f]));
  const saida: FolhaMapeada[] = [];
  for (const f of folhas) {
    const m = (bruto.folhas ?? []).find((x) => x.nome === f.name);
    if (!m) {
      saida.push({ nome: f.name, entidade: "ignorar", confianca: "baixa", colunas: [], equipas: [], duvidas: [] });
      continue;
    }
    const cabecalhos = new Set(f.headers);
    const colunas = (m.colunas ?? [])
      .filter((c) => cabecalhos.has(c.origem))
      .map((c) => ({
        origem: c.origem,
        destino: String(c.destino ?? "ignorar"),
        transformacao: (TRANSFORMACOES as readonly string[]).includes(c.transformacao) ? c.transformacao : "nenhuma",
        nota: String(c.nota ?? "").slice(0, 200),
      }));
    // As colunas de que o modelo não falou ficam ignoradas, mas visíveis.
    for (const h of f.headers) if (!colunas.some((c) => c.origem === h)) colunas.push({ origem: h, destino: "ignorar", transformacao: "nenhuma", nota: "" });
    saida.push({
      nome: f.name,
      entidade: (ENTIDADES as readonly string[]).includes(m.entidade) ? m.entidade : "ignorar",
      confianca: m.confianca === "alta" || m.confianca === "media" ? m.confianca : "baixa",
      colunas,
      equipas: (m.equipas ?? []).map((e) => ({ origem: String(e.origem), destino: String(e.destino ?? "nova") })).slice(0, 60),
      duvidas: (m.duvidas ?? [])
        .filter((d) => cabecalhos.has(d.coluna))
        .map((d) => ({
          coluna: d.coluna,
          texto: String(d.texto ?? "").slice(0, 300),
          opcoes: (d.opcoes ?? []).filter((o) => (TRANSFORMACOES as readonly string[]).includes(o.transformacao)).slice(0, 4),
        }))
        .filter((d) => d.opcoes.length > 0)
        .slice(0, 6),
    });
  }
  void porNome;
  return { folhas: saida, resumo: String(bruto.resumo ?? "").slice(0, 600) };
}
