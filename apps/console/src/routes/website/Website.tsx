import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { cx } from "@/components/primitives";
import {
  ExternalLink,
  Globe,
  Handshake,
  IdCard,
  Inbox,
  LayoutGrid,
  Link2,
  Newspaper,
  Palette,
  Recinto,
  ShoppingBag,
  Ticket,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "@/lib/icons";
import { useMobile } from "@/lib/viewport";
import { useStore } from "@/lib/store";
import { enderecoDoSite, useSite } from "@/lib/website";
import { VisaoGeral } from "./VisaoGeral";
import { Identidade, Aspeto, Dominio } from "./Configuracao";
import { Noticias } from "./Noticias";
import { Loja } from "./Loja";
import { Bilheteira } from "./Bilheteira";
import { Estadio } from "./Estadio";
import { Equipas, Patrocinadores, Mensagens } from "./Conteudo";

/**
 * Website — o site do clube, gerido daqui. **Só em DEV** (ver `GRUPO_WEBSITE`
 * em `lib/nav.ts` e a rota em `App.tsx`).
 *
 * O desenho é o das Definições: as secções à esquerda, uma de cada vez à
 * direita, e a secção no endereço (`?secao=noticias`) para o F5 e o voltar
 * atrás funcionarem. As secções são as de um site funcional e nada mais:
 * é também o menu que um clube só com o plano do site vai ter.
 */

type SecaoKey =
  | "geral"
  | "identidade"
  | "aspeto"
  | "dominio"
  | "noticias"
  | "equipas"
  | "patrocinadores"
  | "estadio"
  | "bilheteira"
  | "loja"
  | "mensagens";

type Secao = { key: SecaoKey; label: string; descricao: string; grupo: string; icone: LucideIcon };

const SECOES: Secao[] = [
  { key: "geral", label: "Visão geral", grupo: "Site", icone: LayoutGrid, descricao: "O estado do site, o que falta para ficar completo, e o atalho para o ver." },
  { key: "identidade", label: "Identidade", grupo: "Site", icone: IdCard, descricao: "Quem é o clube: o lema, o texto de apresentação, a história, a morada e as redes." },
  { key: "aspeto", label: "Aspeto", grupo: "Site", icone: Palette, descricao: "O layout do site. A cor e o emblema são os do clube, os mesmos da consola e da app." },
  { key: "dominio", label: "Domínio", grupo: "Site", icone: Link2, descricao: "O endereço .pt do clube, e onde o site vive enquanto o domínio não aponta para cá." },
  { key: "noticias", label: "Notícias", grupo: "Conteúdo", icone: Newspaper, descricao: "O que se escreve sobre o clube. As três em destaque abrem a página de início." },
  { key: "equipas", label: "Equipas", grupo: "Conteúdo", icone: Users, descricao: "Que equipas aparecem no site. O plantel só com o consentimento das famílias." },
  { key: "patrocinadores", label: "Patrocinadores", grupo: "Conteúdo", icone: Handshake, descricao: "Quem apoia o clube. Aparecem no fundo de todas as páginas." },
  { key: "estadio", label: "Estádio", grupo: "Vendas", icone: Recinto, descricao: "O recinto visto de cima, com as bancadas. Quem compra um bilhete vê no mapa onde vai ficar." },
  { key: "bilheteira", label: "Bilheteira", grupo: "Vendas", icone: Ticket, descricao: "Bilhetes para os jogos em casa: tipos, preços, bancada e lotação. O bilhete chega com um código QR." },
  { key: "loja", label: "Loja", grupo: "Vendas", icone: ShoppingBag, descricao: "Os produtos à venda no site, com tamanhos e preço." },
  { key: "mensagens", label: "Mensagens", grupo: "Contacto", icone: Inbox, descricao: "O que chega pelo formulário de contactos do site." },
];

function secaoDe(valor: string | null): SecaoKey {
  return SECOES.some((s) => s.key === valor) ? (valor as SecaoKey) : "geral";
}

export default function Website() {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const [params, setParams] = useSearchParams();
  const mobile = useMobile();

  const ativa = secaoDe(params.get("secao"));
  const secao = SECOES.find((s) => s.key === ativa)!;
  const ir = (key: SecaoKey) => setParams(key === "geral" ? {} : { secao: key });

  return (
    <>
      <PageHeader eyebrow={store.academy.name} title="Website">
        <a href={enderecoDoSite(store.academy.slug, site.dominio)} target="_blank" rel="noopener noreferrer" className="ctl-outline">
          <Globe className="size-4" strokeWidth={1.75} />
          Ver o site
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </a>
      </PageHeader>

      {/* Onde fica o que se grava. Ver o cabeçalho de `lib/website.ts`. */}
      <p className="mb-5 flex items-start gap-2 rounded-[10px] border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-meta leading-relaxed text-warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <span>
          <strong className="font-semibold">Só em desenvolvimento.</strong> O que gravas aqui fica neste browser, até a API
          do site existir. Noutro computador, ou noutro browser, não aparece.
        </span>
      </p>

      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[212px_minmax(0,1fr)]">
        <Submenu ativa={ativa} onIr={ir} horizontal={mobile} />

        <section className="min-w-0" aria-labelledby="secao-titulo">
          <header className="mb-5 border-b border-line pb-4">
            <h2 id="secao-titulo" className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {secao.label}
            </h2>
            <p className="mt-1 max-w-[68ch] text-body leading-relaxed text-ink-3">{secao.descricao}</p>
          </header>

          <div className="max-w-[980px]">
            {ativa === "geral" && <VisaoGeral onIr={(k) => ir(k as SecaoKey)} />}
            {ativa === "identidade" && <Identidade />}
            {ativa === "aspeto" && <Aspeto />}
            {ativa === "dominio" && <Dominio />}
            {ativa === "noticias" && <Noticias />}
            {ativa === "equipas" && <Equipas />}
            {ativa === "patrocinadores" && <Patrocinadores />}
            {ativa === "estadio" && <Estadio />}
            {ativa === "bilheteira" && <Bilheteira onIrParaEstadio={() => ir("estadio")} />}
            {ativa === "loja" && <Loja />}
            {ativa === "mensagens" && <Mensagens />}
          </div>
        </section>
      </div>
    </>
  );
}

/** O submenu, igual ao das Definições: coluna presa no computador, fila no telemóvel. */
function Submenu({ ativa, onIr, horizontal }: { ativa: SecaoKey; onIr: (k: SecaoKey) => void; horizontal: boolean }) {
  const ativoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (horizontal) ativoRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [horizontal, ativa]);

  if (horizontal) {
    return (
      <nav aria-label="Secções do website" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-1.5 pb-1">
          {SECOES.map((s) => {
            const on = s.key === ativa;
            const Icone = s.icone;
            return (
              <li key={s.key}>
                <button
                  ref={on ? ativoRef : undefined}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => onIr(s.key)}
                  className={cx(
                    "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-meta font-medium transition-colors",
                    on ? "border-signal/30 bg-signal-soft text-signal-ink" : "border-line text-ink-2",
                  )}
                >
                  <Icone className="size-3.5" strokeWidth={1.75} />
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  const grupos: { nome: string; itens: Secao[] }[] = [];
  for (const s of SECOES) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nome === s.grupo) ultimo.itens.push(s);
    else grupos.push({ nome: s.grupo, itens: [s] });
  }

  return (
    <nav aria-label="Secções do website" className="lg:sticky lg:top-4 lg:self-start">
      {grupos.map((g, i) => (
        <div key={g.nome} className={cx(i > 0 && "mt-4")}>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">{g.nome}</p>
          <ul className="space-y-px">
            {g.itens.map((s) => {
              const on = s.key === ativa;
              const Icone = s.icone;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-current={on ? "page" : undefined}
                    onClick={() => onIr(s.key)}
                    className={cx(
                      "group relative flex h-9 w-full items-center gap-2.5 text-left text-body transition-colors duration-[120ms]",
                      on ? "font-medium text-ink" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-signal-ink transition-opacity duration-[120ms]",
                        on ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icone className={cx("size-4 shrink-0", on && "text-signal-ink")} strokeWidth={on ? 2 : 1.75} />
                    <span className="truncate">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
