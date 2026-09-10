import { useEffect, useState } from "react";
import { Loading, Panel, PanelHead, cx } from "@/components/primitives";
import { setMemberCard } from "@/lib/members";

/**
 * O cartão de sócio na app — dois interruptores.
 *
 * ## Porque é que isto vive nas Definições
 *
 * Porque é `settings:write`, como a cor do clube e o nome: uma decisão sobre o
 * que o clube oferece, não sobre um sócio em particular. Estava dentro de um
 * diálogo na página dos sócios, e quem procurasse "onde é que se liga o cartão"
 * ia às Definições — que é onde está tudo o resto que se liga e desliga — e não
 * o encontrava lá.
 *
 * ## O estado inicial vem de um PATCH vazio
 *
 * O endpoint devolve os valores actuais sem mudar nada. Não é elegante, mas
 * evita um GET que só serviria a este painel: dois interruptores não justificam
 * uma rota de leitura própria, e o `academy` do store não os traz.
 */
export function CartaoDeSocioPanel({ mayWrite }: { mayWrite: boolean }) {
  const [estado, setEstado] = useState<{ cardEnabled: boolean; qrEnabled: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setMemberCard({})
      .then(setEstado)
      .catch((e: Error) => setErro(e.message));
  }, []);

  async function alternar(campo: "cardEnabled" | "qrEnabled") {
    if (!estado || !mayWrite) return;
    const novo = { ...estado, [campo]: !estado[campo] };
    setEstado(novo); // optimista: um interruptor que espera pela rede parece avariado
    try {
      setEstado(await setMemberCard({ [campo]: novo[campo] }));
    } catch (e) {
      setEstado(estado);
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    }
  }

  return (
    <Panel>
      <PanelHead title="Cartão de sócio" hint="na app do clube" />

      {erro ? (
        <p className="px-5 py-4 text-meta text-risk">{erro}</p>
      ) : !estado ? (
        <div className="py-8">
          <Loading size="panel" />
        </div>
      ) : (
        <div className="space-y-3 px-5 py-4">
          <Interruptor
            titulo="Cartão de sócio"
            hint="O cartão digital na app: nome, número, categoria e estado."
            ligado={estado.cardEnabled}
            onToggle={() => void alternar("cardEnabled")}
            disabled={!mayWrite}
          />
          <Interruptor
            titulo="QR Code"
            hint="Um código no cartão para identificar o sócio na entrada. Carrega um token opaco — nunca dados pessoais."
            ligado={estado.qrEnabled}
            onToggle={() => void alternar("qrEnabled")}
            disabled={!mayWrite || !estado.cardEnabled}
          />
          {!estado.cardEnabled && (
            <p className="text-meta text-ink-3">Com o cartão desligado, os sócios não veem cartão nenhum na app.</p>
          )}
        </div>
      )}
    </Panel>
  );
}

function Interruptor({
  titulo,
  hint,
  ligado,
  onToggle,
  disabled,
}: {
  titulo: string;
  hint: string;
  ligado: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line p-3.5 text-left disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{titulo}</span>
        <span className="block text-meta leading-relaxed text-ink-3">{hint}</span>
      </span>
      <span
        aria-hidden
        className={cx(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
          ligado ? "bg-signal-strong" : "bg-sunken",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-5 rounded-full bg-surface shadow transition-[left]",
            ligado ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
