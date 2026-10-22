import { useEffect, useRef } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, cx } from "@/components/primitives";
import {
  ExternalLink,
  Eye,
  Globe,
  Handshake,
  IdCard,
  Inbox,
  LayoutGrid,
  LayoutTemplate,
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
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { enderecoDoSite, useCarregamentoDoSite, useSite } from "@/lib/website";
import { VisaoGeral } from "./VisaoGeral";
import { Identidade, Aspeto, Dominio } from "./Configuracao";
import { Inicio } from "./Inicio";
import { Noticias } from "./Noticias";
import { Loja } from "./Loja";
import { Bilheteira } from "./Bilheteira";
import { Estadio } from "./Estadio";
import { Equipas, Patrocinadores, Mensagens } from "./Conteudo";

/**
 * Website — o site do clube, gerido daqui. Só para clubes com o site no plano
 * (Connect Pro): ver `GRUPO_WEBSITE` em `lib/nav.ts`.
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
  | "inicio"
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
  { key: "inicio", label: "Página de início", grupo: "Site", icone: LayoutTemplate, descricao: "A página de início como o visitante a vê. Arrasta as secções, mostra ou esconde, e acrescenta banners onde quiseres." },
  { key: "dominio", label: "Domínio", grupo: "Site", icone: Link2, descricao: "O endereço .pt do clube, e onde o site vive enquanto o domínio não aponta para cá." },
  { key: "noticias", label: "Notícias", grupo: "Conteúdo", icone: Newspaper, descricao: "O que se escreve sobre o clube. As três em destaque abrem a página de início." },
  { key: "equipas", label: "Equipas", grupo: "Conteúdo", icone: Users, descricao: "Que equipas aparecem no site. O plantel só com o consentimento das famílias." },
  { key: "patrocinadores", label: "Patrocinadores", grupo: "Conteúdo", icone: Handshake, descricao: "Quem apoia o clube. Aparecem no fundo de todas as páginas." },
  { key: "estadio", label: "Estádio", grupo: "Vendas", icone: Recinto, descricao: "O recinto visto de cima, com as bancadas. Quem compra um bilhete vê no mapa onde vai ficar." },
  { key: "bilheteira", label: "Bilheteira", grupo: "Vendas", icone: Ticket, descricao: "Bilhetes para os jogos em casa: preços por bancada e público, quem compra e quando, as vendas e o leitor dos seguranças à porta. O bilhete chega com um código QR." },
  { key: "loja", label: "Loja", grupo: "Vendas", icone: ShoppingBag, descricao: "Os produtos à venda no site, com tamanhos e preço." },
  { key: "mensagens", label: "Mensagens", grupo: "Contacto", icone: Inbox, descricao: "O que chega pelo formulário de contactos do site." },
];

function secaoDe(valor: string | null): SecaoKey {
  return SECOES.some((s) => s.key === valor) ? (valor as SecaoKey) : "geral";
}

/** Sem o site no plano (Connect Pro) o menu não aparece, e quem escreve o endereço volta ao início. */
export default function Website() {
  const store = useStore();
  if (!store.academy.websiteIncluido) return <Navigate to="/" replace />;
  return <WebsiteDoClube />;
}

function WebsiteDoClube() {
  const store = useStore();
  const { session } = useSession();
  const site = useSite(store.academy.slug);
  const { carregado, erro } = useCarregamentoDoSite(store.academy.slug);
  const [params, setParams] = useSearchParams();
  const mobile = useMobile();

  const ativa = secaoDe(params.get("secao"));
  const secao = SECOES.find((s) => s.key === ativa)!;
  const ir = (key: SecaoKey) => setParams(key === "geral" ? {} : { secao: key });
  // Ver é `website:read`; mudar o que quer que seja é `website:write`. O servidor
  // recusa na mesma: a faixa é para a pessoa saber antes de tentar.
  const soLeitura = !can(session, "website:write");

  return (
    <>
      <PageHeader eyebrow={store.academy.name} title="Website">
        <a href={enderecoDoSite(store.academy.slug, site.dominio)} target="_blank" rel="noopener noreferrer" className="ctl-outline">
          <Globe className="size-4" strokeWidth={1.75} />
          Ver o site
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </a>
      </PageHeader>

      {soLeitura && (
        <p className="mb-5 flex items-start gap-2 rounded-[10px] border border-line bg-sunken/60 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
          <Eye className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>
            <strong className="font-semibold text-ink">Podes ver o site, mas não publicar.</strong> Mudar o conteúdo ou pôr o site no ar é de quem tem a
            permissão de publicar o website.
          </span>
        </p>
      )}

      {/* Por publicar: o endereço do site mostra "não ligado" até o clube o pôr no ar (Visão geral). */}
      {carregado && !site.publicado && (
        <p className="mb-5 flex items-start gap-2 rounded-[10px] border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-meta leading-relaxed text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>
            <strong className="font-semibold">O site ainda não está no ar.</strong> Prepara o que quiseres e publica-o na Visão geral.
          </span>
        </p>
      )}

      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-[212px_minmax(0,1fr)]">
        <Submenu ativa={ativa} onIr={ir} horizontal={mobile} porLer={site.mensagensPorLer} />

        <section className="min-w-0" aria-labelledby="secao-titulo">
          <header className="mb-5 border-b border-line pb-4">
            <h2 id="secao-titulo" className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {secao.label}
            </h2>
            <p className="mt-1 max-w-[68ch] text-body leading-relaxed text-ink-3">{secao.descricao}</p>
          </header>

          <div className="max-w-[980px]">
            {erro && !carregado && <Empty icon={TriangleAlert} title="Não foi possível abrir o site do clube" detail={erro} />}
            {!erro && !carregado && <Loading size="panel" />}
            {carregado && ativa === "geral" && <VisaoGeral onIr={(k) => ir(k as SecaoKey)} />}
            {carregado && ativa === "identidade" && <Identidade />}
            {carregado && ativa === "aspeto" && <Aspeto />}
            {carregado && ativa === "inicio" && <Inicio onIr={(k) => ir(k as SecaoKey)} />}
            {carregado && ativa === "dominio" && <Dominio />}
            {carregado && ativa === "noticias" && <Noticias />}
            {carregado && ativa === "equipas" && <Equipas />}
            {carregado && ativa === "patrocinadores" && <Patrocinadores />}
            {carregado && ativa === "estadio" && <Estadio />}
            {carregado && ativa === "bilheteira" && <Bilheteira onIrParaEstadio={() => ir("estadio")} />}
            {carregado && ativa === "loja" && <Loja />}
            {carregado && ativa === "mensagens" && <Mensagens />}
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * O submenu, igual ao das Definições: coluna presa no computador, fila no
 * telemóvel. `porLer` é a pastilha das Mensagens: o que chegou pelo formulário
 * do site e ninguém abriu ainda.
 */
function Submenu({ ativa, onIr, horizontal, porLer }: { ativa: SecaoKey; onIr: (k: SecaoKey) => void; horizontal: boolean; porLer: number }) {
  const ativoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (horizontal) ativoRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [horizontal, ativa]);

  const pastilha = (s: Secao) =>
    s.key === "mensagens" && porLer > 0 ? (
      <span
        className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-signal-strong px-1.5 text-[11px] font-semibold leading-none text-white"
        aria-label={`${porLer} ${porLer === 1 ? "mensagem por ler" : "mensagens por ler"}`}
      >
        {porLer > 99 ? "99+" : porLer}
      </span>
    ) : null;

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
                  {pastilha(s)}
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
                    {pastilha(s)}
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
