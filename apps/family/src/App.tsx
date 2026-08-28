import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Bell, CalendarDays, Home, RefreshCw, User, Wallet } from "lucide-react";
import { load, resetAndLoad, useStore, type Child } from "@/lib/store";
import { hasOnboarded } from "@/lib/onboarding";
import { readToken, signOut, useSession } from "@/lib/session";
import { usePresence } from "@/lib/presence";
import Entrar from "@/screens/Entrar";
import { Avatar, cx } from "@/ui";
import { ClubMark } from "@/ClubMark";
import Today from "@/screens/Today";
import Agenda from "@/screens/Agenda";
import Payments from "@/screens/Payments";
import Athlete from "@/screens/Athlete";
import Notifications from "@/screens/Notifications";
import Onboarding from "@/screens/Onboarding";
import Profile from "@/screens/Profile";

/* -------------------------------------------------------------------------- */
/* Educando activo                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Uma família com dois filhos na academia é o caso normal, não a excepção. O
 * seletor está no topo, sempre visível, e todo o ecrã responde a ele — em vez de
 * duplicar listas com o nome do filho repetido em cada linha.
 */
const ChildContext = createContext<{ child: Child; setChild: (id: string) => void } | null>(null);

export function useChild() {
  const ctx = useContext(ChildContext);
  if (!ctx) throw new Error("useChild fora do provider");
  return ctx;
}

export default function App() {
  const store = useStore();
  const session = useSession();
  const [childId, setChild] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(hasOnboarded);

  // Com sessão, e não antes: sem token cada batida voltava 401. Ver `presence.ts`.
  usePresence(Boolean(session));

  // Só se carrega o que há para carregar quando há quem o possa ler. Sem sessão,
  // cada pedido voltaria 401 e a app abria num ecrã de erro — quando o que se
  // passa não é uma avaria, é ainda não ter entrado.
  useEffect(() => {
    if (readToken()) void load();
  }, []);

  // O primeiro filho, até alguém escolher outro. Segue os dados: antes de a
  // academia chegar não há filho nenhum para escolher.
  const child = store.children.find((c) => c.id === childId) ?? store.children[0];
  const value = useMemo(() => (child ? { child, setChild } : null), [child]);

  /*
   * A porta, antes de tudo o resto.
   *
   * Antes desta linha a app entrava sozinha com uma conta de teste — um atalho de
   * desenvolvimento que já não faz sentido agora que as famílias se registam a
   * sério pelo link do clube. Ver `screens/Entrar.tsx`.
   */
  if (!session) return <Entrar onEntered={() => void resetAndLoad()} />;

  if (!store.ready) return <Splash />;
  if (store.error) return <Failed message={store.error} />;
  /*
   * Esta app é da família, e só da família.
   *
   * Tudo o que ela desenha parte de um pressuposto — a lista que vem de
   * `/api/athletes` são **os filhos de quem está a ver**. Isso é verdade para um
   * encarregado, cujo âmbito o servidor estreita aos educandos dele; não é
   * verdade para um treinador, que recebe o plantel das equipas dele. Sem esta
   * porta, uma conta de staff que abrisse a app via o escalão inteiro
   * apresentado como filhos seus.
   *
   * A defesa a sério é do lado do servidor (ver `escolherMembership`), que
   * recusa servir esta app a quem não tenha vínculo de família. Isto aqui é a
   * segunda camada, e é a que consegue explicar: um 403 seco mandaria o pai para
   * um ecrã de avaria por causa de uma coisa que não é avaria nenhuma.
   */
  if (!ehFamilia(store.role)) return <ContaErrada />;
  if (!value) return <NoChildren />;

  /*
   * A apresentação corre **depois** do bootstrap, não antes: fala pelo nome da
   * academia e do pai, e cumprimentar "Bem-vindo à" seguido de um espaço vazio
   * seria pior do que meio segundo de splash.
   */
  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />;

  return (
    <ChildContext.Provider value={value}>
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
        <Header />

        <main className="flex-1 px-4 pb-[calc(104px+env(safe-area-inset-bottom))]">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/pagamentos" element={<Payments />} />
            <Route path="/atleta" element={<Athlete />} />
            <Route path="/notificacoes" element={<Notifications />} />
            <Route path="/perfil" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <TabBar />
      </div>
    </ChildContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Estados de arranque                                                         */
/* -------------------------------------------------------------------------- */

/** Enquanto a academia não chega. Um pulsar discreto, não um spinner ansioso. */
function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8">
      <span
        className="size-12 animate-pulse rounded-[16px]"
        style={{ background: "var(--color-signal)" }}
        aria-hidden
      />
      <p className="text-meta text-ink-3">A carregar…</p>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-[19px] font-semibold text-ink">Não foi possível carregar</p>
      <p className="max-w-[32ch] text-meta leading-relaxed text-ink-3">{message}</p>
      <button type="button" onClick={() => window.location.reload()} className="cta mt-2">
        <RefreshCw className="size-[18px]" strokeWidth={1.9} />
        Tentar outra vez
      </button>
    </div>
  );
}

/**
 * Uma conta sem educandos associados.
 *
 * Acontece a sério: um pai convidado antes de o atleta estar inscrito. Dizer isto
 * é melhor do que uma app vazia que parece avariada.
 */
/** Os papéis que esta app serve. Os outros entram pela consola do clube. */
const ehFamilia = (role: string) => role === "GUARDIAN" || role === "ATHLETE";

/**
 * A conta que entrou não é de uma família.
 *
 * Acontece a quem trabalha no clube e experimenta a app com a conta de trabalho —
 * e acontecia em silêncio, com o plantel todo a aparecer como filhos. Diz-se o
 * que se passa e oferece-se a única saída útil: sair, e entrar com a conta certa.
 */
