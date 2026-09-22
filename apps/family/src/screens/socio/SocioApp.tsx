import { useEffect, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import QRCode from "qrcode";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CreditCard,
  Home,
  MapPin,
  Megaphone,
  RefreshCw,
  Smartphone,
  Wallet,
} from "lucide-react";
import { ClubMark } from "@/ClubMark";
import {
  Avatar,
  Chip,
  Label,
  Money,
  cx,
  dateShort,
  dayName,
  greeting,
  initials,
  money,
  time,
  whenLabel,
} from "@/ui";
import { signOut } from "@/lib/session";
import { useFresco } from "@/lib/fresco";
import {
  loadSocio,
  pagarAte,
  pagarQuota,
  removerFotoSocio,
  uploadFotoSocio,
  useSocio,
  votar,
  type PagamentoIniciado,
  type SocioMatch,
  type SocioMes,
  type SocioPoll,
} from "@/lib/socio";
import { AreaSwitch } from "@/screens/socio/AreaSwitch";
import Notifications from "@/screens/Notifications";
import { carregarNotificacoes, useNotificacoes } from "@/lib/notificacoes";

/**
 * A Member View — a área de sócio da app do clube.
 *
 * ## A mesma app, outra roupa
 *
 * Isto não é uma segunda aplicação: é a mesma PWA, o mesmo login, a mesma marca
 * do clube — com outro contexto vestido. A estrutura espelha a da família de
 * propósito (header com o clube, pílula de navegação em baixo, ecrãs em
 * cascata), porque quem troca de contexto não deve sentir que mudou de produto.
 *
 * ## O que aqui NÃO há
 *
 * Bilhetes, checkout, controlo de entradas. O cartão identifica, as quotas
 * pagam-se, o resto informa. Foi desenhado assim de propósito e está escrito no
 * pedido — a arquitectura aguenta bilhética um dia, mas hoje não a insinua.
 */
export default function SocioApp() {
  const { data, error } = useSocio();

  useEffect(() => {
    if (!data) void loadSocio();
  }, [data]);

  /* Ao voltar ao ecrã, de minuto a minuto, e quando chega um push — ver `lib/fresco`. */
  useFresco(loadSocio);

  if (error && !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-[19px] font-semibold text-ink">
          Não foi possível carregar
        </p>
        <p className="max-w-[34ch] text-meta leading-relaxed text-ink-3">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void loadSocio()}
          className="cta mt-2"
        >
          <RefreshCw className="size-[18px]" strokeWidth={1.9} />
          Tentar outra vez
        </button>
        <button
          type="button"
          onClick={() => signOut()}
          className="mt-1 text-meta font-semibold text-ink-3 underline-offset-2 active:underline"
        >
          Entrar com outra conta
        </button>
      </div>
    );
  }

  if (!data) {
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

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <SocioHeader />
      <main className="flex-1 px-4 pb-[calc(104px+env(safe-area-inset-bottom))]">
        <Routes>
          <Route path="/socio" element={<Inicio />} />
          <Route path="/socio/quotas" element={<Quotas />} />
          <Route path="/socio/jogos" element={<Jogos />} />
          <Route path="/socio/novidades" element={<Novidades />} />
          {/* As mesmas notificações da família — são da pessoa, não da área. Ver `lib/notificacoes`. */}
          <Route path="/socio/notificacoes" element={<Notifications />} />
          <Route path="/socio/perfil" element={<Perfil />} />
          {/* O cartão vive no Início; "Clube" passou a Jogos + Novidades. */}
          <Route path="/socio/cartao" element={<Navigate to="/socio" replace />} />
          <Route path="/socio/clube" element={<Navigate to="/socio/novidades" replace />} />
          <Route path="*" element={<Navigate to="/socio" replace />} />
        </Routes>
      </main>
      <SocioTabBar />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Moldura                                                                     */
/* -------------------------------------------------------------------------- */

function SocioHeader() {
  const { data } = useSocio();
  const navigate = useNavigate();
  /* O mesmo sino da família — a mesma contagem, seja qual for a área vestida. */
  const { unread } = useNotificacoes();
  useEffect(() => {
    void carregarNotificacoes();
  }, []);
  useFresco(carregarNotificacoes);
  if (!data) return null;

  /*
   * `backdrop-blur-md` e não `-xl`: o header está fixo por cima de tudo o que
   * passa, e o desfoque é recalculado a cada fotograma de scroll. Com o fundo a
   * 85% de opacidade só 15% do que está por baixo atravessa — metade do raio
   * não se distingue a olho e poupa metade do trabalho.
   *
   * O filtro **fica**: é dele que depende o portal do `AreaSwitch`.
   */
  return (
    <header className="sticky top-0 z-30 bg-canvas/85 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <ClubMark
          logoUrl={data.academy.logoUrl}
          mark={marca(data.academy.shortName)}
          size={36}
          radius={11}
          className="shadow-[var(--shadow-soft)]"
        />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[15px] font-semibold text-ink">
            {data.academy.shortName}
          </span>
          <span className="block truncate text-[12px] text-ink-3">
            {data.member.number ? `Sócio #${data.member.number}` : "Sócio"}
          </span>
        </span>
        {/* O switcher de contexto vive aqui — pequeno, e só quando há para onde ir. */}
        <AreaSwitch />
        <button type="button" onClick={() => navigate("/socio/notificacoes")} className="icon-btn" aria-label="Notificações">
          <Bell className="size-[22px]" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-2 right-2.5 flex min-w-[16px] items-center justify-center rounded-full bg-risk px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
              {unread}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => navigate("/socio/perfil")}
          className="shrink-0 rounded-full active:scale-95"
          aria-label="O meu perfil"
        >
          <Avatar
            name={data.member.name}
            photoUrl={data.member.photoUrl ?? undefined}
            size={34}
          />
        </button>
      </div>
    </header>
  );
}

/*
 * O cartão já não tem separador: está no Início, que é o que se abre à porta
 * do estádio. O lugar dele ficou para os jogos, e os comunicados e as
 * sondagens têm o seu.
 */
