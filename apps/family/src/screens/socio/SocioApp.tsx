import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  Home,
  IdCard,
  MapPin,
  Megaphone,
  RefreshCw,
  Smartphone,
  Wallet,
} from "lucide-react";
import { ClubMark } from "@/ClubMark";
import { Avatar, Chip, Label, Money, cx, dateShort, dayName, greeting, money, time, whenLabel } from "@/ui";
import { signOut } from "@/lib/session";
import { loadSocio, pagarQuota, useSocio, votar, type PagamentoIniciado, type SocioFee, type SocioPoll } from "@/lib/socio";
import { AreaSwitch } from "@/screens/socio/AreaSwitch";

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

  if (error && !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-[19px] font-semibold text-ink">Não foi possível carregar</p>
        <p className="max-w-[34ch] text-meta leading-relaxed text-ink-3">{error}</p>
        <button type="button" onClick={() => void loadSocio()} className="cta mt-2">
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
        <span className="size-12 animate-pulse rounded-[16px]" style={{ background: "var(--color-signal)" }} aria-hidden />
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
          <Route path="/socio/cartao" element={<Cartao />} />
          <Route path="/socio/quotas" element={<Quotas />} />
          <Route path="/socio/clube" element={<Clube />} />
          <Route path="/socio/perfil" element={<Perfil />} />
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
  if (!data) return null;

  return (
    <header className="sticky top-0 z-30 bg-canvas/85 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <ClubMark logoUrl={data.academy.logoUrl} mark={marca(data.academy.shortName)} size={36} radius={11} className="shadow-[var(--shadow-soft)]" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[15px] font-semibold text-ink">{data.academy.shortName}</span>
          <span className="block truncate text-[12px] text-ink-3">
            {data.member.number ? `Sócio #${data.member.number}` : "Sócio"}
          </span>
        </span>
        {/* O switcher de contexto vive aqui — pequeno, e só quando há para onde ir. */}
        <AreaSwitch />
        <button
          type="button"
          onClick={() => navigate("/socio/perfil")}
          className="shrink-0 rounded-full active:scale-95"
          aria-label="O meu perfil"
        >
          <Avatar name={data.member.name} size={34} />
        </button>
      </div>
    </header>
  );
}

const TABS = [
  { to: "/socio", label: "Início", icon: Home },
  { to: "/socio/cartao", label: "Cartão", icon: IdCard },
  { to: "/socio/quotas", label: "Quotas", icon: Wallet },
  { to: "/socio/clube", label: "Clube", icon: Megaphone },
];

/** A mesma pílula da família — a app não muda de gramática entre contextos. */
function SocioTabBar() {
  const { data } = useSocio();
  const emDivida = data?.fees.some((f) => f.status === "OPEN") ?? false;

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(14px+env(safe-area-inset-bottom))]">
      <ul className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink/95 p-1.5 backdrop-blur-xl" style={{ boxShadow: "var(--shadow-float)" }}>
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/socio"}
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
                    {to === "/socio/quotas" && emDivida && !isActive && (
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

/** Duas letras para o `ClubMark` quando não há emblema. */
function marca(shortName: string): string {
  const p = shortName.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? p[0]?.[1] ?? "")).toUpperCase();
}

