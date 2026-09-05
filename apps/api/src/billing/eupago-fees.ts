import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * O que a euPago cobra por cada pagamento.
 *
 * ## Não vem da API deles, e a razão está documentada
 *
 * Fui procurar. O índice de documentação da euPago
 * (`https://eupago.readme.io/llms.txt`) lista 53 páginas e **nenhuma** é de
 * preços, comissões, tarifário ou saldo. O mais perto que existe:
 *
 *  - `management/v1.02/transactions` — devolve `trid`, `entity`, `reference`,
 *    `amount`, `identifier`, `datePayment`, `dateTransfer`, `status`, `local` e
 *    um `serviceCost` **não documentado e nulo nos exemplos**. Só o valor
 *    bruto; comissão nenhuma.
 *  - `payouts` e `payouts/transactions` — o que foi liquidado entre duas datas.
 *    É a única fonte de comissão **real** que existe: a diferença entre o bruto
 *    e o que caiu na conta. Mas o esquema da resposta não está documentado
 *    (`"properties": {}`) e exige credenciais OAuth de gestão que este servidor
 *    ainda não tem configuradas.
 *
 * Ou seja: **não há endpoint de taxas para consumir**. Os valores abaixo são os
 * públicos de `https://www.eupago.com/pricing`, lidos a 5 de Setembro de 2026.
 *
 * ## Porque é que isto é configuração e não constantes
 *
 * Porque o preço de um contrato euPago negoceia-se. O que está publicado é a
 * tabela de balcão; um clube com volume paga menos, e um dia a euPago mexe nos
 * números sem nos avisar. Um valor errado aqui não parte nada — mostra ao clube
 * uma conta que não bate certo com o extracto, que é a maneira mais rápida de
 * perder a confiança dele. Por isso passa por `EUPAGO_FEES` e corrige-se sem
 * deploy.
 *
 * ## Quando isto puder ser real
 *
 * O caminho está aberto: com as credenciais de gestão (`EUPAGO_CLIENT_ID` /
 * `EUPAGO_CLIENT_SECRET`, que o `listPaidTransactions` já usa), o
 * `payouts/transactions` dá a comissão **efectiva** por transacção. Aí isto
 * deixa de ser uma tabela e passa a ser uma média observada, com estes valores
 * como ponto de partida enquanto não houver pagamentos que cheguem.
 */

/** Um método de pagamento e o que custa. */
export type MetodoComTaxa = {
  /** `MBWAY`, `MULTIBANCO`, … — o mesmo enum de `PaymentMethod`. */
  method: string;
  label: string;
  /** Parte fixa, em cêntimos. */
  fixedCents: number;
  /** Percentagem sobre o valor. `0.7` = 0,7 %. */
  percent: number;
  /**
   * A app da família oferece mesmo este método?
   *
   * A tabela tem tudo o que a euPago cobra; o **intervalo** que o clube vê só
   * pode contar com o que a família consegue escolher. Sem esta distinção, ou
   * se escondiam métodos que estão a ser usados, ou se assustava o clube com
   * comissões de métodos que ninguém lhe oferece.
   */
  offered: boolean;
};

/**
 * A tabela pública, a 5 de Setembro de 2026.
 *
 * Só os métodos que a app da família oferece. O cartão está cá porque o
 * `startPayment` já o sabe criar e é o próximo a ser ligado; o débito directo
 * também, e é o mais barato de todos por não ter percentagem nenhuma — vale a
 * pena o clube ver isso quando decide o que oferecer.
 */
const PUBLICAS: MetodoComTaxa[] = [
  { method: "MBWAY", label: "MB Way", fixedCents: 7, percent: 0.7, offered: true },
  { method: "MULTIBANCO", label: "Multibanco", fixedCents: 20, percent: 1.5, offered: true },
  /*
   * Apple Pay e Google Pay correm sobre os trilhos do cartão e a euPago cobra-os
   * ao mesmo preço — os três aparecem à mesma na lista, porque na app são três
   * botões diferentes e o clube quer saber o que cada botão lhe custa.
   *
   * Os +1 % de cartões de fora do EEE e de empresa não entram na conta: não se
   * sabe de antemão com que cartão a família vai pagar, e assumir o pior em
   * todos os pagamentos dava um número que quase nunca seria o certo.
   */
  { method: "CARD", label: "Cartão", fixedCents: 20, percent: 1.5, offered: true },
  { method: "APPLE_PAY", label: "Apple Pay", fixedCents: 20, percent: 1.5, offered: true },
  { method: "GOOGLE_PAY", label: "Google Pay", fixedCents: 20, percent: 1.5, offered: true },
  /* Sem percentagem — é o mais barato de todos, e num valor alto é disparatada
     a diferença. Vale a pena o clube ver isso quando decide o que promover. */
  { method: "DIRECT_DEBIT", label: "Débito directo", fixedCents: 45, percent: 0, offered: true },
  /*
   * PaySafeCard: na tabela, fora da oferta.
   *
   * 12 %, sem parte fixa — de longe o mais caro, e era ele que alargava o
   * intervalo que o clube vê. Saiu da app da família (ver `METODOS` em
   * `screens/Payments.tsx`) e por isso sai do cálculo: contar com uma comissão
   * que ninguém pode escolher era assustar o clube com dinheiro que nunca vai
   * perder.
   *
   * Fica na tabela, e não apagado, porque é "por enquanto": a taxa continua a
   * ser esta no dia em que voltar, e voltar é pôr `offered: true` aqui e a
   * linha de volta na app.
   */
  { method: "PAYSAFECARD", label: "PaySafeCard", fixedCents: 0, percent: 12, offered: false },
];

