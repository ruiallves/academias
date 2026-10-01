/**
 * As secções das Definições, e qual delas um endereço abre.
 *
 * ## Porque é que as Definições têm secções
 *
 * Eram uma página só: doze painéis em duas colunas, sem navegação nenhuma. Quem
 * queria mudar um cargo passava pela identidade, pelas modalidades e pelos tipos
 * de consulta para lá chegar, e a coluna da direita misturava a época com o
 * contrato e com os documentos legais. "Está bastante confuso" foi a descrição
 * de quem a usa, e estava certa.
 *
 * Agora há um submenu à esquerda e uma secção de cada vez à direita, como em
 * qualquer ecrã de definições que as pessoas já conhecem.
 *
 * ## Porque é que isto vive fora do ecrã
 *
 * Porque há uma dúzia de sítios no produto que mandam para aqui com um endereço
 * antigo — "gerir locais" num evento (`?catalogo=venues`), "gerir cargos" num
 * convite (`?painel=cargos`). Esses links não podem passar a abrir a secção
 * errada, e é o tipo de coisa que se parte em silêncio: o link continua a
 * funcionar, só que cai no Geral. A regra fica aqui, pura, e tem teste.
 */

export type SecaoKey =
  | "geral"
  | "epoca"
  | "modalidades"
  | "cargos"
  | "clinico"
  | "socios"
  | "mensalidades"
  | "plano"
  | "legal"
  | "perigo";

export type Secao = {
  key: SecaoKey;
  label: string;
  /** A frase por baixo do título da secção: o que se decide aqui. */
  descricao: string;
  /** O grupo no submenu. As secções aparecem pela ordem desta lista. */
  grupo: "Clube" | "Pessoas" | "Conta" | "";
};

/**
 * A ordem é a do trabalho: primeiro o que o clube é e pratica, depois quem lá
 * está, depois a relação com a plataforma. Apagar o clube fica sozinho no fim,
 * sem grupo — é a única acção sem volta e não se arruma ao lado das outras.
 */
export const SECOES: Secao[] = [
  { key: "geral", grupo: "Clube", label: "Geral", descricao: "O nome, o emblema e a cor do clube, e como aparece no telemóvel das famílias." },
  { key: "epoca", grupo: "Clube", label: "Época", descricao: "Em que época o clube está, e a passagem para a seguinte." },
  { key: "modalidades", grupo: "Clube", label: "Modalidades", descricao: "O que o clube pratica, e os escalões, competições, locais e balneários de cada modalidade." },
  { key: "cargos", grupo: "Pessoas", label: "Cargos", descricao: "Os departamentos do clube, os cargos de cada um e o que cada cargo pode ver e fazer." },
  { key: "socios", grupo: "Pessoas", label: "Sócios", descricao: "O cartão de sócio na app do clube." },
  { key: "clinico", grupo: "Pessoas", label: "Clínico", descricao: "Os tipos de consulta que o departamento clínico marca." },
  { key: "mensalidades", grupo: "Conta", label: "Pagamentos", descricao: "Como as famílias e os sócios pagam: pagamentos pela app, comissões, período de cobrança e lembretes." },
  { key: "plano", grupo: "Conta", label: "Plano", descricao: "O que o clube contratou à plataforma e o espaço de ficheiros que usa." },
  { key: "legal", grupo: "Conta", label: "Legal", descricao: "Os termos e políticas em vigor, e o que já foi aceite." },
  { key: "perigo", grupo: "", label: "Zona de perigo", descricao: "Apagar o clube e tudo o que lhe pertence. Não tem volta." },
];

const CHAVES = new Set<string>(SECOES.map((s) => s.key));

/**
 * A secção que um endereço abre.
 *
 * Por ordem: a secção pedida (`?secao=`), depois os dois formatos antigos que o
 * resto do produto ainda usa, e por fim o Geral.
 *
 * - `?painel=cargos` vem dos convites ("gerir cargos");
 * - `?catalogo=consultationTypes` vem do boletim clínico — os tipos de consulta
 *   são do clube e moram no Clínico;
 * - qualquer outro `?catalogo=` (locais, balneários, competições, tipos de
 *   evento) é um catálogo de uma modalidade.
 *
 * `disponiveis` são as secções que esta pessoa pode ver. Um endereço para uma
 * secção que não lhe pertence — a zona de perigo, para quem não pode apagar o
 * clube — abre o Geral em vez de um ecrã vazio.
 */
export function secaoDoEndereco(
  p: { secao?: string | null; painel?: string | null; catalogo?: string | null },
  disponiveis: readonly SecaoKey[],
): SecaoKey {
  const pedida = ((): SecaoKey | null => {
    if (p.secao && CHAVES.has(p.secao)) return p.secao as SecaoKey;
    if (p.painel === "cargos") return "cargos";
    if (p.catalogo === "consultationTypes") return "clinico";
    if (p.catalogo) return "modalidades";
    return null;
  })();

  if (pedida && disponiveis.includes(pedida)) return pedida;
  return disponiveis.includes("geral") ? "geral" : (disponiveis[0] ?? "geral");
}
