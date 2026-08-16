import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader } from "lucide-react";
import { Card, SectionTitle, cx } from "@/ui";
import { currentSubscription, disablePush, enablePush, pushState, sendTestPush } from "@/lib/push";

/**
 * Notificações.
 *
 * Deliberadamente uma acção do pai e não um pedido automático ao abrir a app: os
 * browsers ignoram pedidos de permissão sem gesto do utilizador, e um pedido à
 * queima-roupa é a forma mais rápida de alguém carregar em "Bloquear" para sempre.
 *
 * O botão de teste existe para o desenvolvimento — dispara uma notificação **a
 * partir do servidor**, não uma local, porque é a única forma de provar que o
 * caminho todo funciona: subscrição, VAPID, service worker, telemóvel.
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
      <section>
        <SectionTitle>Notificações</SectionTitle>
        <Card className="p-4">
          <p className="text-meta leading-relaxed text-ink-3">
            Este telemóvel não suporta notificações nesta app. No iPhone é preciso ter a app
            instalada no ecrã principal — não funciona no Safari em separador.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <SectionTitle>Notificações</SectionTitle>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span
            className={cx(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              subscribed ? "bg-ok-soft text-ok" : "bg-sunken text-ink-3",
            )}
          >
            {subscribed ? <Bell className="size-5" strokeWidth={1.75} /> : <BellOff className="size-5" strokeWidth={1.75} />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-ink">
              {subscribed ? "Notificações ligadas" : "Receber notificações"}
            </p>
            <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
              Mensalidades por pagar, alterações de treino e avisos da academia — no telemóvel,
              sem depender do WhatsApp.
            </p>
          </div>
        </div>

        {state === "denied" && (
          <p className="mt-3 rounded-[11px] bg-warn-soft px-3 py-2 text-meta text-warn">
            As notificações estão bloqueadas nas definições do telemóvel para esta app. É preciso
            reactivá-las lá antes de as poder ligar aqui.
          </p>
        )}

        <button
          type="button"
          onClick={toggle}
          disabled={busy || state === "denied"}
          className={cx("tap mt-4 w-full", subscribed ? "tap-quiet" : "tap-primary")}
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
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-[12px] font-medium text-ink-3">Testar</p>
            <div className="grid gap-2">
              <button type="button" onClick={() => test("payment-overdue")} disabled={busy} className="tap-quiet w-full">
                Mensalidade em falta
              </button>
              <button type="button" onClick={() => test("training-changed")} disabled={busy} className="tap-quiet w-full">
                Treino alterado
              </button>
            </div>
          </div>
        )}

        {message && (
          <p className="mt-3 flex items-center gap-1.5 text-meta text-ink-3">
            <Check className="size-3.5 shrink-0" strokeWidth={2} />
            {message}
          </p>
        )}
      </Card>
    </section>
  );
}
