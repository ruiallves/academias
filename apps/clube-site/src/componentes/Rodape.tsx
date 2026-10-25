import Link from "next/link";
import { MapPin, Phone, Mail } from "lucide-react";
import type { Clube } from "@/dados/tipos";
import { Emblema } from "./Emblema";
import { Redes } from "./Redes";
import { ATALHOS, NAV } from "./nav";
import { BotaoSocio } from "@/componentes/socio/BotaoSocio";
import { Legais } from "./Legais";

export function Rodape({ clube }: { clube: Clube }) {
  const ano = new Date().getFullYear();
  return (
    <footer className="mt-20 bg-night text-night-ink-2">
      <div className="h-1 bg-signal" aria-hidden />
      <div className="container-site grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={48} />
            <div>
              <p className="display text-lg text-night-ink">{clube.shortName}</p>
              {clube.foundedYear && <p className="text-sm">Fundado em {clube.foundedYear}</p>}
            </div>
          </div>
          {clube.motto && <p className="display mt-6 text-3xl text-night-ink">{clube.motto}</p>}
          <address className="mt-6 space-y-2 text-sm not-italic">
            {/* Sem morada, sem o ícone: um alfinete sozinho parecia texto por carregar. */}
            {clube.address.lines.length > 0 && (
              <p className="flex gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {clube.address.lines.map((l, i) => (
                    <span key={i} className="block">
                      {l}
                    </span>
                  ))}
                </span>
              </p>
            )}
            {clube.phone && (
              <p className="flex gap-2">
                <Phone size={16} className="mt-0.5 shrink-0" aria-hidden />
                <a href={`tel:${clube.phone.replace(/\s/g, "")}`} className="hover:text-night-ink">
                  {clube.phone}
                </a>
              </p>
            )}
            {clube.email && (
              <p className="flex gap-2">
                <Mail size={16} className="mt-0.5 shrink-0" aria-hidden />
                <a href={`mailto:${clube.email}`} className="hover:text-night-ink">
                  {clube.email}
                </a>
              </p>
            )}
          </address>
        </div>

        <nav aria-label="Rodapé">
          <p className="eyebrow text-night-ink">O site</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[...NAV, ...ATALHOS].map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="hover:text-night-ink">
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <BotaoSocio className="hover:text-night-ink">
                Ser sócio
              </BotaoSocio>
            </li>
          </ul>
        </nav>

        <div>
          {Object.values(clube.social).some(Boolean) && (
            <>
              <p className="eyebrow text-night-ink">Segue o clube</p>
              <Redes social={clube.social} shortName={clube.shortName} className="-ml-3 mt-3 mb-8" />
            </>
          )}
          <p className="eyebrow text-night-ink">Modalidades</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {clube.modalidades.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-night-line">
        <Legais clube={clube} className="container-site flex flex-col gap-2 py-5 text-xs sm:flex-row sm:items-center sm:justify-between" ligacao="hover:text-night-ink hover:underline" />
      </div>

      <div className="border-t border-night-line">
        <div className="container-site flex flex-col gap-2 py-5 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {ano} {clube.name}. Todos os direitos reservados.
          </p>
          <p>
            Site e plataforma por{" "}
            <a href="https://www.academias.pt"className="font-semibold text-night-ink hover:underline">
              Academias
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
