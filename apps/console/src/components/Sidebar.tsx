import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, Check, ChevronDown, ChevronsUpDown, LogOut, PanelLeft, Search, Shield, Users } from "@/lib/icons";
import { teamAgeLabel } from "@/lib/team-age";
import { navFor, SETTINGS_ITEM, type NavItem } from "@/lib/nav";
import { useNavGroups } from "@/lib/nav-groups";
import { permissionsOf } from "@/lib/permissions";
import { academy, listAthletes, listTeams, navCounts, teamById } from "@/lib/api";
import { DEV_PROFILES, devSignInAs, signOut } from "@/lib/session";
import { ROLE_LABEL, useSession } from "@/session";
import { cx, Monogram } from "./primitives";
import { ClubMark } from "./ClubMark";
import { NotificationsPanel } from "./NotificationsPanel";
import { useUnreadCount } from "@/lib/notifications";
import { TrialBadge } from "./TrialBadge";

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { session } = useSession();
  const groups = navFor(session);
  const counts = navCounts(session);
  const { estaAberto, alternar } = useNavGroups();
  const { pathname } = useLocation();

  // Um item precisa de correspondência exacta quando existe outro item do menu
  // aninhado por baixo dele — senão os dois acendem-se ao mesmo tempo. Derivado
  // do próprio menu, para não haver uma bandeira manual a esquecer-se.
  const all = groups.flatMap((g) => g.items.map((i) => i.to));
  const nested = new Set(all.filter((to) => all.some((other) => other !== to && other.startsWith(`${to}/`))));
  const showSettings = permissionsOf(session).has(SETTINGS_ITEM.requires);

  return (
    <aside
      className={cx(
        "flex h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 max-md:hidden",
        collapsed ? "w-[60px]" : "w-[236px]",
      )}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
    >
      <AcademyHeader collapsed={collapsed} onToggle={onToggle} />

      {!collapsed && <SearchField />}

      {/* `overflow-y-auto` fica como rede de segurança para janelas absurdamente
          baixas. Com a densidade de `styles.css` não deve chegar a disparar.
          `pt-2`: sem ele o primeiro item ("Visão geral") ficava colado à pesquisa
          (aberto) ou à borda do cabeçalho (fechado), enquanto os grupos seguintes
          respiram com 18px entre si — a folga no topo repõe esse ritmo. */}
      <nav className="flex-1 overflow-y-auto p-2">
        {/* A classe `nav-group` vai em todos: o espaçamento é
            `.nav-group + .nav-group`, que só separa irmãos e por isso não põe
            margem antes do primeiro. */}
        {groups.map((group, i) => {
          /*
           * Recolhida, a barra mostra tudo.
           *
           * Numa coluna de 60px não há cabeçalho onde carregar, e um grupo fechado
           * ficaria sem forma de se reabrir. O que separa os grupos aí é a linha —
           * como sempre foi.
           */
          const aberto = collapsed || estaAberto(group.label);

          return (
            <div key={group.label ?? `g${i}`} className="nav-group">
              {group.label && !collapsed && (
                <GroupHeader
                  label={group.label}
                  open={aberto}
                  // Fechar um grupo escondia onde a pessoa está: sai o item
                  // aceso e o menu deixa de responder à pergunta. O ponto do
                  // cabeçalho fica cheio quando a página actual vive lá dentro.
                  aqui={group.items.some((it) => pathname === it.to || pathname.startsWith(`${it.to}/`))}
                  onToggle={() => alternar(group.label!)}
                />
              )}
              {group.label && collapsed && <div className="mx-2.5 mb-2 border-t border-line" />}
              {/*
                Os destinos entram um pouco para dentro do título do grupo.
                Sem isto, o cabeçalho e os seus itens começavam na mesma coluna e
                a hierarquia lia-se pelo tamanho da letra e mais nada.
              */}
              {aberto && (
                <ul className={cx("space-y-px", !collapsed && group.label && "ml-2")}>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <Item item={item} collapsed={collapsed} badge={item.badge?.(counts)} exact={nested.has(item.to)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {showSettings && (
        <div className="px-2 pb-2">
          <Item item={SETTINGS_ITEM} collapsed={collapsed} />
        </div>
      )}

      <UserCard collapsed={collapsed} />
      <TrialBadge
        status={academy.status}
        trialEndsAt={academy.trialEndsAt}
        createdAt={academy.createdAt}
        collapsed={collapsed}
      />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O cabeçalho de um grupo — o rótulo, a cor e a seta.
 *
 * ## Porque é que é um botão e já não uma legenda
 *
 * Era texto. Agora abre e fecha o grupo, e isso muda uma decisão antiga: a
 * densidade da barra escondia estes rótulos abaixo dos 800px de altura
 * (`--nav-label-display: none`) para poupar cem pixels, trocando-os por
 * separadores. Deixou de poder fazê-lo — esconder o cabeçalho escondia a única
 * forma de reabrir um grupo fechado, e a pessoa ficava sem lá chegar.
 *
 * A troca é boa: fechar dois grupos que não se usam ganha mais do que os cem
 * pixels que os rótulos custam, e ganha-o onde quem usa a consola escolhe.
 *
 * ## A cor
 *
 * O rótulo e o ponto tomam a cor do grupo (ver `NavGroup.tone`). É o que dá ao
 * menu pontos de referência — ao fim de dois dias chega-se a "Mensalidades" pelo
 * bronze, sem ler a palavra. `ink` e não `base`: é texto pequeno sobre branco, e
 * `ink` é o tom da paleta que foi calculado para se ler aí.
 */
function GroupHeader({
  label,
  open,
  aqui,
  onToggle,
}: {
  label: string;
  open: boolean;
  /** A página actual está dentro deste grupo. */
  aqui: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="nav-group-head group flex w-full items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-group font-semibold text-ink uppercase transition-colors duration-[120ms] hover:bg-sunken"
    >
      <span className="flex-1 truncate text-left">{label}</span>

      {/*
        O ponto só quando o grupo está fechado **e** a página actual vive lá
        dentro. Fechá-lo tirava o item aceso e o menu deixava de responder a
        "onde estou"; isto repõe a resposta sem pôr um ponto em cada cabeçalho.
        À direita, junto à seta, para não empurrar o título quando aparece.
      */}
      {!open && aqui && (
        <span
          aria-hidden
          title="A página onde estás vive aqui dentro"
          className="size-1.5 shrink-0 rounded-full bg-[var(--color-signal-line)]"
        />
      )}
      {/*
        Uma seta só, que roda. Duas setas diferentes — uma para baixo e outra
        para a direita — trocam a forma no momento do clique e o olho lê aquilo
        como um salto; a mesma a rodar lê-se como o mesmo objecto a mudar de
        estado, que é o que de facto acontece.
      */}
      <ChevronDown
        className={cx(
          "size-3.5 shrink-0 text-ink-4 transition-transform duration-[160ms] motion-reduce:transition-none",
          open ? "" : "-rotate-90",
        )}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function AcademyHeader({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = useUnreadCount();

  // Recolhida, a própria marca é o botão de expandir — evita dois alvos de 32px
  // empilhados numa coluna de 60px.
  if (collapsed) {
    return (
      <div className="nav-header flex items-center justify-center border-b border-line">
        {/* O mesmo "LC" em código que estava no cabeçalho expandido. Ver `ClubMark`. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expandir navegação"
          className="group relative flex size-7 items-center justify-center"
        >
          <span className="transition-opacity duration-[120ms] group-hover:opacity-0">
            <ClubMark size={28} radius={7} />
          </span>
          <PanelLeft
            className="absolute size-4 text-ink-2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100"
            strokeWidth={1.75}
          />
        </button>
      </div>
    );
  }

  return (
    <div className="nav-header flex items-center gap-2 border-b border-line pr-2 pl-3">
      {/* A marca é da academia, não nossa. Somos a tecnologia por trás. */}
      {/*
        O símbolo do clube — era "LC" escrito à mão, o monograma do clube de
        demonstração. Um clube chamado Fafe abria a consola e via as iniciais de
        outro. Ver `ClubMark`.
      */}
      <ClubMark size={28} radius={7} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-semibold text-ink">{academy.shortName}</div>
        <div className="truncate text-[11px] text-ink-3">Época 2026/27</div>
      </div>

      {/*
        O sino, agora ligado.
        Era um botão sem `onClick` com um ponto vermelho permanente — decoração
        que não vinha de haver mesmo alguma coisa por ler. O ponto passa a
        aparecer só quando há, e carregar abre a lista. Ver `NotificationsPanel`.
      */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setNotifOpen((v) => !v)}
          aria-label="Notificações"
          aria-expanded={notifOpen}
          className="ctl-ghost relative size-8 justify-center px-0"
        >
          <Bell className="size-4" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-signal-strong ring-2 ring-surface" />
          )}
        </button>
        {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="ctl-ghost size-8 justify-center px-0"
        aria-label="Recolher navegação"
      >
        <PanelLeft className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

type SearchResult = { kind: "athlete" | "team"; id: string; name: string; sub: string };

/**
 * Pesquisa de atletas e equipas.
 *
 * Numa academia com 120 atletas, procurar é mais rápido do que navegar — por isso o
 * campo faz mesmo alguma coisa: a escrever, mostra atletas e equipas cujo nome
 * bate, e ao escolher salta para a ficha. A lista já vem no âmbito de quem procura
 * (`listAthletes`/`listTeams`), portanto um treinador só encontra os seus.
 */
function SearchField() {
  const { session } = useSession();
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // ⌘K / Ctrl+K foca a pesquisa de qualquer sítio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const athletes: SearchResult[] = listAthletes(session)
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((a) => ({ kind: "athlete", id: a.id, name: a.name, sub: teamById(a.teamId)?.name ?? "Sem equipa" }));
    const teams: SearchResult[] = listTeams(session)
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((t) => ({ kind: "team", id: t.id, name: t.name, sub: teamAgeLabel(t.maxAge) }));
    return [...teams, ...athletes];
  }, [query, session]);

  const go = (r: SearchResult) => {
    navigate(r.kind === "athlete" ? `/atletas/${r.id}` : `/equipas/${r.id}`);
    setQuery("");
    setOpen(false);
    ref.current?.blur();
  };

  const show = open && query.trim().length > 0;

  return (
    <div ref={boxRef} className="nav-search relative px-2">
      <div className="group relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
        <input
          ref={ref}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0]);
            if (e.key === "Escape") {
              setQuery("");
              setOpen(false);
            }
          }}
          placeholder="Procurar atleta, equipa…"
          className="w-full rounded-[var(--radius-control)] bg-sunken pr-11 pl-8 text-meta text-ink placeholder:text-ink-4 focus:bg-surface focus:ring-1 focus:ring-line-strong focus:outline-none"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[10px] text-ink-4">⌘K</kbd>
      </div>

      {show && (
        <div className="absolute top-[calc(100%+2px)] right-2 left-2 z-30 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface py-1 shadow-[var(--shadow-pop)]">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-meta text-ink-4">Nada com “{query.trim()}”.</p>
          ) : (
            <ul className="max-h-[320px] overflow-y-auto">
              {results.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // `onMouseDown` e não `onClick`: o blur do input dispararia
                      // antes do clique e fechava a lista primeiro.
                      e.preventDefault();
                      go(r);
                    }}
                    className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors duration-[120ms] hover:bg-sunken"
                  >
                    {r.kind === "athlete" ? (
                      <Monogram name={r.name} size="sm" />
                    ) : (
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
                        <Shield className="size-3.5" strokeWidth={1.75} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{r.name}</span>
                      <span className="block truncate text-[11px] text-ink-3">{r.sub}</span>
                    </span>
                    {r.kind === "team" && <Users className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  item,
  collapsed,
  badge,
  exact,
}: {
  item: NavItem;
  collapsed: boolean;
  badge?: number;
  exact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      // `end` só onde é preciso: "/atletas" deve continuar aceso na ficha de um
      // atleta, mas "/clinico" não pode acender-se em "/clinico/consultas", que é
      // um irmão e não um filho. O cálculo está em `nested`.
      end={exact || item.to === "/"}
      title={collapsed ? (item.beta ? `${item.label} (beta)` : item.label) : undefined}
      className={({ isActive }) =>
        cx(
          "nav-item group relative flex items-center rounded-[var(--radius-control)] text-body font-medium transition-colors duration-[120ms]",
          collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
          isActive ? "nav-active" : "text-ink-2 hover:bg-sunken hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/*
            O ícone leva a cor do clube — mas pelo tom que se vê.
            `.nav-icon` é `--color-signal-line`, a cor escurecida até aos 3:1
            contra o branco; a cor crua de um clube amarelo desaparecia aqui.
            Activo, passa à tinta do fundo suave. Ver `styles.css`.
          */}
          <Icon
            className={cx("size-4 shrink-0 transition-colors duration-[120ms]", isActive ? "nav-active-icon" : "nav-icon")}
            strokeWidth={1.75}
          />
          {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}

          {/*
            "Beta" é um aviso, não um alerta.

            Por isso é cinzento e não leva a cor do clube: essa está reservada
            ao contador, que conta trabalho por fazer. Duas marcas coloridas na
            mesma linha competiam, e a que interessa a quem trabalha é a outra.

            Recolhida a barra não cabe — vai no `title` do item, junto ao nome.
          */}
          {item.beta && !collapsed && (
            <span className="shrink-0 rounded-[4px] bg-sunken px-1 py-px text-[9px] leading-[14px] font-semibold tracking-wide text-ink-3 uppercase">
              beta
            </span>
          )}
          {/*
            O contador, na cor do clube.

            Era vermelho. O vermelho neste produto quer dizer **está errado** —
            uma mensalidade vencida, um atleta de baixa — e o menu usava-o para
            dizer outra coisa: "há aqui coisas por fazer". Três presenças por
            registar não são um erro, e uma barra com quatro pontos vermelhos
            ensina a ignorá-los, que é o oposto do que um contador serve.

            `signal-strong` + `signal-on`, e não `signal` cru: é o par desenhado
            para uma superfície **cheia** com texto por cima — `strongSignal`
            escurece a cor até a sua própria tinta se ler nela. Um clube amarelo
            recebe tinta escura; nenhum recebe branco sobre amarelo.

            Cheio e não suave, ao contrário do resto do menu: por cima da linha
            activa o fundo já é `signal-soft`, e um contador suave desaparecia lá
            precisamente na página onde a pessoa está.
          */}
          {badge !== undefined && badge > 0 && (
            <span
              className={cx(
                "tabular",
                collapsed
                  ? "absolute top-1 right-1 size-1.5 rounded-full bg-signal-strong"
                  : "rounded-full bg-signal-strong px-1.5 py-px text-[11px] font-semibold text-signal-on",
              )}
            >
              {!collapsed && badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cartão do utilizador com selector de perfil.
 *
 * O selector é uma peça de demonstração: trocar de Direção para Equipa técnica
 * reconstrói a navegação, o âmbito dos dados e os ecrãs a partir das permissões.
 * Em produção este menu é conta / academia / terminar sessão.
 */
function UserCard({ collapsed }: { collapsed: boolean }) {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative border-t border-line p-2">
      {open && (
        <div
          className="absolute bottom-[calc(100%-4px)] left-2 z-20 w-[228px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
          role="menu"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-body font-medium text-ink">{session.name}</div>
            <div className="truncate text-[11px] text-ink-3">{ROLE_LABEL[session.role]}</div>
          </div>

          {/* Troca de perfil — só em desenvolvimento. Cada opção é um re-login a
              sério na conta daquele papel (ver `devSignInAs`), não uma máscara. */}
          {import.meta.env.DEV && (
            <div className="mt-1 border-t border-line pt-1">
              <div className="px-2.5 pt-0.5 pb-1 text-[10px] font-semibold tracking-wide text-ink-4 uppercase">
                Ver como · teste
              </div>
              {DEV_PROFILES.map((p) => {
                const current = session.role === p.role;
                return (
                  <button
                    key={p.role}
                    type="button"
                    role="menuitem"
                    disabled={current}
                    onClick={() => void devSignInAs(p.email)}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left transition-colors duration-[120ms]",
                      current ? "cursor-default" : "hover:bg-sunken",
                    )}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center nav-active-icon">
                      {current && <Check className="size-3.5" strokeWidth={2.25} />}
                    </span>
                    <span className={cx("min-w-0 flex-1 truncate text-body", current ? "font-medium text-ink" : "text-ink-2")}>
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Sair leva de volta à página do clube — não a um ecrã de login
              genérico. Cada academia tem o seu endereço, e é lá que se volta a
              entrar. */}
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-sunken"
            >
              <span className="flex size-6 shrink-0 items-center justify-center text-ink-3">
                <LogOut className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">Terminar sessão</span>
                <span className="block truncate text-[11px] text-ink-3">Voltar a {academy.shortName}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          "flex w-full items-center rounded-[var(--radius-control)] transition-colors duration-[120ms] hover:bg-sunken",
          collapsed ? "justify-center p-1" : "gap-2.5 p-1.5",
        )}
      >
        <Monogram name={session.name} self />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-body font-medium text-ink">{session.name}</span>
              <span className="block truncate text-[11px] text-ink-3">{ROLE_LABEL[session.role]}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
          </>
        )}
      </button>
    </div>
  );
}
