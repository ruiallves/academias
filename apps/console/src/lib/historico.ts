import { apiGet } from "@/lib/http";

/**
 * O histórico de alterações de uma ficha.
 *
 * O servidor guarda uma linha por **campo** mudado (`ProfileChange`), com o antes,
 * o depois, quem mexeu e quando. Aqui só se traduz: o nome do campo passa a
 * português e o valor passa à forma como aparece na ficha — um sócio não muda de
 * `documentKind` para `CC`, muda de "Documento" para "Cartão de Cidadão".
 *
 * Campos sem tradução aparecem como vêm em vez de desaparecerem: é preferível um
 * histórico com um nome técnico a um histórico com um buraco, e o nome técnico é
 * o aviso de que falta uma linha nesta tabela.
 */
export type TipoDePerfil = "atletas" | "socios" | "staff";

export type Alteracao = {
  id: string;
  field: string;
  before: string | null;
  after: string | null;
  byName: string | null;
  createdAt: string;
};

export function lerHistorico(tipo: TipoDePerfil, id: string, limite = 60) {
  return apiGet<Alteracao[]>(`/api/historico/${tipo}/${id}?limite=${limite}`);
}

const CAMPOS: Record<string, string> = {
  /* Atleta */
  name: "Nome",
  email: "E-mail",
  birthdate: "Data de nascimento",
  taxId: "Contribuinte",
  idDocLabel: "Outro documento",
  idDocNumber: "N.º do documento",
  status: "Estado",
  medicalValidUntil: "Exame médico válido até",
  heightCm: "Altura",
  weightKg: "Peso",
  dominantSide: "Lado dominante",
  squadNumber: "Número",
  team: "Equipa",
  position: "Posição",
  /* Sócio */
  phone: "Telemóvel",
  phoneCountry: "Indicativo",
  address: "Morada",
  postalCode: "Código postal",
  city: "Localidade",
  country: "País",
  categoria: "Categoria",
  notes: "Notas",
  number: "Número de sócio",
  sex: "Sexo",
  documentKind: "Tipo de documento",
  documentNumber: "Documento",
  acceptedTermsAt: "Termos e condições",
  /* Staff */
  acesso: "Acesso à consola",
  cargo: "Cargo",
  equipas: "Equipas",
  permissoesDadas: "Permissões dadas à parte",
  permissoesRetiradas: "Permissões retiradas à parte",
};

/** Valores que são códigos do modelo e não texto para ler. */
const VALORES: Record<string, string> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  PENDING: "À espera",
  CANCELLED: "Cancelado",
  INJURED: "Lesionado",
  LEFT: "Esquerdo",
  RIGHT: "Direito",
  BOTH: "Ambidestro",
  MALE: "Masculino",
  FEMALE: "Feminino",
  OTHER: "Outro",
  CC: "Cartão de Cidadão",
  PASSPORT: "Passaporte",
  RESIDENCE: "Autorização de residência",
  sim: "Sim",
  "não": "Não",
};

/** As unidades que a ficha mostra e o registo não guarda. */
const UNIDADE: Record<string, string> = { heightCm: " cm", weightKg: " kg" };

export const nomeDoCampo = (field: string) => CAMPOS[field] ?? field;

export function valorDoCampo(field: string, valor: string | null): string {
  if (valor === null || valor === "") return "vazio";
  if (VALORES[valor]) return VALORES[valor];
  // Uma data em ISO (2015-03-04, ou com hora) lê-se como na ficha.
  const data = /^\d{4}-\d{2}-\d{2}/.test(valor) ? new Date(valor) : null;
  if (data && !Number.isNaN(data.getTime())) {
    return valor.length <= 10
      ? data.toLocaleDateString("pt-PT")
      : `${data.toLocaleDateString("pt-PT")} ${data.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
  }
  // 45.5 escreve-se 45,5: o servidor guarda o número como o Postgres o dá, e
  // uma vírgula é o que uma ficha em português mostra.
  const numero = /^-?\d+\.\d+$/.test(valor) ? valor.replace(".", ",") : valor;
  return numero + (UNIDADE[field] ?? "");
}

/** "hoje", "ontem", ou a data — e sempre a hora, que é o que se compara. */
export function quandoFoi(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(hoje) - dia(d)) / 86_400_000);
  const hora = d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  if (dias === 0) return `hoje, ${hora}`;
  if (dias === 1) return `ontem, ${hora}`;
  return `${d.toLocaleDateString("pt-PT")}, ${hora}`;
}