/**
 * O IVA sobre a comissão.
 *
 * A euPago diz "acresce IVA à taxa legal em vigor". Entra na conta porque a
 * esmagadora maioria dos clubes é uma associação sem actividade sujeita a IVA e
 * **não o deduz** — para eles é custo, e mostrar a comissão sem IVA seria
 * mostrar-lhes um número que nunca vão ver no extracto.
 */
const IVA_POR_OMISSAO = 23;

@Injectable()
export class EupagoFeesService {
  private readonly log = new Logger(EupagoFeesService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * A tabela em vigor.
   *
   * `EUPAGO_FEES` sobrepõe-se, em JSON:
   * `[{"method":"MBWAY","label":"MB Way","fixedCents":5,"percent":0.5}]`
   * Só os métodos indicados são substituídos; os outros ficam com o público.
   */
  tabela(): { methods: MetodoComTaxa[]; vatPercent: number; source: string } {
    const methods = PUBLICAS.map((m) => ({ ...m }));

    const bruto = this.config.get<string>("EUPAGO_FEES")?.trim();
    if (bruto) {
      try {
        for (const m of JSON.parse(bruto) as MetodoComTaxa[]) {
          const i = methods.findIndex((x) => x.method === m.method);
          const linha = {
            method: String(m.method),
            label: String(m.label ?? methods[i]?.label ?? m.method),
            fixedCents: Math.max(0, Math.round(Number(m.fixedCents ?? 0))),
            percent: Math.max(0, Number(m.percent ?? 0)),
            offered: m.offered ?? methods[i]?.offered ?? true,
          };
          if (i >= 0) methods[i] = linha;
          else methods.push(linha);
        }
      } catch {
        /*
         * Um JSON mal escrito não pode derrubar os ecrãs de preços — cai-se na
         * tabela pública, que é sempre melhor do que não mostrar nada. Fica no
         * log porque é configuração errada e alguém tem de a corrigir.
         */
        this.log.error("EUPAGO_FEES não é JSON válido — a usar a tabela pública");
      }
    }

    /*
     * Que métodos a app oferece.
     *
     * `EUPAGO_METHODS=MBWAY,MULTIBANCO,DIRECT_DEBIT` restringe a lista sem
     * deploy — é o interruptor para o dia em que um clube decidir que não quer
     * oferecer PaySafeCard a 12 %. Tirar daqui não tira da app: são duas
     * decisões, e esta só muda o que o clube **vê** ao fixar preços.
     */
    const oferecidos = (this.config.get<string>("EUPAGO_METHODS") ?? "")
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (oferecidos.length > 0) {
      for (const m of methods) m.offered = oferecidos.includes(m.method);
    }

    const iva = Number(this.config.get<string>("EUPAGO_FEE_VAT") ?? IVA_POR_OMISSAO);

    return {
      methods,
      vatPercent: Number.isFinite(iva) && iva >= 0 ? iva : IVA_POR_OMISSAO,
      /* De onde vieram os números — para o ecrã o poder dizer a quem pergunta. */
      source: bruto ? "contrato" : "tabela pública euPago",
    };
  }
}

/**
 * O que o clube recebe de um pagamento de `amountCents` por um método.
 *
 * Vive fora da classe e sem dependências para poder ser a **mesma** função dos
 * dois lados: o servidor usa-a para o que devolve, a consola importa a cópia em
 * `lib/eupago-fees.ts`. Duas fórmulas para a mesma conta divergiriam, e a que
 * divergisse seria a que o clube vê.
 */
export function liquidoDe(
  amountCents: number,
  taxa: MetodoComTaxa,
  vatPercent: number,
): { feeCents: number; netCents: number } {
  const comissao = taxa.fixedCents + (amountCents * taxa.percent) / 100;
  const comIva = comissao * (1 + vatPercent / 100);
  /*
   * Arredonda-se ao cêntimo, para cima.
   *
   * A euPago cobra o que cobra e nós não sabemos como arredonda. Arredondar a
   * comissão para cima faz o número que mostramos ao clube ser o pior caso — e
   * um clube que recebe um cêntimo a mais do que esperava não se queixa, ao
   * contrário do inverso.
   */
  const feeCents = Math.ceil(comIva);
  return { feeCents, netCents: Math.max(0, amountCents - feeCents) };
}