const ESTADO: Record<string, { label: string; tone: "ok" | "warn" | "risk" | "neutral" }> = {
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
 * com outra resposta. Só entra o que é relevante agora: quota por pagar primeiro
 * (é a única coisa accionável), o cartão como identidade, o próximo jogo, as
 * novidades. Secções vazias não aparecem — um ecrã não é um formulário.
 */
function Inicio() {
  const { data } = useSocio();
  const navigate = useNavigate();
  if (!data) return null;

  const agora = new Date();
  const estado = ESTADO[data.member.status] ?? ESTADO.ACTIVE;
  const porPagar = data.fees.filter((f) => f.status === "OPEN");
  const emAtraso = porPagar.some((f) => f.overdue);
  const ultima = data.fees.find((f) => f.status === "SETTLED");
  const sondagem = data.polls.find((p) => !p.myOptionId);
  let i = 0;

  return (
    <div className="space-y-5 pt-3">
      <header className="rise px-1" style={{ ["--i" as string]: i++ }}>
        <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{data.academy.name}</p>
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
              <Money cents={porPagar.reduce((n, f) => n + f.amountCents, 0)} size="md" on />
            </span>
          </span>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
            <ChevronRight className="size-5" strokeWidth={2} />
          </span>
        </button>
      )}

      {/* O cartão — a identidade de sócio, resumida; o cartão a sério tem separador. */}
      {data.academy.cardEnabled && (
        <button
          type="button"
          onClick={() => navigate("/socio/cartao")}
          className="rise w-full rounded-[20px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]"
          style={{ ["--i" as string]: i++ }}
        >
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[12px] bg-signal-soft text-signal-ink">
              <IdCard className="size-[22px]" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-ink">{data.member.name}</span>
              <span className="block text-[13px] text-ink-3">
                {data.member.number ? `Sócio #${data.member.number}` : "Número por atribuir"}
                {data.member.tierName ? ` · ${data.member.tierName}` : ""}
              </span>
            </span>
            <Chip tone={estado.tone}>{estado.label}</Chip>
          </div>
        </button>
      )}

      {/* Quota regularizada — a confirmação discreta de que está tudo bem. */}
      {porPagar.length === 0 && ultima && (
        <div className="rise flex items-center gap-3 rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]" style={{ ["--i" as string]: i++ }}>
          <span className="flex size-10 items-center justify-center rounded-full bg-ok-soft text-ok">
            <Check className="size-5" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Quotas em dia</span>
            <span className="block text-[13px] text-ink-3">
              {ultima.label ?? ultima.period} · {money(ultima.amountCents)}
            </span>
          </span>
        </div>
      )}

      {data.nextMatch && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label>Próximo jogo</Label>
          <ProximoJogo />
        </section>
      )}

      {sondagem && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label>Sondagem</Label>
          <Sondagem poll={sondagem} />
        </section>
      )}

      {data.news.length > 0 && (
        <section className="rise" style={{ ["--i" as string]: i++ }}>
          <Label
            action={
              data.news.length > 2 ? (
                <button type="button" onClick={() => navigate("/socio/clube")} className="text-[13px] font-semibold text-signal-ink">
                  Ver tudo
                </button>
              ) : undefined
            }
          >
            Últimas do clube
          </Label>
          <div className="space-y-2">
            {data.news.slice(0, 2).map((n) => (
              <Noticia key={n.id} title={n.title} body={n.body} publishedAt={n.publishedAt} compacta />
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
 */
function Cartao() {
  const { data } = useSocio();
  const [qr, setQr] = useState<string | null>(null);

  const conteudoQr = data?.member.cardQr ?? null;
  useEffect(() => {
    if (!conteudoQr) return;
    QRCode.toDataURL(conteudoQr, { margin: 1, width: 480, color: { dark: "#0b0e11", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [conteudoQr]);

  if (!data) return null;

  if (!data.academy.cardEnabled) {
    return (
      <div className="pt-3">
        <Vazio icon={IdCard} title="Cartão indisponível">
          {data.academy.shortName} ainda não activou o cartão de sócio digital.
        </Vazio>
      </div>
    );
  }

  const estado = ESTADO[data.member.status] ?? ESTADO.ACTIVE;
  const desde = new Date(data.member.memberSince);

  return (
    <div className="space-y-5 pt-3">
      <Label>O meu cartão</Label>

      {/*
        A cor do clube pinta o cartão; o texto é branco com sombra de tinta para
        aguentar cores claras. O brilho diagonal é o que o faz parecer um cartão
        e não um rectângulo — imita o reflexo de um cartão físico.
      */}
      <div
        className="rise relative overflow-hidden rounded-[24px] p-5 text-white"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${data.academy.signalColor} 88%, #000) 0%, ${data.academy.signalColor} 55%, color-mix(in oklab, ${data.academy.signalColor} 72%, #000) 100%)`,
          boxShadow: "var(--shadow-float)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1/2 -right-1/4 aspect-square w-[120%] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.14), transparent 70%)" }}
        />

        <div className="flex items-center gap-3">
          <ClubMark logoUrl={data.academy.logoUrl} mark={marca(data.academy.shortName)} size={40} radius={12} />
          <span className="min-w-0 flex-1 text-[15px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
            {data.academy.name}
          </span>
        </div>

        <div className="mt-7">
          <p className="text-[12px] font-semibold tracking-[0.08em] uppercase opacity-80 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
            Cartão de sócio
          </p>
          <p className="mt-1 truncate text-[24px] leading-tight font-semibold tracking-[-0.02em] [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">
            {data.member.name}
          </p>
          <div className="mt-2 flex items-center gap-2 text-[14px] [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
            <span className="num font-semibold">{data.member.number ? `#${data.member.number}` : "Número por atribuir"}</span>
            {data.member.tierName && (
              <>
                <span aria-hidden className="opacity-60">·</span>
                <span className="truncate opacity-90">{data.member.tierName}</span>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <span className="text-[12px] opacity-80 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
            Sócio desde {desde.getFullYear()}
          </span>
          <span
            className={cx(
              "chip",
              data.member.status === "ACTIVE" ? "bg-white/20 text-white" : "bg-black/30 text-white",
            )}
          >
            <span
              aria-hidden
              className={cx("mr-1 inline-block size-2 rounded-full", data.member.status === "ACTIVE" ? "bg-white" : "bg-white/50")}
            />
            {estado.label}
          </span>
        </div>
      </div>

      {data.academy.cardQrEnabled && qr && (
        <div className="rise rounded-[24px] bg-surface p-5 text-center shadow-[var(--shadow-soft)]">
          <img src={qr} alt="Código QR do cartão de sócio" className="mx-auto w-[220px] rounded-[12px]" />
          <p className="mx-auto mt-3 max-w-[30ch] text-[13px] leading-relaxed text-ink-3">
            Mostra este código na entrada ou na secretaria para te identificares como sócio.
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quotas                                                                      */
/* -------------------------------------------------------------------------- */


function Quotas() {
  const { data } = useSocio();
  const [aPagar, setAPagar] = useState<SocioFee | null>(null);
  if (!data) return null;

  const abertas = data.fees.filter((f) => f.status === "OPEN");
  const historico = data.fees.filter((f) => f.status !== "OPEN");
  const emAtraso = abertas.some((f) => f.overdue);

  return (
    <div className="space-y-5 pt-3">
      <Label>Quotas</Label>

      {/* O estado, dito numa linha — regularizado, pendente ou em atraso. */}
      <div
        className={cx(
          "rise flex items-center gap-3 rounded-[20px] p-4 shadow-[var(--shadow-soft)]",
          abertas.length === 0 ? "bg-surface" : emAtraso ? "bg-risk-soft" : "bg-surface",
        )}
      >
        <span
          className={cx(
            "flex size-10 items-center justify-center rounded-full",
            abertas.length === 0 ? "bg-ok-soft text-ok" : emAtraso ? "bg-risk text-white" : "bg-warn-soft text-warn",
          )}
        >
          {abertas.length === 0 ? <Check className="size-5" strokeWidth={2.2} /> : <Wallet className="size-5" strokeWidth={2} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">
            {abertas.length === 0 ? "Quotas regularizadas" : emAtraso ? "Quota em atraso" : "Quota pendente"}
          </span>
          {abertas.length > 0 && (
            <span className="block text-[13px] text-ink-2">
              {abertas.length === 1 ? abertas[0].label ?? abertas[0].period : `${abertas.length} quotas por pagar`}
            </span>
          )}
        </span>
        {abertas.length > 0 && <Money cents={abertas.reduce((n, f) => n + f.amountCents, 0)} size="md" />}
      </div>

      {abertas.map((f) => (
        <div key={f.id} className="rise rounded-[20px] bg-surface p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink">{f.label ?? f.period}</span>
              <span className={cx("block text-[13px]", f.overdue ? "font-semibold text-risk" : "text-ink-3")}>
                {f.dueOn ? (f.overdue ? `venceu a ${dateShort(new Date(f.dueOn))}` : `até ${dateShort(new Date(f.dueOn))}`) : "sem prazo"}
              </span>
            </span>
            <Money cents={f.amountCents} size="md" />
          </div>
          {data.academy.onlinePayments && (
            <button type="button" onClick={() => setAPagar(f)} className="cta mt-3 w-full">
              <CreditCard className="size-[18px]" strokeWidth={1.9} />
              Pagar quota
            </button>
          )}
        </div>
      ))}

      {historico.length > 0 && (
        <section>
          <Label>Histórico</Label>
          <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
            {historico.map((f) => (
              <div key={f.id} className="flex items-center gap-3 border-b border-ink/5 px-4 py-3 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{f.label ?? f.period}</span>
                  <span className="block text-[12px] text-ink-3">
                    {f.status === "VOID"
                      ? "Anulada"
                      : f.settledAt
                        ? `Paga a ${dateShort(new Date(f.settledAt))}`
                        : "Paga"}
                  </span>
                </span>
                <span className="num text-[14px] font-semibold text-ink">{money(f.amountCents)}</span>
                {f.status === "SETTLED" ? <Chip tone="ok">Paga</Chip> : <Chip tone="neutral">Anulada</Chip>}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.fees.length === 0 && (
        <Vazio icon={Wallet} title="Ainda não há quotas">
          Quando o clube lançar a primeira quota, aparece aqui — com o histórico a crescer por baixo.
        </Vazio>
      )}

      {aPagar && <PagarSheet fee={aPagar} telefone={data.member.phone} onClose={() => setAPagar(null)} />}
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
function PagarSheet({ fee, telefone, onClose }: { fee: SocioFee; telefone: string | null; onClose: () => void }) {
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
      setFeito(await pagarQuota(fee.id, m, m === "MBWAY" ? phone : undefined));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível iniciar o pagamento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40" onClick={onClose}>
      <div
        className="w-full max-w-[480px] rounded-t-[24px] bg-canvas p-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15" aria-hidden />

        {feito ? (
          <div className="space-y-4 text-center">
            {feito.method === "MBWAY" ? (
              <>
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
                  <Smartphone className="size-6" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-[17px] font-semibold text-ink">Confirma no MB Way</p>
                  <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-relaxed text-ink-3">
                    Enviámos o pedido de {money(fee.amountCents)} para o teu telemóvel. Tens 5 minutos para aceitar.
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="text-[17px] font-semibold text-ink">Referência Multibanco</p>
                <div className="space-y-2 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]">
                  <LinhaRef k="Entidade" v={feito.entity ?? "—"} />
                  <LinhaRef k="Referência" v={formatarRef(feito.reference ?? "")} />
                  <LinhaRef k="Valor" v={money(fee.amountCents)} />
                </div>
                <p className="mx-auto max-w-[32ch] text-[12px] leading-relaxed text-ink-3">
                  Paga no homebanking ou numa caixa. A quota fica regularizada assim que o pagamento chegar.
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
              <p className="text-[17px] font-semibold text-ink">{fee.label ?? fee.period}</p>
              <p className="text-[13px] text-ink-3">{money(fee.amountCents)}</p>
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
              <span className="flex-1 text-[15px] font-medium text-ink">MB Way</span>
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

            <button
              type="button"
              onClick={() => setMetodo("MULTIBANCO")}
              className={cx(
                "flex w-full items-center gap-3 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]",
                metodo === "MULTIBANCO" && "ring-2 ring-[var(--color-signal)]",
              )}
            >
              <CreditCard className="size-5 text-ink-2" strokeWidth={1.9} />
              <span className="flex-1 text-[15px] font-medium text-ink">Referência Multibanco</span>
            </button>

            {erro && <p className="px-1 text-[13px] font-medium text-risk">{erro}</p>}

            <button
              type="button"
              disabled={!metodo || busy}
              onClick={() => metodo && void iniciar(metodo)}
              className="cta w-full disabled:opacity-40"
            >
              {busy ? "A preparar…" : `Pagar ${money(fee.amountCents)}`}
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
      <span className="text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{k}</span>
      <span className="num text-[16px] font-semibold text-ink">{v}</span>
    </p>
  );
}

const formatarRef = (r: string) => r.replace(/(\d{3})(?=\d)/g, "$1 ").trim();

/* -------------------------------------------------------------------------- */
/* Clube                                                                       */
/* -------------------------------------------------------------------------- */

function Clube() {
  const { data } = useSocio();
  if (!data) return null;

  const abertas = data.polls;

  return (
    <div className="space-y-5 pt-3">
      {data.nextMatch ? (
        <section>
          <Label>Próximo jogo</Label>
          <ProximoJogo />
        </section>
      ) : (
        <Vazio icon={CalendarDays} title="Sem jogos marcados">
          Quando o clube marcar o próximo jogo, aparece aqui — com a hora e o campo.
        </Vazio>
      )}

      {abertas.length > 0 && (
        <section>
          <Label>Sondagens</Label>
          <div className="space-y-3">
            {abertas.map((p) => (
              <Sondagem key={p.id} poll={p} />
            ))}
          </div>
        </section>
      )}

      <section>
        <Label>Notícias e comunicados</Label>
        {data.news.length === 0 ? (
          <Vazio icon={Megaphone} title="Ainda não há novidades">
            As notícias e os comunicados da direção aparecem aqui.
          </Vazio>
        ) : (
          <div className="space-y-2">
            {data.news.map((n) => (
              <Noticia key={n.id} title={n.title} body={n.body} publishedAt={n.publishedAt} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProximoJogo() {
  const { data } = useSocio();
  const jogo = data?.nextMatch;
  if (!data || !jogo) return null;

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
          {whenLabel(inicio, new Date()) === "hoje" || whenLabel(inicio, new Date()) === "amanhã"
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
          <p className="text-[15px] leading-snug font-semibold text-ink">{poll.question}</p>
          {poll.details && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{poll.details}</p>}
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
                  <span className={cx("min-w-0 truncate", minha ? "font-semibold text-ink" : "text-ink-2")}>
                    {o.label}
                    {minha && <Check className="mb-0.5 ml-1 inline size-3.5 text-signal-ink" strokeWidth={2.4} />}
                  </span>
                  <span className="num shrink-0 text-ink-3">{pct}%</span>
                </div>
                <span className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-sunken">
                  <span
                    className={cx("h-full rounded-full transition-[width] duration-700", minha ? "bg-signal" : "bg-ink/15")}
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
                  escolha === o.id ? "border-[var(--color-signal)] bg-signal" : "border-ink/25",
                )}
              >
                {escolha === o.id && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              {o.label}
            </button>
          ))}
          {erro && <p className="text-[13px] font-medium text-risk">{erro}</p>}
          <button type="button" disabled={!escolha || busy} onClick={() => void submeter()} className="cta w-full disabled:opacity-40">
            {busy ? "A votar…" : "Votar"}
          </button>
        </div>
      )}
    </div>
  );
}

function Noticia({ title, body, publishedAt, compacta }: { title: string; body: string; publishedAt: string; compacta?: boolean }) {
  const [aberta, setAberta] = useState(false);
  const grande = body.length > 180;

  return (
    <button
      type="button"
      onClick={() => grande && setAberta((v) => !v)}
      className="w-full rounded-[18px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]"
    >
      <p className="text-[15px] leading-snug font-semibold text-ink">{title}</p>
      <p className={cx("mt-1 text-[13px] leading-relaxed whitespace-pre-line text-ink-2", !aberta && (compacta ? "line-clamp-2" : "line-clamp-4"))}>
        {body}
      </p>
      <p className="mt-2 text-[12px] text-ink-4">{whenLabel(new Date(publishedAt), new Date())}</p>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Perfil                                                                      */
/* -------------------------------------------------------------------------- */

function Perfil() {
  const { data } = useSocio();
  if (!data) return null;

  const estado = ESTADO[data.member.status] ?? ESTADO.ACTIVE;

  const linhas: [string, string | null][] = [
    ["Nome", data.member.name],
    ["Número de sócio", data.member.number ? `#${data.member.number}` : "Por atribuir"],
    ["Categoria", data.member.tierName],
    ["Email", data.member.email],
    ["Telemóvel", data.member.phone],
  ];

  return (
    <div className="space-y-5 pt-3">
      <div className="flex flex-col items-center gap-2 pt-2">
        <Avatar name={data.member.name} size={72} ring />
        <p className="text-[19px] font-semibold text-ink">{data.member.name}</p>
        <Chip tone={estado.tone}>{estado.label}</Chip>
      </div>

      <AreaSwitch asList />

      <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
        {linhas
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <p key={k} className="flex items-baseline justify-between gap-4 border-b border-ink/5 px-4 py-3 last:border-0">
              <span className="shrink-0 text-[13px] text-ink-3">{k}</span>
              <span className="min-w-0 truncate text-right text-[14px] font-medium text-ink">{v}</span>
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

function Vazio({ icon: Icon, title, children }: { icon: typeof Home; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-surface p-6 text-center shadow-[var(--shadow-soft)]">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-sunken text-ink-3">
        <Icon className="size-[22px]" strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[32ch] text-[13px] leading-relaxed text-ink-3">{children}</p>
    </div>
  );
}
