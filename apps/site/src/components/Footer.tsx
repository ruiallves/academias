import { Link } from "react-router-dom";
import { CONTACT_EMAIL, INSTAGRAM_URL } from "@/lib/content";
import { PAYMENT_METHODS, PaymentMark } from "./PaymentIcons";
import { InstagramIcon, Wordmark } from "./marca";

const COLUNAS: { titulo: string; links: { to: string; label: string }[] }[] = [
  {
    titulo: "Produto",
    links: [
      { to: "/produto", label: "O clube por dentro" },
      { to: "/planos", label: "Planos" },
      { to: "/produto#roteiro", label: "Roteiro" },
    ],
  },
  {
    titulo: "Clube",
    links: [
      { to: "/contactos", label: "Contacto" },
      { to: "/planos#perguntas", label: "Perguntas" },
    ],
  },
  {
    titulo: "Legal",
    links: [
      { to: "/legal/termos-de-servico", label: "Termos de Serviço" },
      { to: "/legal/termos-de-utilizacao", label: "Termos de Utilização" },
      { to: "/legal/privacidade", label: "Política de Privacidade" },
      { to: "/legal/cookies", label: "Política de Cookies" },
      { to: "/legal/dpa", label: "Acordo de Tratamento de Dados" },
      { to: "/legal/utilizacao-aceitavel", label: "Utilização Aceitável" },
    ],
  },
];

/**
 * O rodapé.
 *
 * Claro, depois do fecho escuro. A marca, o email, os meios de pagamento e as
 * colunas. O aviso dos dados fica na última linha.
 */
export function Footer() {
  return (
    <footer className="palco-cal">
      <div className="wrap faixa-curta">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-[30ch] text-[0.95rem] leading-relaxed text-texto-2">
              Feito em Portugal, para clubes e academias desportivas portuguesas.
            </p>
            <div className="mt-5 flex items-center gap-4">
              <a href={`mailto:${CONTACT_EMAIL}`} className="ligacao">
                {CONTACT_EMAIL}
              </a>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="A Academias no Instagram, @getacademias"
                className="flex size-9 items-center justify-center rounded-full bg-fio text-texto transition-colors hover:bg-acento"
              >
                <InstagramIcon size={18} />
              </a>
            </div>

            {/* As marcas que têm logótipo em cima; as duas que não têm, em texto, por baixo. */}
            <div className="mt-8 space-y-3.5">
              <ul className="flex flex-wrap items-center gap-x-6 gap-y-4" aria-label="Meios de pagamento aceites">
                {PAYMENT_METHODS.filter((m) => m.logo).map((m) => (
                  <li key={m.id}>
                    <PaymentMark method={m} />
                  </li>
                ))}
              </ul>
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {PAYMENT_METHODS.filter((m) => !m.logo).map((m) => (
                  <li key={m.id}>
                    <PaymentMark method={m} icon={false} />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {COLUNAS.map((col) => (
            <div key={col.titulo}>
              <p className="rotulo">{col.titulo}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} className="text-[0.98rem] font-medium text-texto-2 transition-colors hover:text-texto">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="fio-cima mt-14 flex flex-wrap items-center justify-between gap-4 pt-6 text-[0.86rem] text-texto-3">
          <p>© {new Date().getFullYear()} Academias · Portugal</p>
          <p>Dados alojados na União Europeia</p>
        </div>
      </div>
    </footer>
  );
}
