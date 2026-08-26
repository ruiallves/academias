import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "@/lib/content";
import { PAYMENT_METHODS, PaymentIcon } from "./PaymentIcons";
import { Mark } from "./primitives";

const COLUMNS: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: "Produto",
    links: [
      { to: "/software", label: "Software" },
      { to: "/planos", label: "Planos" },
      { to: "/software#roteiro", label: "Roteiro" },
      { to: "/#seguranca", label: "Segurança" },
    ],
  },
  {
    title: "Clube",
    links: [
      { to: "/contactos", label: "Contacto" },
      { to: "/planos#perguntas", label: "Perguntas" },
    ],
  },
  {
    title: "Legal",
    links: [
      { to: "/termos", label: "Termos e Condições" },
      { to: "/privacidade", label: "Política de Privacidade" },
      { to: "/cookies", label: "Política de Cookies" },
      { to: "/dpa", label: "Tratamento de dados (DPA)" },
    ],
  },
];

/**
 * O rodapé.
 *
 * Abre com a assinatura da casa em serifa — grande, como quem fecha uma carta —
 * e só depois arruma as colunas. O aviso dos dados fica na última linha, sem
 * faixa a piscar: um clube que nos vai confiar fichas de menores lê isto com
 * atenção.
 */
export function Footer() {
  return (
    <footer className="dark border-t border-line">
      <div className="wrap band-tight">
        <div className="flex flex-col gap-8 border-b border-line pb-12 lg:flex-row lg:items-end lg:justify-between">
          <p className="display d2 max-w-[16ch]">A infraestrutura digital do teu clube.</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-arrow shrink-0">
            {CONTACT_EMAIL}
            <span aria-hidden className="arr">→</span>
          </a>
        </div>

        <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <span className="inline-flex items-center gap-2.5">
              <Mark size={20} className="text-mint" />
              <span
                className="text-[18px] leading-none font-[560] tracking-[-0.02em]"
                style={{ fontFamily: "var(--font-display)", fontVariationSettings: '"SOFT" 0, "WONK" 0' }}
              >
                academias
              </span>
            </span>
            <p className="mt-4 max-w-[30ch] text-[14.5px] leading-relaxed text-ink-3">
              Feito em Portugal, para clubes e academias desportivas portuguesas.
            </p>

            {/* Os meios de pagamento, discretos — o rodapé confirma, não vende. */}
            <ul className="mt-7 flex flex-wrap gap-3" aria-label="Meios de pagamento aceites">
              {PAYMENT_METHODS.map((m) => (
                <li key={m.id} title={m.label}>
                  <PaymentIcon id={m.id} className="size-[18px] text-ink-4" />
                </li>
              ))}
            </ul>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="field-label">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} className="text-[14.5px] text-ink-2 transition-colors hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <p className="text-[12.5px] text-ink-4">© {new Date().getFullYear()} Academias · Portugal</p>
          <p className="text-[12.5px] text-ink-4">Dados alojados na União Europeia</p>
        </div>
      </div>
    </footer>
  );
}
