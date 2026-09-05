/**
 * Os meios de pagamento que o produto aceita.
 *
 * ## Passaram a ser os logótipos verdadeiros
 *
 * Este ficheiro tinha pictogramas genéricos em todos os meios, e uma nota
 * comprida a explicar porquê: sem os ficheiros oficiais, desenhar a versão
 * "parecida" de uma marca registada é o tipo de coisa que gera uma carta de um
 * departamento jurídico. A razão continua a valer — o que mudou foi termos os
 * ficheiros. Estão em `public/`, e as versões normalizadas em
 * `public/pagamentos/` (ver `scripts/normalizar-logos.mjs`).
 *
 * Onde não há logótipo, continua a haver pictograma e o **nome escrito**:
 * nomear um meio de pagamento que se aceita é uso descritivo, o mesmo que
 * qualquer loja faz ao escrever "aceitamos Visa e Mastercard" à porta.
 *
 * ## Os dois sem logótipo, e porquê
 *
 * **Cartão** não é uma marca — é a categoria. Os logótipos aqui seriam os das
 * redes (Visa, Mastercard), que são outras marcas e outros ficheiros.
 *
 * **Débito directo** não tem logótipo nenhum para ter: é um mecanismo bancário
 * (SEPA), não um produto de consumo com marca. E tem de estar na lista à mesma —
 * é o meio que resolve a mensalidade de vez, e o clube que o oferece quer
 * dizê-lo.
 *
 * ## Sobre fundo escuro, as marcas invertem-se
 *
 * As quatro são tinta escura e o rodapé é pinheiro: assentes directamente,
 * desapareciam. Houve uma tentativa de as pôr em pastilhas brancas — resolvia a
 * legibilidade e ficava mal, seis rectângulos brancos a saltar de um rodapé que
 * é sóbrio de propósito.
 *
 * O tratamento certo num campo escuro é o **reverso monocromático**: a marca em
 * branco sólido, que é a versão que as próprias normas de marca dão para este
 * caso. Faz-se com `brightness(0) invert(1)`, que reduz qualquer arte a uma
 * silhueta branca.
 *
 * O que se perde é a cor — o vermelho do MB WAY, as quatro cores do Google. Num
 * rodapé que **confirma** os meios em vez de os vender, é a troca certa: seis
 * marcas monocromáticas alinhadas lêem-se como uma linha; seis pastilhas
 * coloridas lêem-se como publicidade.
 *
 * ## Os dois sem logótipo herdam os tokens, e agora está certo
 *
 * Com a pastilha, o pictograma do Cartão e o do Débito directo usavam
 * `text-ink` — e dentro de `.dark` esse token vale **branco**. Branco sobre a
 * pastilha branca: os dois únicos meios sem logótipo ficaram sem ícone nenhum.
 * Era o mesmo engano das cores do clube na consola: um token que quer dizer
 * "tinta legível **na página**" não vale numa ilha clara dentro de uma secção
 * escura.
 *
 * Sem pastilha, deixa de haver ilha — o token volta a dizer a verdade, porque a
 * página por baixo é mesmo a que ele descreve.
 */

export type PaymentMethod = {
  id: string;
  label: string;
  /** O logótipo normalizado, quando a marca tem um. */
  logo?: string;
  /**
   * Ajuste fino de altura, sobre a altura base.
   *
   * Os ficheiros já vêm todos recortados ao conteúdo e à mesma altura, por isso
   * isto deixou de compensar vazio — compensa **forma**. O Multibanco é o único
   * vertical (a marca em cima, a palavra por baixo): à altura dos wordmarks
   * horizontais a palavra ficava ilegível, e por isso sobe um pouco.
   */
  scale?: number;
};

export const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "mbway", label: "MB WAY", logo: "/pagamentos/mbway.png" },
  { id: "multibanco", label: "Multibanco", logo: "/pagamentos/multibanco.png", scale: 1.35 },
  { id: "cartao", label: "Cartão" },
  { id: "applepay", label: "Apple Pay", logo: "/pagamentos/applepay.png" },
  { id: "googlepay", label: "Google Pay", logo: "/pagamentos/googlepay.png" },
  { id: "debito", label: "Débito directo" },
];

