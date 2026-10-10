import Link from "next/link";
import { UserRound } from "lucide-react";
import type { Clube } from "@/dados/tipos";
import { Emblema } from "./Emblema";
import { Redes } from "./Redes";
import { MenuMovel } from "./MenuMovel";
import { ATALHOS, NAV } from "./nav";
import { TrocarLayout } from "./TrocarLayout";

/**
 * Dois andares, como nos sites de referência: uma faixa escura com o que se
 * faz (bilhetes, loja, sócio, redes) e a barra branca com quem somos e por
 * onde se anda. Em telemóvel o segundo andar fecha num menu.
 */
export function Cabecalho({ clube }: { clube: Clube }) {
  return (
    <header className="sticky top-0 z-40">
      <div className="bg-night text-night-ink-2">
        <div className="container-site flex h-10 items-center justify-between text-[0.8125rem]">
          <p className="hidden sm:block">Site oficial · {clube.city ? `${clube.city}` : clube.shortName}</p>
          <div className="flex items-center gap-1 sm:ml-auto">
            <TrocarLayout atual="classico" />
            {/* Abaixo de `sm` só os ícones: com o interruptor de layout, os
                três rótulos não cabiam em 375px. O nome fica no aria-label. */}
            {ATALHOS.map(({ href, label, Icone }) => (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className="inline-flex h-10 items-center gap-1.5 px-2.5 font-medium text-night-ink transition hover:text-white"
              >
                <Icone size={15} aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
            <a
              href={clube.membershipUrl}
              aria-label="Sócios"
              className="inline-flex h-10 items-center gap-1.5 px-2.5 font-medium text-night-ink transition hover:text-white"
            >
              <UserRound size={15} aria-hidden />
              <span className="hidden sm:inline">Sócios</span>
            </a>
            <Redes social={clube.social} shortName={clube.shortName} className="ml-1 hidden sm:flex [&_a]:size-9" />
          </div>
        </div>
      </div>

      <div className="border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="container-site flex h-[4.25rem] items-center gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={`${clube.shortName}: início`}>
            <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={44} />
            <span className="min-w-0">
              <span className="display block truncate text-[1.125rem] text-ink">{clube.shortName}</span>
              {clube.city && <span className="block truncate text-xs text-ink-3">{clube.name}</span>}
            </span>
          </Link>

          <nav aria-label="Principal" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-1">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className="relative inline-flex h-11 items-center px-3 font-semibold text-ink-2 transition hover:text-ink after:absolute after:inset-x-3 after:bottom-1.5 after:h-0.5 after:scale-x-0 after:bg-signal after:transition-transform after:duration-200 hover:after:scale-x-100"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <a
            href={clube.membershipUrl}
            className="ml-auto hidden h-11 items-center rounded-control bg-signal-strong px-5 font-semibold text-signal-on transition hover:brightness-110 lg:ml-2 lg:inline-flex"
          >
            Ser sócio
          </a>

          <MenuMovel clube={clube} />
        </div>
      </div>
    </header>
  );
}
