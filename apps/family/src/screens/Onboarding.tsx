import { useEffect, useRef, useState } from "react";
import { BellRing, CalendarDays, Check, Loader, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { markOnboarded } from "@/lib/onboarding";
import { currentSubscription, enablePush, pushState } from "@/lib/push";
import { cx } from "@/ui";

/**
 * A primeira abertura da app.
 *
 * Um pai que instala isto não vem de uma demonstração comercial: vem de um link
 * que a academia lhe mandou. Se a app abrir directamente no "Hoje", ele vê
 * números sem saber o que a app faz por ele — e, sobretudo, nunca liga as
 * notificações, que são metade do produto.
 *
 * Três ecrãs a dizer o que a app resolve e um quarto a pedir a única permissão
 * que interessa. Pedir a permissão **aqui** e não à chegada ao "Hoje" é
 * deliberado: no meio de uma explicação, com um botão que o pai carrega de
 * propósito, o "Permitir" é uma resposta a uma pergunta que ele entendeu. À
 * queima-roupa é um popup que se despacha com "Bloquear" — e um bloqueio feito
 * nas definições do telemóvel não se desfaz de dentro da app.
 *
 * Salta-se sempre. Uma apresentação que se recusa a sair é uma porta, e o pai
 * pode estar a abrir isto só para pagar uma mensalidade em atraso.
 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const store = useStore();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bloqueado ou sem suporte, não se oferece um botão que não pode funcionar —
  // o perfil explica-o com espaço, aqui só atrapalharia a saída.
  const state = pushState();

  /*
   * Já subscrito? Então não se pede outra vez.
   *
   * A condição era só `state === "granted" || "default"` — a **permissão**. Mas
   * ter permissão não é o mesmo que ter subscrição: a permissão é do domínio e
   * sobrevive a tudo, a subscrição é do registo do service worker. O caso que
   * isto tapa é o inverso: quem já ligou as notificações e vê a app pedir-lhas
   * outra vez, que é dizer-lhe que o que fez não funcionou.
   *
   * `null` enquanto não se sabe — a leitura é assíncrona, e nesse intervalo
   * mostra-se o caminho de saída em vez de piscar um botão que vai desaparecer.
   */
  const [jaSubscrito, setJaSubscrito] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    void currentSubscription()
      .then((sub) => {
        if (vivo) setJaSubscrito(Boolean(sub));
      })
      .catch(() => {
        if (vivo) setJaSubscrito(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const canAskForPush = (state === "default" || state === "granted") && jaSubscrito === false;

  const slides = [
    {
      art: (
        <span className="flex size-[76px] items-center justify-center overflow-hidden rounded-[24px] bg-signal-on">
          {store.academy.logoUrl ? (
            <img src={store.academy.logoUrl} alt="" className="size-full object-contain p-2" />
          ) : (
            <span className="text-[28px] font-bold" style={{ color: "var(--color-signal-strong)" }} aria-hidden>
              {store.academy.mark}
            </span>
          )}
        </span>
      ),
      title: `Bem-vindo à ${store.academy.shortName}`,
      body: `Olá, ${store.guardian.firstName}. Aqui tens tudo o que a academia sabe sobre ${childList(
        store.children.map((c) => c.firstName),
      )} — treinos, jogos e mensalidades — num sítio só.`,
    },
    {
      art: <Glyph icon={CalendarDays} />,
      title: "Nunca mais perguntas a que horas é o treino",
      body: "A agenda vem da academia. Um treino que muda de hora, ou um jogo com convocatória, aparece aqui no momento em que o treinador o marca.",
    },
    {
      art: <Glyph icon={Wallet} />,
      title: "As mensalidades pagas pelo telemóvel",
      body: "Vês o que está por pagar e pagas por MB WAY, cartão ou referência multibanco. Fica registado — sem transferências às escuras nem prints no WhatsApp.",
    },
    {
      art: <Glyph icon={enabled ? Check : BellRing} />,
      title: enabled ? "Está tudo pronto" : "Queres ser avisado?",
      body: enabled
        ? "Avisamos-te quando houver uma convocatória, uma alteração de treino ou uma mensalidade a chegar ao fim do prazo."
        : "Convocatórias, treinos alterados e mensalidades a vencer chegam ao teu telemóvel. Podes desligar quando quiseres, no teu perfil.",
    },
  ];

  const last = index === slides.length - 1;

  function goTo(i: number) {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  function finish() {
    markOnboarded();
    onDone();
  }

  async function askForPush() {
    setBusy(true);
    setError(null);
    try {
      const result = await enablePush();
      if (result.ok) setEnabled(true);
      else setError(result.reason ?? "Não foi possível activar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível activar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brandlit fixed inset-0 z-50 flex flex-col overflow-hidden">
      {/* Anéis decorativos: dão profundidade ao fundo sem uma ilustração que
          tivesse de ser redesenhada para cada academia. */}
      <span aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[420px] rounded-full border border-signal-on/10" />
      <span aria-hidden className="pointer-events-none absolute -top-10 -right-44 size-[420px] rounded-full border border-signal-on/10" />

      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col pt-[calc(14px+env(safe-area-inset-top))]">
        <div className="flex h-11 shrink-0 items-center justify-end px-4">
          {!last && (
            <button type="button" onClick={finish} className="on-2 px-2 py-1 text-[14px] font-semibold active:text-signal-on">
              Saltar
            </button>
          )}
        </div>

        {/*
          Um painel por ecrã, com encaixe: arrasta-se como se espera de uma app, e
          o botão faz exactamente o mesmo movimento para quem não arrasta.
        */}
        <div
          ref={track}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((s, i) => (
            <section
              key={i}
              className="flex w-full shrink-0 snap-center flex-col items-center justify-center px-8 text-center"
            >
              <span className="pop">{s.art}</span>
              <h2 className="mt-8 text-[27px] leading-[1.15] font-semibold tracking-[-0.03em] text-signal-on">{s.title}</h2>
              <p className="on-2 mt-3 max-w-[32ch] text-[15px] leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>

        <div className="shrink-0 px-6 pb-[calc(22px+env(safe-area-inset-bottom))]">
          <div className="mb-5 flex items-center justify-center gap-2" aria-hidden>
            {slides.map((_, i) => (
              <span
                key={i}
                className={cx(
                  "h-1.5 rounded-full bg-signal-on transition-all duration-300 ease-[var(--ease-out)]",
                  i === index ? "w-6 opacity-100" : "w-1.5 opacity-40",
                )}
              />
            ))}
          </div>

          {error && (
            <p className="mb-3 rounded-[var(--radius-sm)] bg-signal-on/15 px-3 py-2 text-center text-meta leading-relaxed text-signal-on">
              {error}
            </p>
          )}

          {!last ? (
            <button type="button" onClick={() => goTo(index + 1)} className="cta-brand w-full">
              Continuar
            </button>
          ) : enabled || !canAskForPush ? (
            <button type="button" onClick={finish} className="cta-brand w-full">
              Começar
            </button>
          ) : (
            <>
              <button type="button" onClick={askForPush} disabled={busy} className="cta-brand w-full">
                {busy ? <Loader className="size-[18px] animate-spin" strokeWidth={2} /> : "Ligar notificações"}
              </button>
              <button
                type="button"
                onClick={finish}
                className="on-2 mt-1 h-12 w-full text-[14px] font-semibold active:text-signal-on"
              >
                Agora não
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Glyph({ icon: Icon }: { icon: typeof BellRing }) {
  return (
    <span className="flex size-[76px] items-center justify-center rounded-[26px] bg-signal-on/18 text-signal-on backdrop-blur-sm">
      <Icon className="size-9" strokeWidth={1.6} />
    </span>
  );
}

/** "o Tomás", "o Tomás e a Inês" — a partir de três nomes, uma lista de vírgulas
 *  lê-se pior do que a forma genérica. */
function childList(names: string[]): string {
  if (names.length === 0) return "os teus educandos";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return "os teus educandos";
}
