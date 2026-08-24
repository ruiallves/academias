/**
 * Os meios de pagamento — em pictograma, não em logótipo.
 *
 * ## Porque é que não são os logótipos oficiais
 *
 * MB WAY, Multibanco, Apple Pay e Google Pay têm marcas registadas com regras de
 * utilização próprias — cores exactas, distâncias mínimas, ficheiros aprovados.
 * Sem o kit de marca de cada um (a euPago fornece-o aos clientes, ver o comentário
 * em `sections/product.tsx`), desenhar a versão "parecida" é o tipo de coisa que
 * gera uma carta de um departamento jurídico.
 *
 * O que se pode fazer sem pedir licença a ninguém é **dizer o nome** — nomear um
 * meio de pagamento que se aceita é uso descritivo, o mesmo que qualquer loja faz
 * ao escrever "aceitamos Visa e Mastercard" à porta — e desenhar um **pictograma
 * genérico** que ilustra o mecanismo (o telemóvel, o terminal, o cartão, o toque
 * sem contacto) em vez de imitar a marca.
 *
 * Cada ícone é um SVG de 1.4px de traço, na mesma linguagem do resto do site (ver
 * a seta do `<select>` em `routes/Contactos.tsx`). Quando os ficheiros oficiais
 * chegarem, trocam-se aqui e em mais lado nenhum.
 */

export type PaymentMethod = { id: string; label: string };

export const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "mbway", label: "MB WAY" },
  { id: "multibanco", label: "Multibanco" },
  { id: "cartao", label: "Cartão" },
  { id: "applepay", label: "Apple Pay" },
  { id: "googlepay", label: "Google Pay" },
];

export function PaymentIcon({ id, className }: { id: string; className?: string }) {
  const props = { viewBox: "0 0 24 24", fill: "none" as const, "aria-hidden": true, className };
  const stroke = { stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (id) {
    // Um telemóvel a pagar: o ecrã, e as ondas de quem inicia o pagamento a partir dele.
    case "mbway":
      return (
        <svg {...props}>
          <rect x="7" y="2.5" width="9" height="19" rx="2" {...stroke} />
          <line x1="10" y1="18" x2="13" y2="18" {...stroke} />
          <path d="M17.5 8.5a5 5 0 0 1 0 7" {...stroke} />
          <path d="M20 6.5a8 8 0 0 1 0 11" {...stroke} opacity="0.55" />
        </svg>
      );
    // Um terminal: ecrã, e as linhas de um recibo a sair por baixo.
    case "multibanco":
      return (
        <svg {...props}>
          <rect x="4" y="2.5" width="16" height="19" rx="2" {...stroke} />
          <rect x="6.5" y="5" width="11" height="7" rx="1" {...stroke} />
          <line x1="6.5" y1="15.5" x2="12" y2="15.5" {...stroke} />
          <line x1="6.5" y1="18" x2="10" y2="18" {...stroke} />
        </svg>
      );
    // O cartão: a tarja e o chip.
    case "cartao":
      return (
        <svg {...props}>
          <rect x="2" y="5" width="20" height="14" rx="2.2" {...stroke} />
          <line x1="2" y1="9.5" x2="22" y2="9.5" {...stroke} />
          <rect x="5" y="13" width="4.5" height="3" rx="0.6" {...stroke} />
        </svg>
      );
    // Um dispositivo com o toque sem contacto — o mecanismo de Apple Pay, não a marca.
    case "applepay":
      return (
        <svg {...props}>
          <rect x="4.5" y="3" width="15" height="18" rx="3" {...stroke} />
          <path d="M9 10.5a4.2 4.2 0 0 1 6 0" {...stroke} />
          <path d="M11 13a1.6 1.6 0 0 1 2 0" {...stroke} />
        </svg>
      );
    // O mesmo mecanismo, noutro enquadramento — para não repetir o pictograma anterior.
    case "googlepay":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.2" {...stroke} />
          <path d="M8 12a4 4 0 0 1 4-4" {...stroke} />
          <path d="M8 12a4 4 0 0 0 6.5 3.1" {...stroke} opacity="0.55" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}
