import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "@/lib/content";
import { PAYMENT_METHODS, PaymentIcon } from "./PaymentIcons";
import { Wordmark } from "./primitives";

const COLUMNS: { title: string; links: { to: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Produto",
    links: [
      { to: "/software", label: "Software" },
      { to: "/planos", label: "Planos" },
      { to: "/#familias", label: "App das famílias" },
      { to: "/#pagamentos", label: "Pagamentos" },
      { to: "/#roteiro", label: "Roteiro" },
    ],
  },
  {
    title: "Clube",
    links: [
      { to: "/contactos", label: "Contacto" },
      { to: "/#seguranca", label: "Segurança" },
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

export function Footer() {
  return (
    <footer className="dark">
      <div className="wrap band-tight">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Wordmark className="text-white" />
            <p className="mt-4 max-w-[30ch] text-[14.5px] leading-relaxed text-ink-3">
              A infraestrutura digital de clubes e academias desportivas. Feito em Portugal, para clubes portugueses.
            </p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="link mt-4 inline-block text-[14.5px] text-white">
              {CONTACT_EMAIL}
            </a>

            {/* Os meios de pagamento, discretos — o rodapé é onde se confirma, não onde se vende. */}
            <ul className="mt-7 flex flex-wrap gap-2.5" aria-label="Meios de pagamento aceites">
              {PAYMENT_METHODS.map((m) => (
                <li key={m.id} title={m.label}>
                  <PaymentIcon id={m.id} className="size-[18px] text-ink-4" />
                </li>
              ))}
            </ul>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="eyebrow">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.to} className="text-[14.5px] text-ink-2 transition-colors hover:text-white">
                        {l.label}
                      </a>
                    ) : (
                      <Link to={l.to} className="text-[14.5px] text-ink-2 transition-colors hover:text-white">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="rule mt-12 flex flex-wrap items-center justify-between gap-4 pt-6">
          <p className="font-mono text-[11.5px] text-ink-4">
            © {new Date().getFullYear()} Academias · Portugal
          </p>
          {/*
            O aviso de dados fica no rodapé e não numa faixa a piscar: um clube que
            está a decidir confiar-nos fichas de menores lê isto com atenção, e uma
            faixa de cookies a saltar por cima não é o sítio para o dizer.
          */}
          <p className="font-mono text-[11.5px] text-ink-4">Dados alojados na União Europeia</p>
        </div>
      </div>
    </footer>
  );
}
