import { useCallback, useEffect, useState } from "react";
import { Loading, Panel, PanelHead, cx } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Plus, Trash2 } from "@/lib/icons";
import { mostrarOk } from "@/lib/avisos";
import { useStore } from "@/lib/store";
import { useSite } from "@/lib/website";
import { apagarLugarAnual, criarLugarAnual, listarLugaresAnuais, type LugarAnual } from "@/lib/bilheteira";

/**
 * O lugar anual do sócio: a bancada (e o lugar, se for numerado) onde fica
 * em todos os jogos em casa de uma época. Entra com o QR do cartão de sócio,
 * se a quota estiver em dia, e o lugar sai da lotação à venda.
 *
 * Só aparece com o site no plano (é a bilheteira do site que o usa) e a quem
 * vê o site: os recintos e as bancadas vêm de lá. Mexer é `member:write`.
 *
 * Um sócio tem no máximo um lugar por recinto e época, e um lugar marcado só
 * tem um sócio: o servidor recusa o resto e diz porquê.
 */
export function LugarAnualPanel({ memberId, mayWrite }: { memberId: string; mayWrite: boolean }) {
  const store = useStore();
  const site = useSite(store.academy.slug);
  const recintos = site.recintos;
  const epocas = store.seasonList;
  const atual = epocas.find((e) => e.isCurrent) ?? epocas[0];

  const [lugares, setLugares] = useState<LugarAnual[] | null>(null);
  const [aApagar, setAApagar] = useState<LugarAnual | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const [abrir, setAbrir] = useState(false);
  const [seasonId, setSeasonId] = useState(atual?.id ?? "");
  const [venueId, setVenueId] = useState("");
  const [bancadaId, setBancadaId] = useState("");
  const [lugar, setLugar] = useState("");

  const carregar = useCallback(() => {
    listarLugaresAnuais({ memberId })
      .then(setLugares)
      .catch(() => setLugares([]));
  }, [memberId]);
  useEffect(carregar, [carregar]);

  const recinto = recintos.find((r) => r.id === venueId) ?? recintos[0] ?? null;
  const bancadas = recinto?.bancadas ?? [];
  const bancada = bancadas.find((b) => b.id === bancadaId) ?? bancadas[0] ?? null;

  const nomeDoRecinto = (id: string) => recintos.find((r) => r.id === id)?.nome ?? "Recinto apagado";
  const nomeDaBancada = (venue: string, id: string) => recintos.find((r) => r.id === venue)?.bancadas.find((b) => b.id === id)?.nome ?? "Bancada apagada";

  // A época atual primeiro, as outras depois, da mais recente para trás (a ordem do arranque).
  const ordem = new Map(epocas.map((e, i) => [e.id, e.isCurrent ? -1 : i]));
  const ordenados = [...(lugares ?? [])].sort((a, b) => (ordem.get(a.seasonId) ?? 99) - (ordem.get(b.seasonId) ?? 99));

  const atribuir = async () => {
    if (!recinto || !bancada || !seasonId) return;
    setAGravar(true);
    try {
      await criarLugarAnual({ memberId, seasonId, venueId: recinto.id, bancadaId: bancada.id, seat: lugar });
      mostrarOk("Lugar anual atribuído.");
      setLugar("");
      setAbrir(false);
      carregar();
    } catch {
      // A frase do servidor (lugar já ocupado, sócio já com lugar) está no cartão de erros.
    } finally {
      setAGravar(false);
    }
  };

  return (
    <Panel>
      <PanelHead title="Lugar anual">
        {mayWrite && !abrir && recintos.length > 0 && epocas.length > 0 && (
          <button type="button" className="ctl-ghost" onClick={() => setAbrir(true)}>
            <Plus className="size-3.5" strokeWidth={2} />
            Atribuir
          </button>
        )}
      </PanelHead>

      {lugares === null ? (
        <Loading size="panel" />
      ) : ordenados.length === 0 && !abrir ? (
        <p className="px-5 py-3 text-meta leading-relaxed text-ink-3">
          {recintos.length === 0
            ? "Para atribuir lugares anuais, desenha primeiro o estádio no menu Website."
            : "Sem lugar anual. Com ele, o sócio entra em todos os jogos em casa da época com o QR do cartão, e o lugar sai da lotação à venda."}
        </p>
      ) : (
        <ul className="px-5 py-1.5">
          {ordenados.map((l) => (
            <li key={l.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">
                  {nomeDoRecinto(l.venueId)} · {nomeDaBancada(l.venueId, l.bancadaId)}
                  {l.lugar && ` · ${l.lugar}`}
                </span>
                <span className="block text-meta text-ink-3">Época {l.epoca}</span>
              </span>
              {mayWrite && (
                <button type="button" className="ctl-ghost size-8 shrink-0 justify-center px-0 text-risk" aria-label={`Tirar o lugar anual da época ${l.epoca}`} onClick={() => setAApagar(l)}>
                  <Trash2 className="size-3.5" strokeWidth={1.9} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {abrir && recinto && (
        <div className="space-y-3 border-t border-line px-5 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="lugar-epoca" className="mb-1.5 block text-meta font-medium text-ink">
                Época
              </label>
              <select id="lugar-epoca" className={cx(dialogInputClass, "h-8")} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
                {epocas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            {recintos.length > 1 && (
              <div>
                <label htmlFor="lugar-recinto" className="mb-1.5 block text-meta font-medium text-ink">
                  Recinto
                </label>
                <select
                  id="lugar-recinto"
                  className={cx(dialogInputClass, "h-8")}
                  value={recinto.id}
                  onChange={(e) => {
                    setVenueId(e.target.value);
                    setBancadaId("");
                  }}
                >
                  {recintos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="lugar-bancada" className="mb-1.5 block text-meta font-medium text-ink">
                Bancada
              </label>
              <select id="lugar-bancada" className={cx(dialogInputClass, "h-8")} value={bancada?.id ?? ""} disabled={!bancadas.length} onChange={(e) => setBancadaId(e.target.value)}>
                {bancadas.length === 0 && <option value="">Sem bancadas</option>}
                {bancadas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lugar-numero" className="mb-1.5 block text-meta font-medium text-ink">
                Lugar (opcional)
              </label>
              <input id="lugar-numero" className={cx(dialogInputClass, "h-8")} maxLength={40} placeholder="Fila C, 12" value={lugar} onChange={(e) => setLugar(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="ctl-ghost" onClick={() => setAbrir(false)}>
              Cancelar
            </button>
            <button type="button" className="ctl-primary" disabled={aGravar || !bancada || !seasonId} onClick={() => void atribuir()}>
              Atribuir lugar
            </button>
          </div>
        </div>
      )}

      {aApagar && (
        <ConfirmDialog
          title="Tirar o lugar anual?"
          confirmLabel="Tirar"
          onClose={() => setAApagar(null)}
          onConfirm={async () => {
            await apagarLugarAnual(aApagar.id);
            mostrarOk("Lugar anual tirado.");
            setAApagar(null);
            carregar();
          }}
        >
          O lugar de {nomeDaBancada(aApagar.venueId, aApagar.bancadaId)} na época {aApagar.epoca} volta à venda, e o QR do cartão deixa de abrir a porta.
        </ConfirmDialog>
      )}
    </Panel>
  );
}