/** A altura a que uma marca é desenhada, antes do ajuste de forma. */
const ALTURA = 17;

/**
 * Uma marca, pronta a pôr numa linha.
 *
 * `onDark` não é um tema: é a diferença entre uma marca que se lê e uma que
 * desaparece. Sobre pinheiro, a marca inverte-se para branco; sobre papel,
 * assenta como está. Os dois meios sem logótipo não precisam de saber — os
 * tokens de tinta já mudam sozinhos com a secção.
 */
export function PaymentMark({ method, onDark = false }: { method: PaymentMethod; onDark?: boolean }) {
  const conteudo = method.logo ? (
    <img
      src={method.logo}
      alt={method.label}
      loading="lazy"
      decoding="async"
      className="w-auto shrink-0"
      style={{
        height: `${Math.round(ALTURA * (method.scale ?? 1))}px`,
        /* Reverso monocromático sobre pinheiro — ver a nota de topo. */
        ...(onDark ? { filter: "brightness(0) invert(1)", opacity: 0.92 } : {}),
      }}
    />
  ) : (
    <>
      {/*
        Os tokens, nos dois casos. Dentro de `.dark` resolvem para tinta clara,
        que é o que se quer sobre pinheiro — e fora dele para tinta escura sobre
        papel. Foi a pastilha branca que os pôs a mentir; sem ela dizem a verdade.
      */}
      <PaymentIcon id={method.id} className="size-[17px] text-ink-3" />
      <span className="text-[13.5px] font-semibold tracking-[-0.01em] whitespace-nowrap text-ink-2">
        {method.label}
      </span>
    </>
  );

  /*
   * A mesma marcação nos dois fundos.
   *
   * O que muda é a tinta — e isso já está resolvido pelos tokens e pelo filtro
   * de inversão. Duas marcações diferentes eram duas coisas para manter a par, e
   * foi de uma delas que veio o ícone invisível.
   */
  return (
    <span className="inline-flex items-center gap-2" title={method.label}>
      {conteudo}
    </span>
  );
}

/**
 * O pictograma dos meios sem logótipo.
 *
 * Um SVG de 1.4px de traço, na mesma linguagem do resto do site. Ilustra o
 * **mecanismo**, nunca uma marca.
 */
export function PaymentIcon({ id, className }: { id: string; className?: string }) {
  const props = { viewBox: "0 0 24 24", fill: "none" as const, "aria-hidden": true, className };
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (id) {
    // O cartão: a tarja e o chip.
    case "cartao":
      return (
        <svg {...props}>
          <rect x="2" y="5" width="20" height="14" rx="2.2" {...stroke} />
          <line x1="2" y1="9.5" x2="22" y2="9.5" {...stroke} />
          <rect x="5" y="13" width="4.5" height="3" rx="0.6" {...stroke} />
        </svg>
      );
    /*
     * O débito directo: o banco, e a seta que volta todos os meses.
     *
     * É o mecanismo e não uma marca — a mensalidade sai da conta sozinha, e a
     * autorização assina-se uma vez. A seta circular é o "todos os meses"; a
     * fachada é o banco de onde sai.
     */
    case "debito":
      return (
        <svg {...props}>
          <path d="M3.5 9.5 12 4.5l8.5 5" {...stroke} />
          <line x1="5.5" y1="10.5" x2="5.5" y2="15.5" {...stroke} />
          <line x1="12" y1="10.5" x2="12" y2="15.5" {...stroke} />
          <line x1="18.5" y1="10.5" x2="18.5" y2="15.5" {...stroke} />
          <path d="M4 18.5h12" {...stroke} />
          <path d="M19.5 17.2a2.6 2.6 0 1 1-1.2-2.2" {...stroke} />
          <path d="M20.2 13.6v1.9h-1.9" {...stroke} />
        </svg>
      );
    default:
      return null;
  }
}
