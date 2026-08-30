import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { apiPost } from "@/lib/http";
import type { CalendarFeed } from "@/lib/types";

/**
 * Ligar os seguimentos ao Google Calendar.
 *
 * ## O que isto faz, dito sem magia
 *
 * Dá um endereço. O Google subscreve-o e passa a mostrar, no calendário de quem
 * subscreveu, cada contacto com data de próximo passo marcada. Muda-se a data
 * aqui, muda lá — sem ninguém fazer nada, e sem nada instalado.
 *
 * ## O que se diz a quem lê
 *
 * Duas coisas, e as duas estão no ecrã porque as duas mordem se ficarem por dizer:
 *
 * 1. **O link é a chave.** Não há sessão numa subscrição de calendário — quem
 *    tiver o endereço vê os seguimentos. Por isso há um botão para o trocar.
 * 2. **O Google actualiza quando quer**, tipicamente de poucas em poucas horas.
 *    Para uma reunião marcada para amanhã, o botão "Agendar no Google" na lista
 *    cria o evento na hora.
 */
export function CalendarDialog({ onClose }: { onClose: () => void }) {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // `POST` e não `GET`: a primeira chamada cria o segredo. Ver o controlador.
  useEffect(() => {
    apiPost<CalendarFeed>("/contactos/agenda", {})
      .then(setFeed)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Não foi possível gerar o endereço."));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function rotate() {
    if (!confirm("Trocar o endereço? O calendário de quem já o subscreveu deixa de actualizar e tem de ser subscrito outra vez.")) return;
    setBusy(true);
    try {
      setFeed(await apiPost<CalendarFeed>("/contactos/agenda", { rotate: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível trocar.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão da área de transferência: o endereço está à vista */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-[520px] rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-panel text-ink">Seguimentos no Google Calendar</h2>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <p className="text-body leading-relaxed text-ink-2">
            Subscreve este endereço no Google Calendar e cada contacto com data de próximo passo aparece lá,
            com o número e o que ficou combinado. Muda a data aqui e o evento muda sozinho.
          </p>

          {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

          {feed && (
            <>
              <div className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
                <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{feed.url}</code>
                <div className="mt-2.5 flex gap-1.5">
                  <button type="button" onClick={copy} className="ctl-outline flex-1 justify-center">
                    {copied ? <><Check className="size-3.5" strokeWidth={2} /> Copiado</> : <><Copy className="size-3.5" strokeWidth={1.75} /> Copiar endereço</>}
                  </button>
                  <a href={feed.googleAddUrl} target="_blank" rel="noreferrer" className="ctl-outline flex-1 justify-center">
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                    Abrir o Google
                  </a>
                </div>
              </div>

              <ol className="space-y-1.5 text-meta leading-relaxed text-ink-3">
                <li>1. No Google Calendar: <strong className="font-medium text-ink-2">Outros calendários → + → A partir do URL</strong>.</li>
                <li>2. Colar o endereço e adicionar. Aparece como um calendário à parte, que se pode desligar.</li>
                <li>3. O Google actualiza de poucas em poucas horas — para marcar algo já, usa <strong className="font-medium text-ink-2">Agendar no Google</strong> na lista.</li>
              </ol>

              {!feed.reachable && (
                <p className="rounded-[var(--radius-control)] bg-[#fdf1dd] px-3 py-2 text-meta leading-relaxed text-[#8a5a12]">
                  Este endereço é local — o Google não lhe chega a partir da internet. Em desenvolvimento serve para
                  testar o feed no browser; para subscrever a sério, a API tem de estar publicada (<code className="font-mono">PUBLIC_API_URL</code>).
                </p>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
                <p className="text-[11px] leading-relaxed text-ink-4">
                  Quem tiver este endereço vê os seguimentos marcados. Não há sessão numa subscrição de calendário —
                  se ele for parar ao sítio errado, troca-o.
                </p>
                <button type="button" onClick={rotate} disabled={busy} className="ctl-ghost shrink-0">
                  <RefreshCw className="size-3.5" strokeWidth={1.75} />
                  {busy ? "A trocar…" : "Trocar"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
