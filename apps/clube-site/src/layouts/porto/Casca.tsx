import Link from "next/link";
import { UserRound, ArrowRight } from "lucide-react";
import type { Clube } from "@/dados/tipos";
import { Emblema } from "@/componentes/Emblema";
import { Redes } from "@/componentes/Redes";
import { MenuMovel } from "@/componentes/MenuMovel";
import { TrocarLayout } from "@/componentes/TrocarLayout";
import { ATALHOS, NAV } from "@/componentes/nav";

const LARGURA_BARRA = "6.25rem";

/**
 * A casca do layout "porto": uma barra lateral fixa à esquerda com o
 * emblema e os ícones, uma faixa fina no topo, e o rodapé em faixas (redes,
 * patrocinadores, ligações). É a estrutura do fcporto.pt; as cores são as
 * claras da casa, com a cor do clube nos acentos. O escuro fica só onde há
 * texto por cima de fotografia.
 *
 * Em telemóvel a barra lateral não cabe: fica uma barra de topo com o
 * emblema e o menu.
 */
export function CascaPorto({ clube, children }: { clube: Clube; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col" style={{ ["--barra" as string]: LARGURA_BARRA }}>
      <BarraLateral clube={clube} />

      <div className="flex min-h-dvh flex-col lg:pl-[var(--barra)]">
        <header className="sticky top-0 z-40 border-b border-line bg-surface/95 text-ink-2 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:h-11">
            <Link href="/" className="flex items-center gap-2.5 lg:hidden" aria-label={`${clube.shortName}: início`}>
              <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={36} />
              <span className="display text-base text-ink">{clube.shortName}</span>
            </Link>
            <p className="hidden text-[0.8125rem] lg:block">Site oficial{clube.city ? ` · ${clube.city}` : ""}</p>
            <div className="ml-auto hidden items-center gap-1 text-[0.8125rem] lg:flex">
              <TrocarLayout atual="porto" sobre="claro" />
              {ATALHOS.map(({ href, label, Icone }) => (
                <Link key={href} href={href} className="inline-flex h-11 items-center gap-1.5 px-2.5 font-semibold text-ink transition hover:text-signal-ink">
                  <Icone size={15} aria-hidden />
                  {label}
                </Link>
              ))}
              <a href={clube.membershipUrl} className="inline-flex h-11 items-center gap-1.5 px-2.5 font-semibold text-ink transition hover:text-signal-ink">
                <UserRound size={15} aria-hidden />
                Sócios
              </a>
            </div>
            <div className="ml-auto flex items-center gap-2 lg:hidden">
              <TrocarLayout atual="porto" sobre="claro" />
              <MenuMovel clube={clube} topo="top-14" />
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <RodapePorto clube={clube} />
      </div>
    </div>
  );
}

function BarraLateral({ clube }: { clube: Clube }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-[var(--barra)] flex-col items-center border-r border-line bg-surface py-5 text-ink-3 lg:flex">
      <Link href="/" className="flex flex-col items-center gap-2 px-2 text-center" aria-label={`${clube.shortName}: início`}>
        <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={56} />
        <span className="display text-[0.8125rem] leading-tight text-ink">{clube.shortName}</span>
      </Link>
      <nav aria-label="Principal" className="mt-8 w-full">
        <ul className="flex flex-col items-stretch">
          {[...NAV, ...ATALHOS].map(({ href, label, Icone }) => (
            <li key={href}>
              <Link
                href={href}
                className="group relative flex h-14 flex-col items-center justify-center gap-1 text-[0.625rem] font-semibold uppercase tracking-wider transition hover:bg-signal-soft hover:text-signal-ink before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:scale-y-0 before:rounded-r before:bg-signal before:transition-transform hover:before:scale-y-100"
              >
                <Icone size={22} strokeWidth={1.5} aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <a
        href={clube.membershipUrl}
        className="mt-auto flex h-14 w-full flex-col items-center justify-center gap-1 bg-signal-strong text-[0.625rem] font-semibold uppercase tracking-wider text-signal-on transition hover:brightness-110"
      >
        <UserRound size={22} strokeWidth={1.5} aria-hidden />
        Ser sócio
      </a>
    </aside>
  );
}

function RodapePorto({ clube }: { clube: Clube }) {
  const ano = new Date().getFullYear();
  return (
    <footer className="mt-20 border-t border-line bg-surface text-ink-2">
      <div className="flex flex-col border-b border-line sm:flex-row">
        <div className="flex flex-1 items-center px-4 py-2 text-ink">
          <Redes
            social={clube.social}
            shortName={clube.shortName}
            className="w-full justify-around [&_a]:size-14 [&_a:hover]:bg-sunken [&_a:hover]:text-signal-ink [&_svg]:size-6"
          />
        </div>
        <a
          href={clube.membershipUrl}
          className="flex items-center justify-center gap-2 bg-signal-strong px-8 py-5 font-bold uppercase tracking-wider text-signal-on transition hover:brightness-110 sm:w-72"
        >
          App do clube
          <ArrowRight size={18} aria-hidden />
        </a>
      </div>

      {clube.sponsors.length > 0 && (
        <div className="border-b border-line bg-canvas">
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-10">
            {clube.sponsors.map((s) => (
              <li key={s.name} className="display text-lg text-ink-4 transition hover:text-ink">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer sponsored">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-6 py-8 text-center">
        <nav aria-label="Rodapé">
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-bold uppercase tracking-wider text-ink">
            {[...NAV, ...ATALHOS].map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="inline-flex h-11 items-center hover:text-signal-ink">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <address className="mt-4 text-xs not-italic text-ink-3">
          {clube.address.lines.join(" · ")}
          {clube.phone && ` · ${clube.phone}`}
          {clube.email && ` · ${clube.email}`}
        </address>
        <p className="mt-4 text-xs text-ink-3">
          © {ano} {clube.name}. Site e plataforma por{" "}
          <a href="https://academias.pt" className="font-semibold text-ink hover:underline">
            Academias
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