const TABS = [
  { to: "/socio", label: "Início", icon: Home },
  { to: "/socio/quotas", label: "Quotas", icon: Wallet },
  { to: "/socio/jogos", label: "Jogos", icon: CalendarDays },
  { to: "/socio/novidades", label: "Novidades", icon: Megaphone },
];

/** A mesma pílula da família — a app não muda de gramática entre contextos. */
function SocioTabBar() {
  const { data } = useSocio();
  const emDivida = data?.fees.some((f) => f.status === "OPEN") ?? false;

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(14px+env(safe-area-inset-bottom))]">
      {/* Sem desfoque, como na barra da família — ver a nota em `App.tsx`. */}
      <ul
        className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink/95 p-1.5"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/socio"}
              className={({ isActive }) =>
                cx(
                  "relative flex h-11 items-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  isActive
                    ? "gap-2 bg-white px-4 text-ink"
                    : "px-3 text-white/55 active:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon
                      className="size-[22px]"
                      strokeWidth={isActive ? 2 : 1.75}
                    />
                    {to === "/socio/quotas" && emDivida && !isActive && (
                      <span className="absolute -top-1 -right-1.5 size-2.5 rounded-full bg-risk ring-2 ring-ink" />
                    )}
                  </span>
                  {isActive && (
                    <span className="text-[14px] font-semibold whitespace-nowrap">
                      {label}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Duas letras para o `ClubMark` quando não há emblema. */
function marca(shortName: string): string {
  const p = shortName.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? p[0]?.[1] ?? "")).toUpperCase();
}

const ESTADO: Record<
  string,
  { label: string; tone: "ok" | "warn" | "risk" | "neutral" }
> = {
  ACTIVE: { label: "Sócio ativo", tone: "ok" },
  PENDING: { label: "Por aprovar", tone: "neutral" },
  SUSPENDED: { label: "Suspenso", tone: "warn" },
  CANCELLED: { label: "Cancelado", tone: "risk" },
};

/* -------------------------------------------------------------------------- */
/* Início                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * "O que preciso de saber como sócio?" — a mesma pergunta do "Hoje" da família,
 * com outra resposta, por esta ordem:
 *
 * 1. a quota por pagar (é a única coisa accionável), ou a confirmação de que
 *    está tudo em dia;
 * 2. o cartão, inteiro: é o que se mostra à entrada, e abrir a app já o põe à
 *    frente;
 * 3. o jogo de maior prioridade, com o caminho para os outros;
 * 4. os comunicados e a sondagem por responder.
 *
 * Secções vazias não aparecem — um ecrã não é um formulário.
 */
function Inicio() {
  const { data } = useSocio();
  const navigate = useNavigate();
  if (!data) return null;

  const agora = new Date();
  const porPagar = data.fees.filter((f) => f.status === "OPEN");
  const emAtraso = porPagar.some((f) => f.overdue);
  const ultima = data.fees.find((f) => f.status === "SETTLED");
  const sondagem = data.polls.find((p) => !p.myOptionId);
  const destaque = data.matches[0];
  let i = 0;

  return (
    <div className="space-y-5 pt-3">
      {/* À primeira abertura, sem fotografia: a sugestão de a pôr no cartão. */}
      {data.academy.cardEnabled && data.member.photoUrl === null && (
        <FotoSugestao memberId={data.member.id} />
      )}

      <header className="rise px-1" style={{ ["--i" as string]: i++ }}>
        <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          {data.academy.name}
        </p>
        <h1 className="mt-1 text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">
          {greeting(agora)}, {data.member.name.trim().split(/\s+/)[0]} 👋
        </h1>
      </header>

      {/* A quota por pagar vem primeiro: é a única coisa em que é preciso agir. */}
      {porPagar.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/socio/quotas")}
          className="rise flex w-full items-center gap-3 rounded-[20px] bg-ink p-4 text-left"
          style={{ ["--i" as string]: i++ }}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold tracking-[0.05em] text-white/60 uppercase">
              {emAtraso ? "Quota em atraso" : "Quota por pagar"}
            </span>
            <span className="mt-1 block">
              <Money
                cents={porPagar.reduce((n, f) => n + f.amountCents, 0)}
                size="md"
                on
              />
            </span>
          </span>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
            <ChevronRight className="size-5" strokeWidth={2} />
          </span>
        </button>
      )}

      {/* Quota regularizada — a confirmação discreta de que está tudo bem. */}
      {porPagar.length === 0 && ultima && (
        <button
          type="button"
          onClick={() => navigate("/socio/quotas")}
          className="rise flex w-full items-center gap-3 rounded-[20px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]"
          style={{ ["--i" as string]: i++ }}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-ok-soft text-ok">
            <Check className="size-5" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">
              Quotas em dia
            </span>
            <span className="block text-[13px] text-ink-3">
              {ultima.label ?? ultima.period} · {money(ultima.amountCents)}
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-4" strokeWidth={2} />
        </button>
      )}

      {/* O cartão, inteiro: o que antes tinha separador próprio. */}
      {data.academy.cardEnabled && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label>O meu cartão</Label>
          <CartaoDoSocio />
        </section>
      )}

      {/*
        O jogo de maior prioridade. A lista chega ordenada do servidor: dos
        escalões mais velhos para os mais novos, e dentro de cada um o mais
        próximo. O primeiro é o destaque; os outros estão no separador Jogos,
        agrupados por equipa (ver `JogosDoClube`).
      */}
      {destaque && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label>Próximo jogo</Label>
          <JogoCard jogo={destaque} />
          {data.matches.length > 1 && (
            <button
              type="button"
              onClick={() => navigate("/socio/jogos")}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[16px] bg-surface py-3 text-[14px] font-semibold text-signal-ink shadow-[var(--shadow-soft)] active:bg-sunken"
            >
              Ver mais jogos ({data.matches.length - 1})
              <ChevronRight className="size-4" strokeWidth={2.2} />
            </button>
          )}
        </section>
      )}

      {/* Por último, a sondagem por responder e os comunicados mais recentes. */}
      {(sondagem || data.news.length > 0) && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label
            action={
              <button
                type="button"
                onClick={() => navigate("/socio/novidades")}
                className="text-[13px] font-semibold text-signal-ink"
              >
                Ver tudo
              </button>
            }
          >
            Comunicados e sondagens
          </Label>
          <div className="space-y-2">
            {sondagem && <Sondagem poll={sondagem} />}
            {data.news.slice(0, 2).map((n) => (
              <Noticia
                key={n.id}
                title={n.title}
                body={n.body}
                publishedAt={n.publishedAt}
                compacta
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cartão                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O cartão de sócio digital.
 *
 * Um cartão a sério: a cor do clube como fundo, o emblema, o nome e o número
 * grandes. O QR só quando o clube o ligou — e o que ele carrega é um token
 * opaco, nunca um dado pessoal (ver `CARD_QR_PREFIX` no servidor).
 *
 * Vive no Início, onde se abre a app à entrada. Não tem ecrã próprio.
 */
function CartaoDoSocio() {
  const { data } = useSocio();
  const [qr, setQr] = useState<string | null>(null);

  const conteudoQr = data?.member.cardQr ?? null;
  useEffect(() => {
    if (!conteudoQr) return;
    QRCode.toDataURL(conteudoQr, {
      margin: 1,
      width: 480,
      color: { dark: "#0b0e11", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [conteudoQr]);

  if (!data || !data.academy.cardEnabled) return null;

  const estado = ESTADO[data.member.status] ?? ESTADO.ACTIVE;
  const desde = new Date(data.member.memberSince);

  return (
    <div className="space-y-3">

      {/*
        A cor do clube pinta o cartão; o texto é branco com sombra de tinta para
        aguentar cores claras. O brilho diagonal é o que o faz parecer um cartão
        e não um rectângulo — imita o reflexo de um cartão físico.
      */}
      <div
        className="relative overflow-hidden rounded-[24px] p-5 text-white"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${data.academy.signalColor} 88%, #000) 0%, ${data.academy.signalColor} 55%, color-mix(in oklab, ${data.academy.signalColor} 72%, #000) 100%)`,
          boxShadow: "var(--shadow-float)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1/2 -right-1/4 aspect-square w-[120%] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,255,255,0.14), transparent 70%)",
          }}
        />

        <div className="flex items-center gap-3">
          <ClubMark
            logoUrl={data.academy.logoUrl}
            mark={marca(data.academy.shortName)}
            size={40}
            radius={12}
          />
          <span className="min-w-0 flex-1 text-[15px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
            {data.academy.name}
          </span>
        </div>

        <div className="mt-7 flex items-center gap-4">
          {/*
            A cara no cartão. Um cartão sem fotografia identifica um número, não
            uma pessoa — quem está na portaria vê um telemóvel com um nome escrito
            e não tem como saber se é de quem o mostra. Sem fotografia, as
            iniciais num círculo translúcido — e um convite a pô-la por baixo.
          */}
          {data.member.photoUrl ? (
            <img
              src={data.member.photoUrl}
              alt=""
              className="size-[72px] shrink-0 rounded-[18px] object-cover shadow-[0_2px_8px_rgba(0,0,0,0.35)] ring-2 ring-white/70"
            />
          ) : (
            <span className="flex size-[72px] shrink-0 items-center justify-center rounded-[18px] bg-white/20 text-[24px] font-semibold ring-2 ring-white/40 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
              {initials(data.member.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold tracking-[0.08em] uppercase opacity-80 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
              Cartão de sócio
            </p>
            <p className="mt-1 truncate text-[22px] leading-tight font-semibold tracking-[-0.02em] [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">
              {data.member.name}
            </p>
            <div className="mt-2 flex items-center gap-2 text-[14px] [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
              <span className="num font-semibold">
                {data.member.number
                  ? `#${data.member.number}`
                  : "Número por atribuir"}
              </span>
              {data.member.tierName && (
                <>
                  <span aria-hidden className="opacity-60">
                    ·
                  </span>
                  <span className="truncate opacity-90">
                    {data.member.tierName}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <span className="text-[12px] opacity-80 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
            Sócio desde {desde.getFullYear()}
          </span>
          <span
            className={cx(
              "chip",
              data.member.status === "ACTIVE"
                ? "bg-white/20 text-white"
                : "bg-black/30 text-white",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "mr-1 inline-block size-2 rounded-full",
                data.member.status === "ACTIVE" ? "bg-white" : "bg-white/50",
              )}
            />
            {estado.label}
          </span>
        </div>
      </div>

      {data.academy.cardQrEnabled && qr && (
        <div className="rounded-[24px] bg-surface p-5 text-center shadow-[var(--shadow-soft)]">
          <img
            src={qr}
            alt="Código QR do cartão de sócio"
            className="mx-auto w-[220px] rounded-[12px]"
          />
          <p className="mx-auto mt-3 max-w-[30ch] text-[13px] leading-relaxed text-ink-3">
            Mostra este código na entrada ou na secretaria para te identificares
            como sócio.
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quotas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O que se paga: a quota que já existe, ou um mês que ainda não tem quota.
 *
 * Duas rotas no servidor, uma folha de pagamento — a folha só quer saber o
 * título, o valor e como se inicia.
 */
type Alvo = {
  titulo: string;
  amountCents: number;
  iniciar: (
    method: "MBWAY" | "MULTIBANCO",
    phone?: string,
  ) => Promise<PagamentoIniciado>;
};

function Quotas() {
  const { data } = useSocio();
  const [aPagar, setAPagar] = useState<Alvo | null>(null);
  /*
   * Até que mês o sócio quer ir. `null` = só o que está em dívida.
   *
   * Guarda-se o **limite** e não um conjunto, porque é assim que a regra
   * funciona: as quotas pagam-se por ordem, e escolher Março quer dizer
   * "Janeiro, Fevereiro e Março". Um conjunto com buracos não existe — nem no
   * ecrã nem no servidor.
   */
  const [ate, setAte] = useState<string | null>(null);
  if (!data) return null;

  const abertas = data.fees.filter((f) => f.status === "OPEN");
  const historico = data.fees.filter((f) => f.status !== "OPEN");
  const emAtraso = abertas.some((f) => f.overdue);
  /*
   * Os meses que ainda não têm quota, até ao fim da época. Os que já têm
   * uma em aberto estão na lista de cima; os pagos e anulados não se voltam
   * a oferecer. Pagar adiantado é uma escolha do sócio, não uma dívida — por
   * isso vem depois do que está mesmo por pagar, e sem cor de alarme.
   */
  const proximos = data.upcoming.filter((m) => m.feeId === null);
  const podePagar =
    data.academy.onlinePayments && data.member.status === "ACTIVE";

  const anual = data.member.tierBilling === "ANNUAL";

  return (
    <div className="space-y-5 pt-3">
      <Label>Quotas</Label>

      {/*
        Numa categoria anual há uma quota por época, e mais nada.

        Dizê-lo aqui evita a pergunta que vinha a seguir — "e os outros meses?" —
        num ecrã que, para toda a gente menos estes sócios, é uma lista de meses.
      */}
      {anual && (
        <p className="px-1 text-[13px] leading-relaxed text-ink-3">
          A tua categoria paga-se uma vez por ano.
          {data.member.tierFeeCents !== null && ` São ${money(data.member.tierFeeCents)} por ano.`}
        </p>
      )}

      {/* O estado, dito numa linha — regularizado, pendente ou em atraso. */}
      <div
        className={cx(
          "rise flex items-center gap-3 rounded-[20px] p-4 shadow-[var(--shadow-soft)]",
          abertas.length === 0
            ? "bg-surface"
            : emAtraso
              ? "bg-risk-soft"
              : "bg-surface",
        )}
      >
        <span
          className={cx(
            "flex size-10 items-center justify-center rounded-full",
            abertas.length === 0
              ? "bg-ok-soft text-ok"
              : emAtraso
                ? "bg-risk text-white"
                : "bg-warn-soft text-warn",
          )}
        >
          {abertas.length === 0 ? (
            <Check className="size-5" strokeWidth={2.2} />
          ) : (
            <Wallet className="size-5" strokeWidth={2} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">
            {abertas.length === 0
              ? "Quotas regularizadas"
              : emAtraso
                ? "Quota em atraso"
                : "Quota pendente"}
          </span>
          {abertas.length > 0 && (
            <span className="block text-[13px] text-ink-2">
              {abertas.length === 1
                ? (abertas[0].label ?? abertas[0].period)
                : `${abertas.length} quotas por pagar`}
            </span>
          )}
        </span>
        {abertas.length > 0 && (
          <Money
            cents={abertas.reduce((n, f) => n + f.amountCents, 0)}
            size="md"
          />
        )}
      </div>

      {abertas.map((f) => (
        <div
          key={f.id}
          className="rise rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink">
                {f.label ?? f.period}
              </span>
              <span
                className={cx(
                  "block text-[13px]",
                  f.overdue ? "font-semibold text-risk" : "text-ink-3",
                )}
              >
                {f.dueOn
                  ? f.overdue
                    ? `venceu a ${dateShort(new Date(f.dueOn))}`
                    : `até ${dateShort(new Date(f.dueOn))}`
                  : "sem prazo"}
              </span>
            </span>
            <Money cents={f.amountCents} size="md" />
          </div>
          {podePagar && (
            <button
              type="button"
              onClick={() =>
                setAPagar({
                  titulo: f.label ?? f.period,
                  amountCents: f.amountCents,
                  iniciar: (m, phone) => pagarQuota(f.id, m, phone),
                })
              }
              className="cta mt-3 w-full"
            >
              <CreditCard className="size-[18px]" strokeWidth={1.9} />
              Pagar quota
            </button>
          )}
        </div>
      ))}

      {proximos.length > 0 && (
        <section>
          <Label>Próximos meses</Label>
          <p className="mb-2 px-1 text-[13px] leading-relaxed text-ink-3">
            Podes pagar adiantado até ao fim da época, em Julho. Escolhe até que
            mês queres ir — os anteriores vão juntos, na mesma referência.
          </p>
          <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
            {proximos.map((m) => (
              <ProximoMes
                key={m.period}
                mes={m}
                podePagar={podePagar}
                escolhido={ate !== null && m.period <= ate}
                onEscolher={() => setAte(ate === m.period ? null : m.period)}
              />
            ))}
          </div>

          {ate !== null && (
            <ResumoAte
              ate={ate}
              abertas={abertas}
              proximos={proximos}
              podePagar={podePagar}
              onPagar={setAPagar}
              onLimpar={() => setAte(null)}
            />
          )}
        </section>
      )}

      {historico.length > 0 && (
        <section>
          <Label>Histórico</Label>
          <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
            {historico.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 border-b border-ink/5 px-4 py-3 last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {f.label ?? f.period}
                  </span>
                  <span className="block text-[12px] text-ink-3">
                    {f.status === "VOID"
                      ? "Anulada"
                      : f.settledAt
                        ? `Paga a ${dateShort(new Date(f.settledAt))}`
                        : "Paga"}
                  </span>
                </span>
                <span className="num text-[14px] font-semibold text-ink">
                  {money(f.amountCents)}
                </span>
                {f.status === "SETTLED" ? (
                  <Chip tone="ok">Paga</Chip>
                ) : (
                  <Chip tone="neutral">Anulada</Chip>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.fees.length === 0 && proximos.length === 0 && (
        <Vazio icon={Wallet} title="Ainda não há quotas">
          Quando o clube lançar a primeira quota, aparece aqui — com o histórico
          a crescer por baixo.
        </Vazio>
      )}

      {aPagar && (
        <PagarSheet
          alvo={aPagar}
          telefone={data.member.phone}
          onClose={() => setAPagar(null)}
        />
      )}
    </div>
  );
}

/**
 * Uma linha de "Próximos meses".
 *
 * Tocar num mês escolhe **até ali** — e por isso os anteriores acendem-se
 * também. Não é um conjunto de caixas independentes de propósito: pagar Março
 * sem Fevereiro não é uma coisa que se possa fazer, e um ecrã que a deixasse
 * escolher estaria a prometer o que o servidor recusa.
 */
function ProximoMes({
  mes,
  podePagar,
  escolhido,
  onEscolher,
}: {
  mes: SocioMes;
  podePagar: boolean;
  escolhido: boolean;
  onEscolher: () => void;
}) {
  const cents = mes.amountCents;
  const podeEscolher = podePagar && cents !== null;

  return (
    <button
      type="button"
      disabled={!podeEscolher}
      onClick={onEscolher}
      aria-pressed={escolhido}
      className={cx(
        "flex w-full items-center gap-3 border-b border-ink/5 px-4 py-3 text-left last:border-0",
        escolhido && "bg-signal-soft",
        !podeEscolher && "cursor-default",
      )}
    >
      {podeEscolher && (
        <span
          className={cx(
            "flex size-5 shrink-0 items-center justify-center rounded-full border",
            escolhido
              ? "border-transparent bg-signal-ink text-white"
              : "border-ink/20",
          )}
          aria-hidden
        >
          {escolhido && <Check className="size-3" strokeWidth={3} />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">
          {mes.label}
        </span>
        {cents === null && (
          <span className="block text-[12px] text-ink-3">
            A tua categoria ainda não tem valor — fala com o clube
          </span>
        )}
      </span>
      {cents !== null && (
        <span className="num text-[14px] font-semibold text-ink">
          {money(cents)}
        </span>
      )}
    </button>
  );
}

/**
 * O que vai ser cobrado, antes de se cobrar.
 *
 * A parte que faz a regra ser justa em vez de surpreendente: quem escolhe Março
 * lê aqui, **antes de pagar**, que vão Janeiro e Fevereiro atrás e quanto é ao
 * todo. A ordem não é uma restrição escondida no servidor; é o que o ecrã diz.
 */
function ResumoAte({
  ate,
  abertas,
  proximos,
  podePagar,
  onPagar,
  onLimpar,
}: {
  ate: string;
  abertas: { period: string; amountCents: number; label?: string | null }[];
  proximos: SocioMes[];
  podePagar: boolean;
  onPagar: (a: Alvo) => void;
  onLimpar: () => void;
}) {
  // Tudo o que fica para trás do limite: o que já está em dívida mais os meses
  // adiantados até ele. É exactamente o que o servidor vai cobrar.
  const emDivida = abertas.filter((f) => f.period <= ate);
  const adiantados = proximos.filter(
    (m) => m.period <= ate && m.amountCents !== null,
  );
  const total =
    emDivida.reduce((n, f) => n + f.amountCents, 0) +
    adiantados.reduce((n, m) => n + (m.amountCents ?? 0), 0);
  const quantos = emDivida.length + adiantados.length;
  const ultimo = adiantados[adiantados.length - 1];

  return (
    <div className="mt-3 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-ink">
          {quantos === 1 ? "1 mês" : `${quantos} meses`} até{" "}
          {ultimo?.label ?? ate}
        </span>
        <Money cents={total} size="md" />
      </div>

      {emDivida.length > 0 && (
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Inclui {emDivida.length === 1 ? "a quota" : "as quotas"} por pagar de{" "}
          {emDivida.map((f) => f.label ?? f.period).join(", ")} — as quotas
          pagam-se por ordem.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onLimpar}
          className="rounded-full bg-sunken px-4 py-2 text-[13px] font-semibold text-ink-2"
        >
          Limpar
        </button>
        {podePagar && (
          <button
            type="button"
            onClick={() =>
              onPagar({
                titulo:
                  quantos === 1
                    ? (ultimo?.label ?? ate)
                    : `${quantos} meses até ${ultimo?.label ?? ate}`,
                amountCents: total,
                iniciar: (m, phone) => pagarAte(ate, m, phone),
              })
            }
            className="cta flex-1"
          >
            <CreditCard className="size-[18px]" strokeWidth={1.9} />
            Pagar {quantos === 1 ? "quota" : `${quantos} meses`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A folha de pagamento — MB Way ou Multibanco, como nas mensalidades da família.
 *
 * O MB Way pede o número e manda o push; o Multibanco devolve entidade e
 * referência para pagar com calma. Nada aqui marca a quota como paga: isso é do
 * webhook, quando o dinheiro entrar de verdade.
 */
function PagarSheet({
  alvo,
  telefone,
  onClose,
}: {
  alvo: Alvo;
  telefone: string | null;
  onClose: () => void;
}) {
  const [metodo, setMetodo] = useState<"MBWAY" | "MULTIBANCO" | null>(null);
  const [phone, setPhone] = useState((telefone ?? "").replace(/^\+\d+\s*/, ""));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<PagamentoIniciado | null>(null);

  async function iniciar(m: "MBWAY" | "MULTIBANCO") {
    if (busy) return;
    if (m === "MBWAY" && phone.replace(/\D/g, "").length < 9) {
      setErro("Escreve o número de telemóvel do MB Way");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      setFeito(await alvo.iniciar(m, m === "MBWAY" ? phone : undefined));
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : "Não foi possível iniciar o pagamento.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-t-[24px] bg-canvas p-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15"
          aria-hidden
        />

        {feito ? (
          <div className="space-y-4 text-center">
            {feito.method === "MBWAY" ? (
              <>
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
                  <Smartphone className="size-6" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-[17px] font-semibold text-ink">
                    Confirma no MB Way
                  </p>
                  <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-relaxed text-ink-3">
                    Enviámos o pedido de {money(alvo.amountCents)} para o teu
                    telemóvel. Tens 5 minutos para aceitar.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="text-[17px] font-semibold text-ink">
                  Referência Multibanco
                </p>
                <div className="space-y-2 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]">
                  <LinhaRef k="Entidade" v={feito.entity ?? "—"} />
                  <LinhaRef
                    k="Referência"
                    v={formatarRef(feito.reference ?? "")}
                  />
                  <LinhaRef k="Valor" v={money(alvo.amountCents)} />
                </div>
                <p className="mx-auto max-w-[32ch] text-[12px] leading-relaxed text-ink-3">
                  Paga no homebanking ou numa caixa. A quota fica regularizada
                  assim que o pagamento chegar.
                </p>
              </>
            )}
            <button
              type="button"
              className="cta w-full"
              onClick={() => {
                void loadSocio();
                onClose();
              }}
            >
              Entendido
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="px-1">
              <p className="text-[17px] font-semibold text-ink">
                {alvo.titulo}
              </p>
              <p className="text-[13px] text-ink-3">
                {money(alvo.amountCents)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMetodo("MBWAY")}
              className={cx(
                "flex w-full items-center gap-3 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]",
                metodo === "MBWAY" && "ring-2 ring-[var(--color-signal)]",
              )}
            >
              <Smartphone className="size-5 text-ink-2" strokeWidth={1.9} />
              <span className="flex-1 text-[15px] font-medium text-ink">
                MB Way
              </span>
            </button>

            {metodo === "MBWAY" && (
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Número de telemóvel"
                className="w-full rounded-[14px] bg-surface px-4 py-3 text-[15px] text-ink shadow-[var(--shadow-soft)] outline-none placeholder:text-ink-4"
              />
            )}

            {/* O Multibanco da euPago só aceita a partir de 1 € (o MB Way desde 0,50 €). */}
            <button
              type="button"
              disabled={alvo.amountCents < 100}
              onClick={() => setMetodo("MULTIBANCO")}
              className={cx(
                "flex w-full items-center gap-3 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)] disabled:opacity-45",
                metodo === "MULTIBANCO" && "ring-2 ring-[var(--color-signal)]",
              )}
            >
              <CreditCard className="size-5 text-ink-2" strokeWidth={1.9} />
              <span className="flex-1 text-[15px] font-medium text-ink">
                Referência Multibanco
                {alvo.amountCents < 100 && (
                  <span className="block text-[12px] font-medium text-ink-3">Só a partir de 1,00 €</span>
                )}
              </span>
            </button>

            {erro && (
              <p className="px-1 text-[13px] font-medium text-risk">{erro}</p>
            )}

            <button
              type="button"
              disabled={!metodo || busy}
              onClick={() => metodo && void iniciar(metodo)}
              className="cta w-full disabled:opacity-40"
            >
              {busy ? "A preparar…" : `Pagar ${money(alvo.amountCents)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LinhaRef({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
        {k}
      </span>
      <span className="num text-[16px] font-semibold text-ink">{v}</span>
    </p>
  );
}

const formatarRef = (r: string) => r.replace(/(\d{3})(?=\d)/g, "$1 ").trim();

/* -------------------------------------------------------------------------- */
/* Clube                                                                       */
/* -------------------------------------------------------------------------- */

/** Todos os jogos do clube, de todos os escalões. O Início só mostra o primeiro. */
function Jogos() {
  const { data } = useSocio();
  if (!data) return null;

  return (
    <div className="space-y-5 pt-3">
      {data.matches.length > 0 ? (
        <JogosDoClube matches={data.matches} />
      ) : (
        <Vazio icon={CalendarDays} title="Sem jogos marcados">
          Quando o clube marcar jogos, aparecem aqui — de todos os escalões,
          dos mais velhos para os mais novos.
        </Vazio>
      )}
    </div>
  );
}

/** Os comunicados da direção e as sondagens; as por responder vêm primeiro. */
function Novidades() {
  const { data } = useSocio();
  if (!data) return null;

  const sondagens = [...data.polls].sort(
    (a, b) => Number(Boolean(a.myOptionId)) - Number(Boolean(b.myOptionId)),
  );

  return (
    <div className="space-y-5 pt-3">
      {sondagens.length > 0 && (
        <section>
          <Label>Sondagens</Label>
          <div className="space-y-3">
            {sondagens.map((p) => (
              <Sondagem key={p.id} poll={p} />
            ))}
          </div>
        </section>
      )}

      <section>
        <Label>Comunicados</Label>
        {data.news.length === 0 ? (
          <Vazio icon={Megaphone} title="Ainda não há comunicados">
            As notícias e os comunicados da direção aparecem aqui.
          </Vazio>
        ) : (
          <div className="space-y-2">
            {data.news.map((n) => (
              <Noticia
                key={n.id}
                title={n.title}
                body={n.body}
                publishedAt={n.publishedAt}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JogoCard({ jogo }: { jogo: SocioMatch }) {
  const { data } = useSocio();
  if (!data) return null;

  const inicio = new Date(jogo.startsAt);
  const casa = jogo.isHome;

  return (
    <div className="rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-center gap-4 py-2 text-center">
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">
          {casa ? data.academy.shortName : jogo.opponent}
        </span>
        <span className="text-[13px] font-semibold text-ink-4">vs</span>
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">
          {casa ? jogo.opponent : data.academy.shortName}
        </span>
      </div>
      <div className="mt-2 space-y-1 border-t border-ink/5 pt-3 text-center">
        <p className="text-[14px] font-semibold text-ink capitalize">
          {whenLabel(inicio, new Date()) === "hoje" ||
          whenLabel(inicio, new Date()) === "amanhã"
            ? whenLabel(inicio, new Date())
            : dayName(inicio)}{" "}
          · {time(inicio)}
        </p>
        <p className="flex items-center justify-center gap-1 text-[13px] text-ink-3">
          <MapPin className="size-3.5" strokeWidth={1.9} />
          {jogo.venue}
          {!casa && " · fora"}
        </p>
        <p className="text-[12px] text-ink-4">
          {jogo.teamName}
          {jogo.competition ? ` · ${jogo.competition}` : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Todos os jogos do clube, por equipa — dos mais velhos para os mais novos.
 *
 * A lista já chega ordenada do servidor (`teamMaxAge` desc, depois a data); o
 * que este componente faz é só desenhar essa ordem com um título por cima de
 * cada equipa, para se ver de onde para onde se está a passar. Agrupar por
 * linhas consecutivas chega: o servidor garante que os jogos da mesma equipa
 * vêm sempre juntos.
 */
function JogosDoClube({ matches }: { matches: SocioMatch[] }) {
  const grupos: { teamName: string; jogos: SocioMatch[] }[] = [];
  for (const jogo of matches) {
    const actual = grupos.at(-1);
    if (actual?.teamName === jogo.teamName) actual.jogos.push(jogo);
    else grupos.push({ teamName: jogo.teamName, jogos: [jogo] });
  }

  return (
    <section>
      <Label>Jogos</Label>
      <div className="space-y-4">
        {grupos.map((grupo) => (
          <div key={grupo.teamName}>
            <p className="mb-2 px-1 text-[12px] font-semibold tracking-[0.05em] text-ink-3 uppercase">
              {grupo.teamName}
            </p>
            <div className="space-y-2">
              {grupo.jogos.map((jogo) => (
                <JogoCard key={jogo.id} jogo={jogo} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Uma sondagem, votável no sítio.
 *
 * Antes do voto: opções tocáveis. Depois: as barras com os resultados e a
 * escolha marcada — votar dá direito a ver como vai. O servidor recusa o
 * segundo voto; aqui simplesmente não há botão para ele.
 */
function Sondagem({ poll }: { poll: SocioPoll }) {
  const [escolha, setEscolha] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [obrigado, setObrigado] = useState(false);

  const votou = Boolean(poll.myOptionId);
  const total = poll.options.reduce((n, o) => n + o.votes, 0);

  async function submeter() {
    if (!escolha || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await votar(poll.id, escolha);
      setObrigado(true);
      await loadSocio();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível votar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-signal-soft text-signal-ink">
          <BarChart3 className="size-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold text-ink">
            {poll.question}
          </p>
          {poll.details && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">
              {poll.details}
            </p>
          )}
        </div>
      </div>

      {votou || obrigado ? (
        <div className="mt-3 space-y-2">
          {poll.options.map((o) => {
            const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
            const minha = o.id === poll.myOptionId || o.id === escolha;
            return (
              <div key={o.id}>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span
                    className={cx(
                      "min-w-0 truncate",
                      minha ? "font-semibold text-ink" : "text-ink-2",
                    )}
                  >
                    {o.label}
                    {minha && (
                      <Check
                        className="mb-0.5 ml-1 inline size-3.5 text-signal-ink"
                        strokeWidth={2.4}
                      />
                    )}
                  </span>
                  <span className="num shrink-0 text-ink-3">{pct}%</span>
                </div>
                <span className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-sunken">
                  <span
                    className={cx(
                      "h-full rounded-full transition-[width] duration-700",
                      minha ? "bg-signal" : "bg-ink/15",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </div>
            );
          })}
          <p className="pt-1 text-[12px] text-ink-4">
            {obrigado ? "Obrigado pela tua participação. · " : ""}
            {total} {total === 1 ? "voto" : "votos"}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {poll.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setEscolha(o.id)}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-[14px] border px-3.5 py-2.5 text-left text-[14px] transition-colors",
                escolha === o.id
                  ? "border-[var(--color-signal)] bg-signal-soft font-semibold text-ink"
                  : "border-ink/10 text-ink-2 active:bg-sunken",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "flex size-4 items-center justify-center rounded-full border",
                  escolha === o.id
                    ? "border-[var(--color-signal)] bg-signal"
                    : "border-ink/25",
                )}
              >
                {escolha === o.id && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </span>
              {o.label}
            </button>
          ))}
          {erro && <p className="text-[13px] font-medium text-risk">{erro}</p>}
          <button
            type="button"
            disabled={!escolha || busy}
            onClick={() => void submeter()}
            className="cta w-full disabled:opacity-40"
          >
            {busy ? "A votar…" : "Votar"}
          </button>
        </div>
      )}
    </div>
  );
}

function Noticia({
  title,
  body,
  publishedAt,
  compacta,
}: {
  title: string;
  body: string;
  publishedAt: string;
  compacta?: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const grande = body.length > 180;

  return (
    <button
      type="button"
      onClick={() => grande && setAberta((v) => !v)}
      className="w-full rounded-[18px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]"
    >
      <p className="text-[15px] leading-snug font-semibold text-ink">{title}</p>
      <p
        className={cx(
          "mt-1 text-[13px] leading-relaxed whitespace-pre-line text-ink-2",
          !aberta && (compacta ? "line-clamp-2" : "line-clamp-4"),
        )}
      >
        {body}
      </p>
      <p className="mt-2 text-[12px] text-ink-4">
        {whenLabel(new Date(publishedAt), new Date())}
      </p>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Perfil                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* A fotografia — a cara no cartão                                             */
/* -------------------------------------------------------------------------- */

/**
 * Escolher, carregar, e a app recarrega-se com a fotografia nova.
 *
 * Um `<input type="file">` escondido atrás de um botão, com `capture` de
 * utilizador para o telemóvel oferecer a câmara frontal — é uma fotografia de
 * cara, e o gesto natural é tirá-la ali. Quem quiser a galeria tem-na no mesmo
 * selector.
 */
function useFotoPicker(onDone?: () => void) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(file: File | undefined) {
    if (!file || busy) return;
    setErro(null);
    setBusy(true);
    try {
      await uploadFotoSocio(file);
      await loadSocio();
      onDone?.();
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar a fotografia.",
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const abrir = () => input.current?.click();
  const campo = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      capture="user"
      onChange={(e) => void escolher(e.target.files?.[0])}
      className="hidden"
    />
  );

  return { abrir, campo, busy, erro };
}

/** Os botões do perfil: pôr ou trocar, e tirar. */
function FotoDoSocio({ temFoto }: { temFoto: boolean }) {
  const { abrir, campo, busy, erro } = useFotoPicker();
  const [aRemover, setARemover] = useState(false);

  async function remover() {
    if (busy || aRemover) return;
    setARemover(true);
    try {
      await removerFotoSocio();
      await loadSocio();
    } finally {
      setARemover(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={abrir}
          disabled={busy}
          className="flex items-center gap-1.5 text-[14px] font-semibold text-signal-ink disabled:opacity-50"
        >
          <Camera className="size-4" strokeWidth={2} />
          {busy
            ? "A carregar…"
            : temFoto
              ? "Trocar fotografia"
              : "Adicionar fotografia"}
        </button>
        {temFoto && (
          <button
            type="button"
            onClick={() => void remover()}
            disabled={aRemover}
            className="text-[14px] font-medium text-ink-3 disabled:opacity-50"
          >
            Remover
          </button>
        )}
      </div>
      {erro && <p className="text-[12px] font-medium text-risk">{erro}</p>}
      {campo}
    </div>
  );
}

/**
 * A sugestão à primeira abertura: "põe a tua fotografia no cartão".
 *
 * Uma vez por sócio, neste telemóvel — dispensada, não volta a aparecer
 * (`localStorage`); o convite permanente fica no perfil e no próprio cartão.
 * Só quando o clube tem o cartão ligado e a ficha não tem fotografia: sugerir
 * uma fotografia para um cartão que não existe era ruído.
 */
function FotoSugestao({ memberId }: { memberId: string }) {
  const chave = `academia.socio.foto-sugerida:${memberId}`;
  const [aberta, setAberta] = useState(() => {
    try {
      return localStorage.getItem(chave) === null;
    } catch {
      return false;
    }
  });
  const fechar = () => {
    try {
      localStorage.setItem(chave, new Date().toISOString());
    } catch {
      /* sem armazenamento, volta a sugerir da próxima vez — não é grave */
    }
    setAberta(false);
  };
  const { abrir, campo, busy, erro } = useFotoPicker(fechar);

  if (!aberta) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40"
      onClick={fechar}
    >
      <div
        className="w-full max-w-[480px] rounded-t-[24px] bg-canvas p-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15"
          aria-hidden
        />
        <div className="space-y-4 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <Camera className="size-7" strokeWidth={1.9} />
          </span>
          <div>
            <p className="text-[19px] font-semibold text-ink">
              Põe a tua fotografia no cartão
            </p>
            <p className="mx-auto mt-1 max-w-[32ch] text-[14px] leading-relaxed text-ink-3">
              O cartão de sócio digital fica completo com a tua cara — é o que a
              portaria vê ao lado do nome.
            </p>
          </div>
          {erro && <p className="text-[13px] font-medium text-risk">{erro}</p>}
          <button
            type="button"
            onClick={abrir}
            disabled={busy}
            className="cta w-full disabled:opacity-50"
          >
            <Camera className="size-[18px]" strokeWidth={1.9} />
            {busy ? "A carregar…" : "Adicionar fotografia"}
          </button>
          <button
            type="button"
            onClick={fechar}
            disabled={busy}
            className="block w-full py-1 text-[14px] font-medium text-ink-3"
          >
            Agora não
          </button>
          {campo}
        </div>
      </div>
    </div>
  );
}

function Perfil() {
  const { data } = useSocio();
  if (!data) return null;

  const estado = ESTADO[data.member.status] ?? ESTADO.ACTIVE;

  const linhas: [string, string | null][] = [
    ["Nome", data.member.name],
    [
      "Número de sócio",
      data.member.number ? `#${data.member.number}` : "Por atribuir",
    ],
    [
      "Categoria",
      data.member.tierName
        ? data.member.tierFeeCents !== null
          ? `${data.member.tierName} · ${money(data.member.tierFeeCents)}${data.member.tierBilling === "ANNUAL" ? "/ano" : "/mês"}`
          : data.member.tierName
        : null,
    ],
    ["Email", data.member.email],
    ["Telemóvel", data.member.phone],
  ];

  return (
    <div className="space-y-5 pt-3">
      <div className="flex flex-col items-center gap-2 pt-2">
        <Avatar
          name={data.member.name}
          photoUrl={data.member.photoUrl ?? undefined}
          size={72}
          ring
        />
        <p className="text-[19px] font-semibold text-ink">{data.member.name}</p>
        <Chip tone={estado.tone}>{estado.label}</Chip>
        <FotoDoSocio temFoto={data.member.photoUrl !== null} />
      </div>

      <AreaSwitch asList />

      <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
        {linhas
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <p
              key={k}
              className="flex items-baseline justify-between gap-4 border-b border-ink/5 px-4 py-3 last:border-0"
            >
              <span className="shrink-0 text-[13px] text-ink-3">{k}</span>
              <span className="min-w-0 truncate text-right text-[14px] font-medium text-ink">
                {v}
              </span>
            </p>
          ))}
      </div>

      {/*
        Os dados oficiais mudam-se com o clube, não num formulário: é o clube que
        responde pelo livro de sócios, e um NIF trocado à distância é um recibo
        errado. A frase é a do pedido, palavra por palavra.
      */}
      <p className="px-2 text-center text-[12px] leading-relaxed text-ink-4">
        Para alterar estes dados, contacta o clube.
      </p>

      <button
        type="button"
        onClick={() => signOut()}
        className="mx-auto block text-[14px] font-semibold text-risk underline-offset-2 active:underline"
      >
        Terminar sessão
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Vazio({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Home;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[20px] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3">
        <Icon className="size-[22px]" strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-relaxed text-ink-3">
        {children}
      </p>
    </div>
  );
}
