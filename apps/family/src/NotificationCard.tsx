import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader } from "lucide-react";
import { cx } from "@/ui";
import { currentSubscription, disablePush, enablePush, pushState, sendTestPush } from "@/lib/push";

/**
 * Ligar as notificações no telemóvel.
 *
 * Deliberadamente uma acção do pai e não um pedido automático ao abrir a app: os
 * browsers ignoram pedidos de permissão sem gesto do utilizador, e um pedido à
 * queima-roupa é a forma mais rápida de alguém carregar em "Bloquear" para sempre.
 *
 * O botão de teste dispara uma notificação **a partir do servidor** — a única forma
 * de provar que o caminho todo funciona: subscrição, VAPID, service worker, telemóvel.
 */
export function NotificationCard() {
  const [state, setState] = useState(pushState());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void currentSubscription().then((s) => setSubscribed(Boolean(s)));
  }, []);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else {
        const result = await enablePush();
        setState(pushState());
        if (result.ok) setSubscribed(true);
        else setMessage(result.reason ?? "Não foi possível activar.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function test(kind: string) {
    setBusy(true);
    setMessage(null);
    const result = await sendTestPush(kind);
    if (!result.ok) setMessage(result.reason ?? "Falhou.");
    else setMessage("Enviada. Deve chegar em poucos segundos.");
    setBusy(false);
  }

  if (state === "unsupported") {
    return (
      <section className="rounded-[var(--radius-lg)] bg-surface p-4 shadow-[var(--shadow-soft)]">
        <p className="text-meta leading-relaxed text-ink-3">
          Este telemóvel não suporta notificações nesta app. No iPhone é preciso ter a app instalada
          no ecrã principal — não funciona no Safari em separador.
        </p>
      </section>
    );
  }

  return (
    <section
      className={cx(
        "overflow-hidden rounded-[var(--radius-xl)] p-5",
        subscribed ? "bg-surface shadow-[var(--shadow-soft)]" : "brandlit",
      )}
      style={!subscribed ? { boxShadow: "var(--shadow-float)" } : undefined}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cx(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            subscribed ? "bg-ok-soft text-ok" : "bg-white/20 text-white",
          )}
        >
          {subscribed ? <Bell className="size-5" strokeWidth={1.9} /> : <BellOff className="size-5" strokeWidth={1.9} />}
        </span>

        <div className="min-w-0 flex-1">
          <p className={cx("text-body font-semibold", subscribed ? "text-ink" : "text-white")}>
            {subscribed ? "Notificações ligadas" : "Receber notificações"}
          </p>
          <p className={cx("mt-0.5 text-meta leading-relaxed", subscribed ? "text-ink-3" : "on-2")}>
            Mensalidades por pagar, alterações de treino e avisos — no telemóvel, sem depender do
            WhatsApp.
          </p>
        </div>
      </div>

      {state === "denied" && (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-warn-soft px-3 py-2 text-meta text-warn">
          As notificações estão bloqueadas nas definições do telemóvel para esta app. É preciso
          reactivá-las lá antes de as poder ligar aqui.
        </p>
      )}

      <button
        type="button"
        onClick={toggle}
        disabled={busy || state === "denied"}
        className={cx("mt-4 w-full", subscribed ? "cta-quiet" : "cta-brand")}
      >
        {busy ? (
          <Loader className="size-[18px] animate-spin" strokeWidth={2} />
        ) : subscribed ? (
          "Desligar notificações"
        ) : (
          "Ligar notificações"
        )}
      </button>

      {subscribed && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2.5 text-[12px] font-semibold tracking-[0.03em] text-ink-3 uppercase">Testar</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => test("payment-overdue")} disabled={busy} className="cta-quiet h-11 text-[13px]">
              Mensalidade
            </button>
            <button type="button" onClick={() => test("training-changed")} disabled={busy} className="cta-quiet h-11 text-[13px]">
              Treino alterado
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={cx("mt-3 flex items-center gap-1.5 text-meta", subscribed ? "text-ink-3" : "on-1")}>
          <Check className="size-3.5 shrink-0" strokeWidth={2} />
          {message}
        </p>
      )}
    </section>
  );
}
