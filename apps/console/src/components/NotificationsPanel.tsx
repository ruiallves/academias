import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "@/lib/icons";
import { loadNotifications, markRead, useNotifications } from "@/lib/notifications";
import { cx } from "./primitives";
import { Spinner } from "@/components/Busy";

/**
 * O painel do sino.
 *
 * ## O que abre, e onde
 *
 * Um painel ancorado ao botão, não uma página. Uma notificação lê-se de
 * passagem — "o Rui aceitou o convite", "falhou um pagamento" — e mandar alguém
 * para outro ecrã só para a ler faz perder o sítio onde estava.
 *
 * ## Marcar como lidas ao abrir
 *
 * Abrir o painel **é** ler. Um botão "marcar todas como lidas" a seguir a já se
 * ter lido tudo é cerimónia, e o ponto vermelho que fica aceso depois de se ter
 * olhado para a lista ensina a ignorá-lo.
 */
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { items, loaded } = useNotifications();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora e com Escape — o par que qualquer painel ancorado
  // precisa para não ficar preso no ecrã.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Abrir é ler. Só as que estavam por ler, e uma vez.
  useEffect(() => {
    const porLer = items.filter((n) => !n.readAt).map((n) => n.id);
    if (porLer.length > 0) void markRead(porLer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Notificações"
      /*
        Abre para a **direita**, e não para a esquerda.

        Era `right-0`, e isso alinhava o lado direito do painel com o lado direito
        do sino: 320px de painel a crescer para a esquerda, a partir de um sino que
        está a ~200px da borda do ecrã. O painel saía pela esquerda fora e ficava
        meio invisível.

        `left-0` faz o painel crescer para dentro do conteúdo, que é onde há
        espaço. Vale nos dois estados do menu — encolhido, o sino está ainda mais
        à esquerda, e continua a haver ecrã à direita.
      */
      className="absolute top-full left-0 z-50 mt-1.5 w-[320px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
    >
      <div className="border-b border-line px-4 py-2.5">
        <span className="text-body font-medium text-ink">Notificações</span>
      </div>

      {!loaded ? (
        <Spinner className="py-6" />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Bell className="size-5 text-ink-4" strokeWidth={1.5} />
          <span className="text-meta text-ink-3">Nada por agora.</span>
          <span className="max-w-[34ch] text-[11px] leading-relaxed text-ink-4">
            Convites aceites, pagamentos e avisos da academia aparecem aqui.
          </span>
        </div>
      ) : (
        /* `60vh` para a lista não passar do fundo num portátil de 768px. */
        <ul className="max-h-[min(60vh,380px)] overflow-y-auto">
          {items.slice(0, 30).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                disabled={!n.link}
                onClick={() => {
                  if (n.link) navigate(n.link);
                  onClose();
                }}
                className={cx(
                  "flex w-full flex-col items-start gap-0.5 border-b border-line px-4 py-2.5 text-left last:border-b-0",
                  n.link ? "hover:bg-sunken" : "cursor-default",
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="text-body font-medium text-ink">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-4">{quando(n.createdAt)}</span>
                </span>
                {n.body && <span className="text-meta leading-relaxed text-ink-2">{n.body}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Carrega as notificações uma vez, no arranque da consola. */
export function useNotificationsBoot(ready: boolean): void {
  useEffect(() => {
    if (ready) void loadNotifications();
  }, [ready]);
}

/** "agora", "há 3 h", "12/03" — o suficiente para situar sem ocupar espaço. */
function quando(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `há ${dias} d`;
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
}
