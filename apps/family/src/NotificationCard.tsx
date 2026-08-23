import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader, TriangleAlert } from "lucide-react";
import { cx } from "@/ui";
import { currentSubscription, disablePush, enablePush, pushState, sendTestPush } from "@/lib/push";

type Message = { text: string; kind: "ok" | "error" };

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
  const [message, setMessage] = useState<Message | null>(null);
  // Passado um instante sem resposta, sugere olhar para a barra de endereço —
  // ver o comentário em `toggle()` sobre o "quiet UI" do Chrome no Android.
  const [showAddressBarHint, setShowAddressBarHint] = useState(false);

  useEffect(() => {
    void currentSubscription().then((s) => setSubscribed(Boolean(s)));
  }, []);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    /*
     * O Chrome no Android, para sítios que "desconhece" (como um domínio de
     * túnel), por vezes não mostra o pedido de permissão como um popup — só
     * acende um ícone discreto junto à barra de endereço, e a promessa de
     * `Notification.requestPermission()` fica à espera de alguém tocar lá. Do
     * lado da app isto é indistinguível de "ainda a pensar", por isso não se
     * pode tratar como erro (seria prematuro) — mas passados 1,5s sem resposta,
     * vale a pena apontar para onde a pergunta pode estar escondida.
     */
    const hintTimer = setTimeout(() => setShowAddressBarHint(true), 1500);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else {
        const result = await enablePush();
        setState(pushState());
        if (result.ok) setSubscribed(true);
        else setMessage({ text: result.reason ?? "Não foi possível activar.", kind: "error" });
      }
    } catch (error) {
      // Rede de segurança: `enablePush`/`disablePush` já apanham o que sabem
      // apanhar, mas isto garante que nenhuma falha fica muda — sem isto, um
      // erro por apanhar fazia o botão voltar ao normal como se nada tivesse
      // acontecido, e era exactamente essa a queixa a resolver.
      setMessage({ text: error instanceof Error ? error.message : "Falhou por um motivo desconhecido.", kind: "error" });
    } finally {
      clearTimeout(hintTimer);
      setShowAddressBarHint(false);
      setBusy(false);
    }
  }

  async function test(kind: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendTestPush(kind);
      if (!result.ok) setMessage({ text: result.reason ?? "Falhou.", kind: "error" });
      else setMessage({ text: "Enviada. Deve chegar em poucos segundos.", kind: "ok" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Falhou por um motivo desconhecido.", kind: "error" });
    } finally {
      setBusy(false);
    }
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

      {showAddressBarHint && (
        <p className={cx("mt-3 text-meta leading-relaxed", subscribed ? "text-ink-3" : "on-2")}>
          Não vês nenhum pedido? No Android, o Chrome às vezes esconde-o num
          pequeno ícone junto à barra de endereço, em vez de um popup — toca lá.
        </p>
      )}

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
        <p
          className={cx(
            "mt-3 flex items-start gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-meta leading-relaxed",
            message.kind === "error"
              ? "bg-risk-soft text-risk"
              : subscribed
                ? "text-ink-3"
                : "on-1",
          )}
        >
          {message.kind === "error" ? (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
          )}
          {message.text}
        </p>
      )}
    </section>
  );
}
