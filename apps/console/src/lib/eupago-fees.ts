import { useSyncExternalStore } from "react";
import { apiGet } from "@/lib/http";

/**
 * O que a euPago leva de cada pagamento — para o clube ver antes de fixar o preço.
 *
 * ## De onde vêm os números
 *
 * De `GET /billing/fees`, e **não** daqui. A euPago não tem endpoint de
 * taxas nenhum (procurei: o índice de documentação deles não lista preços,
 * comissões nem tarifário), por isso a tabela vive na configuração do servidor
 * — semeada com os preços públicos e corrigível sem deploy quando o contrato de
 * um clube for outro. Ver `eupago-fees.ts` do lado da API, que explica o que
 * existe e o que não existe na API deles.
 *
 * Hardcodar aqui era garantir que um dia a consola diz um número e o extracto
 * do clube diz outro.
 */

export type MetodoComTaxa = {
  method: string;
  label: string;
  fixedCents: number;
  percent: number;
  /** A app da família oferece este método? Só estes entram no intervalo. */
  offered: boolean;
};

type Tabela = { methods: MetodoComTaxa[]; vatPercent: number; source: string };

type State = { tabela: Tabela | null; loaded: boolean };

let state: State = { tabela: null, loaded: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

/**
 * Carrega uma vez por sessão.
 *
 * A tabela muda quando alguém mexe na configuração do servidor, o que acontece
 * uma vez por ano. Recarregá-la a cada abertura de diálogo seria uma ida à rede
 * por cada vez que se abre um formulário de preços.
 */
/**
 * O caminho, exportado de propósito.
 *
 * Escrito à mão estava `/api/billing/fees` — e o controlador de billing é
 * `@Controller("billing")`, sem o prefixo `api` que o de finance tem. Resultado:
 * 404 a cada arranque, apanhado pelo `catch` de baixo, e a linha de custo
 * simplesmente não aparecia em ecrã nenhum. Em silêncio.
 *
 * Fica numa constante para o teste poder verificar que o caminho que a consola
 * pede é o caminho que o servidor serve — que era exactamente o que faltava.
 */
export const CAMINHO = "/billing/fees";

let aCarregar: Promise<void> | null = null;

export function loadEupagoFees(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  if (aCarregar) return aCarregar;

  aCarregar = apiGet<Tabela>(CAMINHO)
    .then((tabela) => {
      state = { tabela, loaded: true };
    })
    .catch((e: unknown) => {
      /*
       * Falha calada foi o que atrasou isto: um 404 no caminho errado dava
       * exactamente o mesmo ecrã que "ainda não carregou" — nada. O ecrã
       * continua a não inventar números, mas a consola do browser passa a
       * dizer porquê a quem for procurar.
       */
      console.error("Taxas euPago: não foi possível carregar", e);
      /*
       * Sem tabela não se inventa nenhuma.
       *
       * Um erro de rede aqui faz a linha de custo **desaparecer**, e é o
       * comportamento certo: mostrar uma estimativa a partir de números
       * guardados no browser seria dizer ao clube quanto vai receber com dados
       * que podem já não ser os do contrato dele.
       */
      state = { tabela: null, loaded: true };
    })
    .finally(() => {
      aCarregar = null;
      emit();
    });

  return aCarregar;
}

export function useEupagoFees(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * O que o clube recebe de um pagamento, por método.
 *
 * Gémea de `liquidoDe` na API — a mesma fórmula e o mesmo arredondamento. Está
 * escrita duas vezes porque a conta tem de correr a cada tecla do input, e uma
 * ida ao servidor por tecla era absurda; o que **não** está duplicado são os
 * números, que vêm todos de lá.
 */
export function liquidoDe(
  amountCents: number,
  taxa: MetodoComTaxa,
  vatPercent: number,
): { feeCents: number; netCents: number } {
  const comissao = taxa.fixedCents + (amountCents * taxa.percent) / 100;
  /* Para cima, como na API: o número que se mostra é o pior caso. */
  const feeCents = Math.ceil(comissao * (1 + vatPercent / 100));
  return { feeCents, netCents: Math.max(0, amountCents - feeCents) };
}

/**
 * O que o clube recebe, por método e no total.
 *
 * ## Porque é um intervalo e não um número
 *
 * Porque quem escolhe o método é **quem paga**, no momento de pagar. Uma
 * mensalidade de 40 € deixa 39,56 € se for por MB Way e 35,20 € se for por
 * PaySafeCard. Mostrar só um dos dois era escolher um número bonito e deixar o
 * clube descobrir o outro no extracto.
 *
 * ## Só os métodos que a app oferece
 *
 * A tabela do servidor traz tudo o que a euPago cobra; o intervalo conta apenas
 * com o que a família consegue mesmo escolher (). Contar com um método
 * que ninguém oferece era assustar o clube com uma comissão que nunca vai pagar.
 *
 * A lista sai ordenada pelo que sobra ao clube — do melhor para o pior. É a
 * pergunta que se faz a olhar para ela.
 */
export function detalhePorMetodo(
  amountCents: number,
  tabela: Tabela,
): { minCents: number; maxCents: number; porMetodo: { label: string; feeCents: number; netCents: number }[] } | null {
  const linhas = tabela.methods.filter((m) => m.offered);
  if (linhas.length === 0 || amountCents <= 0) return null;

  const porMetodo = linhas
    .map((m) => ({ label: m.label, ...liquidoDe(amountCents, m, tabela.vatPercent) }))
    .sort((a, b) => b.netCents - a.netCents);

  return {
    minCents: porMetodo[porMetodo.length - 1].netCents,
    maxCents: porMetodo[0].netCents,
    porMetodo,
  };
}