function ContaErrada() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-[19px] font-semibold text-ink">Esta conta não é de encarregado</p>
      <p className="max-w-[34ch] text-meta leading-relaxed text-ink-3">
        Esta app é das famílias. A tua conta é do staff do clube — para gerires a academia, entra pela consola no
        computador.
      </p>
      <button type="button" onClick={() => signOut()} className="cta-quiet mt-2 h-11 px-5">
        Sair desta conta
      </button>
    </div>
  );
}

function NoChildren() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-[19px] font-semibold text-ink">Ainda não há atletas associados</p>
      <p className="max-w-[34ch] text-meta leading-relaxed text-ink-3">
        A academia ainda não ligou nenhum educando a esta conta. Assim que o fizer, aparece aqui.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Header() {
  const store = useStore();
  const navigate = useNavigate();
  const unread = store.notifications.filter((n) => !n.readAt).length;

  return (
    <header className="sticky top-0 z-30 bg-canvas/85 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <ClubMark
          logoUrl={store.academy.logoUrl}
          mark={store.academy.mark}
          size={36}
          radius={11}
          className="shadow-[var(--shadow-soft)]"
        />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[15px] font-semibold text-ink">{store.academy.shortName}</span>
          <span className="block truncate text-[12px] text-ink-3">{store.guardian.name}</span>
        </span>
        <button type="button" onClick={() => navigate("/notificacoes")} className="icon-btn" aria-label="Notificações">
          <Bell className="size-[22px]" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-2 right-2.5 flex min-w-[16px] items-center justify-center rounded-full bg-risk px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
              {unread}
            </span>
          )}
        </button>
        {/* O perfil vive no canto onde toda a gente já o procura, e não como um
            quinto separador: visita-se uma vez por mês, não a cada abertura. */}
        <button
          type="button"
          onClick={() => navigate("/perfil")}
          className="shrink-0 rounded-full active:scale-95"
          aria-label="O meu perfil"
        >
          <Avatar name={store.guardian.name} size={34} />
        </button>
      </div>

      <ChildSwitcher />
    </header>
  );
}

/**
 * Trocar de educando.
 *
 * Era uma fila de pastilhas soltas, cada uma com a sua sombra — muito ruído para
 * uma escolha entre duas pessoas, e o filho activo lia-se como um botão premido,
 * não como um estado. Agora é um controlo só: uma calha afundada onde uma
 * pastilha clara **desliza** para quem está seleccionado. O fundo diz "estes são
 * os teus filhos", a pastilha diz "estás a ver este", e a app inteira por baixo
 * responde à mesma peça.
 *
 * O ponto vermelho no avatar é a razão de ser do seletor: sem ele, uma
 * mensalidade em atraso do outro filho só se descobria trocando às cegas.
 */
function ChildSwitcher() {
  const store = useStore();
  const { child, setChild } = useChild();

  if (store.children.length < 2) return null;

  return (
    <div className="mt-3 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        role="tablist"
        aria-label="Educando"
        className="flex w-full min-w-max gap-1 rounded-full bg-sunken/80 p-1"
      >
        {store.children.map((c) => {
          const active = c.id === child.id;
          const owing = store.payments.some(
            (p) => p.childId === c.id && (p.status === "overdue" || p.status === "pending"),
          );
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setChild(c.id)}
              className={cx(
                "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full py-1 pr-4 pl-1 transition-all duration-300 ease-[var(--ease-spring)]",
                active ? "bg-surface shadow-[var(--shadow-soft)]" : "active:bg-surface/50",
              )}
            >
              <span className={cx("relative transition-opacity duration-300", active ? "opacity-100" : "opacity-55")}>
                <Avatar name={c.name} photoUrl={c.photoUrl} size={26} />
                {owing && (
                  <span
                    className={cx(
                      "absolute -top-px -right-px size-2.5 rounded-full bg-risk ring-2",
                      active ? "ring-surface" : "ring-sunken",
                    )}
                    aria-label="Tem pagamento em falta"
                  />
                )}
              </span>
              <span
                className={cx(
                  "truncate text-[13px] font-semibold transition-colors duration-300",
                  active ? "text-ink" : "text-ink-3",
                )}
              >
                {c.firstName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const TABS = [
  { to: "/", label: "Hoje", icon: Home },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/pagamentos", label: "Pagar", icon: Wallet },
  { to: "/atleta", label: "Atleta", icon: User },
];

/**
 * Nav flutuante em pílula.
 *
 * Escura, arredondada, a pairar acima do conteúdo — não uma barra colada ao vidro.
 * O separador activo abre-se num comprimido claro com o nome ao lado; os outros
 * ficam só ícone. É a gramática das melhores apps de consumo: sabes onde estás
 * sem ler, e o toque tem um alvo confortável.
 */
function TabBar() {
  const store = useStore();
  const owing = store.payments.some((p) => p.status === "overdue" || p.status === "pending");

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(14px+env(safe-area-inset-bottom))]">
      <ul
        className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink/95 p-1.5 backdrop-blur-xl"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cx(
                  "relative flex h-11 items-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  isActive ? "gap-2 bg-white px-4 text-ink" : "px-3 text-white/55 active:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className="size-[22px]" strokeWidth={isActive ? 2 : 1.75} />
                    {to === "/pagamentos" && owing && !isActive && (
                      <span className="absolute -top-1 -right-1.5 size-2.5 rounded-full bg-risk ring-2 ring-ink" />
                    )}
                  </span>
                  {isActive && <span className="text-[14px] font-semibold whitespace-nowrap">{label}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
