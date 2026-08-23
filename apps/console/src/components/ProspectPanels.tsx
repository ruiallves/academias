import { useEffect, useState } from "react";
import { Bar, Empty, Panel, PanelHead, Pill, cx } from "./primitives";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { listTeams } from "@/lib/api";
import type { Session } from "@/lib/permissions";
import {
  addToShortlist,
  createShortlist,
  getFitDimensions,
  listShortlists,
  recruit,
  setFit,
  type FitDimension,
  type ProspectDetail,
  type ShortlistRow,
} from "@/lib/scouting";

/**
 * "Fit com o clube".
 *
 * ## Porque é que estes números se escrevem à mão
 *
 * Porque são uma **opinião registada**, não um cálculo. Nenhuma fórmula sobre as
 * observações sabe se um central encaixa no modelo de jogo do clube — isso sabe
 * quem treina a equipa. Derivar a percentagem automaticamente dar-lhe-ia uma
 * autoridade que ela não tem, e a plataforma existe para ajudar a decidir, não
 * para fingir precisão científica.
 *
 * O texto ao lado importa tanto quanto as barras: "central confortável em
 * construção curta" explica o número, e o número sozinho não explica nada.
 */
export function FitPanel({
  prospect,
  mayWrite,
  onSaved,
}: {
  prospect: ProspectDetail;
  mayWrite: boolean;
  onSaved: () => void;
}) {
  const [dimensions, setDimensions] = useState<FitDimension[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getFitDimensions(prospect.sportId).then(setDimensions);
  }, [prospect.sportId]);

  // As pontuações vivem no dossiê; carregam-se com ele. Aqui só se lê o que já
  // veio, para não haver um segundo pedido a dizer a mesma coisa.
  const stored = (prospect as ProspectDetail & { fit?: { dimensionId: string; value: number }[] }).fit ?? [];

  useEffect(() => {
    setValues(Object.fromEntries(stored.map((f) => [f.dimensionId, f.value])));
    // Só quando o dossiê muda de identidade.
  }, [prospect.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    try {
      await setFit(
        prospect.id,
        dimensions.map((d) => ({ dimensionId: d.id, value: values[d.id] ?? 0 })),
      );
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (dimensions.length === 0) return null;

  const scored = dimensions.filter((d) => values[d.id] !== undefined);

  return (
    <Panel>
      <PanelHead title="Fit com o clube" hint={scored.length === 0 ? "por preencher" : undefined}>
        {mayWrite &&
          (editing ? (
            <div className="flex gap-1.5">
              <button type="button" className="ctl-ghost" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button type="button" className="ctl-primary" disabled={busy} onClick={() => void save()}>
                {busy ? "A guardar…" : "Guardar"}
              </button>
            </div>
          ) : (
            <button type="button" className="ctl-ghost" onClick={() => setEditing(true)}>
              {scored.length === 0 ? "Avaliar encaixe" : "Editar"}
            </button>
          ))}
      </PanelHead>

      {scored.length === 0 && !editing ? (
        <div className="px-5 py-8">
          <Empty
            title="Encaixe por avaliar"
            detail="Quanto é que este prospecto serve o que o clube precisa — em palavras de quem conhece o plantel."
          />
        </div>
      ) : (
        <ul className="px-5 py-2">
          {dimensions.map((d) => {
            const value = values[d.id];
            return (
              <li key={d.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                <span className="min-w-0 flex-1 truncate text-body text-ink-2">{d.name}</span>

                {editing ? (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={value ?? 0}
                      onChange={(e) => setValues((v) => ({ ...v, [d.id]: Number(e.target.value) }))}
                      className="w-32 shrink-0 accent-[var(--color-signal)]"
                    />
                    <span className="w-10 shrink-0 text-right text-body font-semibold text-ink tabular">
                      {value ?? 0}%
                    </span>
                  </>
                ) : value === undefined ? (
                  <span className="text-meta text-ink-4">sem dados</span>
                ) : (
                  <>
                    <span className="w-28 shrink-0">
                      <Bar value={value / 100} tone={value >= 80 ? "ok" : value >= 50 ? "signal" : "warn"} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-body font-semibold text-ink tabular">{value}%</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Pôr numa shortlist — ou criar uma na mesma janela.
 *
 * Criar a lista noutro sítio e voltar aqui era o caminho que ninguém percorria: a
 * decisão de que "isto merece uma lista nova" acontece a olhar para um prospecto,
 * não numa página de listas vazias.
 */
export function AddToShortlistDialog({
  prospectId,
  onClose,
  onAdded,
}: {
  prospectId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [lists, setLists] = useState<ShortlistRow[]>([]);
  const [pick, setPick] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listShortlists().then((rows) => {
      setLists(rows);
      setPick(rows[0]?.id ?? "");
    });
  }, []);

  const creating = pick === "__new";
  const valid = creating ? newName.trim().length >= 2 : Boolean(pick);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = creating ? (await createShortlist({ name: newName.trim() })).id : pick;
      await addToShortlist(id, prospectId, note.trim() || undefined);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível adicionar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Pôr numa shortlist"
      onClose={onClose}
      width={420}
      labelledBy="add-shortlist"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? "A adicionar…" : "Adicionar"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <DialogField label="Lista">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={dialogInputClass}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.count})
              </option>
            ))}
            <option value="__new">+ Criar lista nova</option>
          </select>
        </DialogField>

        {creating && (
          <DialogField label="Nome da lista">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Sub-13 · Defesa central"
              className={dialogInputClass}
            />
          </DialogField>
        )}

        <DialogField label="Porquê" hint="opcional, mas ajuda daqui a dois meses">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Encaixa no perfil que falta ao Sub-15"
            className={dialogInputClass}
          />
        </DialogField>

        <p className="text-meta leading-relaxed text-ink-3">
          Entrar numa shortlist move o dossiê para <strong className="font-medium text-ink-2">Shortlist</strong> se
          ainda estiver atrás — senão ficaria a aparecer como “a arrefecer” no dia seguinte a ter sido escolhido.
        </p>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Recrutar — a conversão para atleta.
 *
 * ## O que **não** se pede
 *
 * O nome, a data de nascimento, a modalidade, a posição, o lado dominante. Já
 * estão no dossiê, escritos por quem o acompanhou durante meses, e voltar a
 * pedi-los seria perder dados na passagem — e fazer duvidar de para que serviu o
 * scouting.
 *
 * ## O que se pede
 *
 * A equipa, porque um prospecto não tinha escalão nosso. E o **NIF**, porque um
 * atleta sem ele é um atleta que nenhuma família consegue reclamar na app — e um
 * recrutamento é uma inscrição como as outras.
 */
export function RecruitDialog({
  prospect,
  session,
  onClose,
  onRecruited,
}: {
  prospect: ProspectDetail;
  session: Session;
  onClose: () => void;
  onRecruited: (athleteId: string) => void;
}) {
  const teams = listTeams(session).filter((t) => t.sportId === prospect.sportId);

  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [taxId, setTaxId] = useState("");
  const [squadNumber, setSquadNumber] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nifOk = /^\d{9}$/.test(taxId.replace(/\s/g, ""));
  const valid = Boolean(teamId) && nifOk;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recruit(prospect.id, {
        teamId,
        taxId: taxId.replace(/\s/g, ""),
        ...(squadNumber ? { squadNumber: Number(squadNumber) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onRecruited(result.athleteId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível recrutar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Recrutar atleta"
      subtitle={prospect.name}
      onClose={onClose}
      width={480}
      labelledBy="recruit"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? "A inscrever…" : "Recrutar"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        {/* O que já se sabe, à vista. É a prova de que nada se volta a escrever. */}
        <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
          <div className="mb-1.5 text-group text-ink-3 uppercase">Vem do dossiê</div>
          <ul className="flex flex-wrap gap-1.5">
            <Pill>{prospect.name}</Pill>
            <Pill>{new Date(prospect.birthdate).toLocaleDateString("pt-PT")}</Pill>
            {prospect.position && <Pill>{prospect.position}</Pill>}
            {prospect.dominantSide && <Pill>{prospect.dominantSide}</Pill>}
          </ul>
          <p className="mt-2 text-meta leading-relaxed text-ink-3">
            E o histórico de scouting — observações, vídeos e decisões — fica ligado à ficha do atleta.
          </p>
        </div>

        {teams.length === 0 ? (
          <p className="text-meta text-risk">
            Não há equipas desta modalidade no teu âmbito. Cria a equipa primeiro.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Equipa">
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={dialogInputClass}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </DialogField>

            <DialogField label="Camisola" hint="opcional">
              <input
                value={squadNumber}
                onChange={(e) => setSquadNumber(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
        )}

        <DialogField label="NIF" hint="obrigatório">
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            inputMode="numeric"
            placeholder="123456789"
            className={cx(dialogInputClass, !nifOk && taxId !== "" && "border-risk")}
          />
        </DialogField>

        {!nifOk && (
          <p className="text-meta leading-relaxed text-ink-3">
            São nove dígitos. É com o NIF e a data de nascimento que a família se liga a este atleta ao instalar
            a app — sem ele, ninguém o consegue reclamar.
          </p>
        )}

        <DialogField label="Nota" hint="opcional — fica no histórico">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decisão da direção a 22 de agosto"
            className={dialogInputClass}
          />
        </DialogField>
      </div>
    </Dialog>
  );
}
