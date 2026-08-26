import { useState, type FormEvent } from "react";
import { Panel, PanelHead, Pill } from "@/components/primitives";
import { Plus, Trash2 } from "@/lib/icons";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy, useStore } from "@/lib/store";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import type { Sport } from "@/data/types";

/**
 * As modalidades do clube.
 *
 * ## Isto era uma lista morta
 *
 * Mostrava os desportos com um botão "Editar" que não fazia nada, e não havia
 * forma nenhuma de acrescentar um. Um clube que abrisse com futebol e quisesse
 * juntar futsal não tinha por onde — e um clube novo, que abre sem desportos
 * nenhuns, ficava com um painel vazio e sem saída.
 *
 * ## Porque é que isto está acima dos catálogos
 *
 * Porque é a raiz deles. Os escalões, os balneários, os locais e os tipos de
 * evento podem pertencer a uma modalidade — o "Sub-13" do futebol não é o
 * "Sub-13" da natação, e a piscina não é um campo. Escolher o desporto primeiro
 * e configurar o resto por baixo é a ordem em que a coisa se pensa.
 */
export function SportsPanel({ mayWrite }: { mayWrite: boolean }) {
  const { academy } = useStore();
  const [editing, setEditing] = useState<Sport | null>(null);
  const [creating, setCreating] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function remove(sport: Sport) {
    setErro(null);
    try {
      await apiDelete(`/api/sports/${sport.id}`);
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a modalidade.");
    }
  }

  return (
    <>
      <Panel>
        <PanelHead title="Modalidades" hint="o que o clube pratica">
          {mayWrite && (
            <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" strokeWidth={2} />
              Nova modalidade
            </button>
          )}
        </PanelHead>

        {academy.sports.length === 0 ? (
          <p className="px-5 py-6 text-center text-meta leading-relaxed text-ink-3">
            Ainda não há modalidades.
            <br />
            Cria a primeira — é ela que organiza os escalões, os balneários e as equipas.
          </p>
        ) : (
          <ul className="px-5 py-1.5">
            {academy.sports.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
                <span className="w-32 shrink-0 text-body font-medium text-ink">{s.name}</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {s.positions.length ? (
                    s.positions.map((p) => <Pill key={p}>{p}</Pill>)
                  ) : (
                    // Natação não tem posições — e isso é configuração, não um caso
                    // especial no código.
                    <span className="text-meta text-ink-4">sem posições</span>
                  )}
                </span>
                {mayWrite && (
                  <span className="flex shrink-0 gap-1.5">
                    <button type="button" className="ctl-ghost" onClick={() => setEditing(s)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="ctl-ghost text-ink-3 hover:text-risk"
                      onClick={() => void remove(s)}
                      aria-label={`Apagar ${s.name}`}
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {erro && <p className="border-t border-line px-5 py-3 text-meta text-risk">{erro}</p>}
      </Panel>

      {(creating || editing) && (
        <SportDialog
          sport={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Criar ou editar uma modalidade.
 *
 * As posições e as competências são listas escritas pelo clube, separadas por
 * vírgulas. Um enum aqui obrigaria a uma migração por cada desporto novo que um
 * cliente tivesse — e "Bruços" não cabe numa lista pensada para futebol.
 */
function SportDialog({ sport, onClose }: { sport?: Sport; onClose: () => void }) {
  const [name, setName] = useState(sport?.name ?? "");
  const [positions, setPositions] = useState((sport?.positions ?? []).join(", "));
  const [skills, setSkills] = useState((sport?.skills ?? []).join(", "));
  const [dominantSideLabel, setDominantSideLabel] = useState(sport?.dominantSideLabel ?? "");
  const [matchMinutes, setMatchMinutes] = useState(sport?.matchMinutes ? String(sport.matchMinutes) : "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valid = name.trim().length >= 2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErro(null);

    const body = {
      name: name.trim(),
      positions: split(positions),
      skills: split(skills),
      dominantSideLabel: dominantSideLabel.trim(),
      ...(matchMinutes.trim() ? { matchMinutes: Number(matchMinutes) } : {}),
    };

    try {
      if (sport) await apiPatch(`/api/sports/${sport.id}`, body);
      else await apiPost("/api/sports", body);
      await reloadAcademy();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="modalidade"
      title={sport ? "Editar modalidade" : "Nova modalidade"}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-modalidade" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A gravar…" : sport ? "Gravar" : "Criar"}
          </button>
        </>
      }
    >
      <form id="form-modalidade" onSubmit={submit} className="space-y-4 p-5">
        <DialogField label="Nome">
          <input
            className={dialogInputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Futebol, Natação, Futsal…"
            autoFocus
          />
        </DialogField>

        <DialogField label="Posições" hint="separadas por vírgulas — deixa vazio se não houver">
          <input
            className={dialogInputClass}
            value={positions}
            onChange={(e) => setPositions(e.target.value)}
            placeholder="Guarda-redes, Defesa, Médio, Avançado"
          />
        </DialogField>

        <DialogField label="Competências avaliadas" hint="o que as avaliações medem nesta modalidade">
          <input
            className={dialogInputClass}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="Técnica, Táctica, Físico, Atitude"
          />
        </DialogField>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Lado dominante" hint='"Pé", "Mão"… vazio se não se aplica'>
            <input
              className={dialogInputClass}
              value={dominantSideLabel}
              onChange={(e) => setDominantSideLabel(e.target.value)}
              placeholder="Pé dominante"
            />
          </DialogField>
          <DialogField label="Duração do jogo" hint="minutos">
            <input
              className={dialogInputClass}
              value={matchMinutes}
              onChange={(e) => setMatchMinutes(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="90"
            />
          </DialogField>
        </div>

        {erro && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2.5 text-meta leading-relaxed text-risk">
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const split = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);
