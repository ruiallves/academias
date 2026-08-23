import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { academy, sportById } from "@/lib/api";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { Panel, PanelHead, Pill, cx } from "./primitives";
import { addCandidate, listRequests, updateProspect, type ProspectDetail, type ScoutingRequest } from "@/lib/scouting";

/**
 * Editar o dossiê — na própria página, como na ficha do atleta.
 *
 * ## Porque é que não se conseguia editar nada
 *
 * O endpoint existia, mas validava o corpo com o DTO de **criação**, que exige
 * nome, data e modalidade. Um `PATCH` com só o clube actual não passava, e a
 * interface — que nem sequer tinha formulário — não tinha por onde explicar
 * porquê. Corrigiu-se dos dois lados: `ProspectUpdateDto` no servidor, este painel
 * aqui.
 */
export function ProspectEditPanel({
  prospect,
  onDone,
  onCancel,
}: {
  prospect: ProspectDetail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(prospect.name);
  const [birthdate, setBirthdate] = useState(prospect.birthdate.slice(0, 10));
  const [sportId, setSportId] = useState(prospect.sportId);
  const [currentClub, setCurrentClub] = useState(prospect.currentClub ?? "");
  const [currentTeam, setCurrentTeam] = useState(prospect.currentTeam ?? "");
  const [position, setPosition] = useState(prospect.position ?? "");
  const [secondary, setSecondary] = useState(prospect.secondaryPositions.join(", "));
  const [dominantSide, setDominantSide] = useState(sideToApi(prospect.dominantSide));
  const [discoveredVia, setDiscoveredVia] = useState(prospect.discoveredVia ?? "");
  const [notes, setNotes] = useState(prospect.notes ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sport = sportById(sportId);
  const positions = sport?.positions ?? [];
  const valid = name.trim().length >= 2 && birthdate !== "" && sportId !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProspect(prospect.id, {
        name: name.trim(),
        birthdate,
        sportId,
        currentClub: currentClub.trim(),
        currentTeam: currentTeam.trim(),
        position: position.trim(),
        secondaryPositions: secondary
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 4),
        dominantSide,
        discoveredVia: discoveredVia.trim(),
        notes: notes.trim(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5">
        <span className="min-w-0 flex-1 text-body text-ink-2">
          A editar o dossiê de <strong className="font-medium text-ink">{prospect.name}</strong>
        </span>
        {error && <span className="text-meta text-risk">{error}</span>}
        <button type="button" className="ctl-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="ctl-primary" disabled={!valid || busy}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Identidade" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Nome">
              <input value={name} onChange={(e) => setName(e.target.value)} className={dialogInputClass} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Data de nascimento">
                <input
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                  className={dialogInputClass}
                />
              </Field>
              <Field label="Modalidade">
                <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={dialogInputClass}>
                  {academy.sports.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Não se pede NIF: um prospecto não é nosso. Não há mensalidade para
                faturar nem família para ligar à app, e guardar o contribuinte de
                uma criança de outro clube "para o caso de" não se faz. */}
            <p className="text-meta leading-relaxed text-ink-3">
              Sem NIF — um prospecto não é da academia. O número só se pede no momento de recrutar.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Onde joga" />
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Clube actual" hint="opcional">
                <input
                  value={currentClub}
                  onChange={(e) => setCurrentClub(e.target.value)}
                  placeholder="FC Vizela"
                  className={dialogInputClass}
                />
              </Field>
              <Field label="Equipa lá" hint="opcional">
                <input
                  value={currentTeam}
                  onChange={(e) => setCurrentTeam(e.target.value)}
                  placeholder="Sub-13 B"
                  className={dialogInputClass}
                />
              </Field>
            </div>

            {positions.length > 0 && (
              <>
                <Field label="Posição principal" hint="opcional">
                  <select value={position} onChange={(e) => setPosition(e.target.value)} className={dialogInputClass}>
                    <option value="">—</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Outras posições" hint="por vírgulas">
                  <input
                    value={secondary}
                    onChange={(e) => setSecondary(e.target.value)}
                    placeholder="Médio defensivo, Lateral direito"
                    className={dialogInputClass}
                  />
                </Field>
              </>
            )}

            {sport?.dominantSideLabel && (
              <Field label={sport.dominantSideLabel} hint="opcional">
                <select
                  value={dominantSide}
                  onChange={(e) => setDominantSide(e.target.value)}
                  className={dialogInputClass}
                >
                  <option value="">—</option>
                  <option value="RIGHT">Direito</option>
                  <option value="LEFT">Esquerdo</option>
                  <option value="BOTH">Ambidestro</option>
                </select>
              </Field>
            )}
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHead title="Origem e notas" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Como apareceu" hint="opcional">
              <input
                value={discoveredVia}
                onChange={(e) => setDiscoveredVia(e.target.value)}
                placeholder="Torneio de Braga · indicação do treinador dos Sub-11"
                className={dialogInputClass}
              />
            </Field>

            <Field label="Notas" hint="o que não cabe numa observação">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
              />
            </Field>
          </div>
        </Panel>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Propor este prospecto para um pedido.
 *
 * É o que fecha o circuito: o treinador abriu um ticket a dizer que lhe falta um
 * lateral esquerdo, e o scouting responde-lhe com nomes **dentro do ticket** — em
 * vez de um WhatsApp que ninguém volta a encontrar. A partir daqui, o treinador
 * acompanha os candidatos sem ter acesso aos dossiês.
 */
export function ProposeToRequestDialog({
  prospect,
  onClose,
  onDone,
}: {
  prospect: ProspectDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [requests, setRequests] = useState<ScoutingRequest[] | null>(null);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listRequests().then((rows) => {
      // Só os que ainda estão vivos: propor um nome para um pedido resolvido é
      // trabalho que ninguém vai ler.
      const open = rows.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS");
      setRequests(open);
      setPick(open[0]?.id ?? "");
    });
  }, []);

  async function submit() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addCandidate(pick, prospect.id, note.trim() || undefined);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível propor.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = requests?.find((r) => r.id === pick);

  return (
    <Dialog
      title="Propor para um pedido"
      subtitle={prospect.name}
      onClose={onClose}
      width={460}
      labelledBy="propose"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!pick || busy} onClick={() => void submit()}>
            {busy ? "A propor…" : "Propor"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        {requests && requests.length === 0 ? (
          <p className="text-body text-ink-2">
            Não há pedidos abertos. Um pedido nasce de um treinador ou da direção a dizer o que falta ao
            plantel.
          </p>
        ) : (
          <>
            <DialogField label="Pedido">
              <select value={pick} onChange={(e) => setPick(e.target.value)} className={dialogInputClass}>
                {requests?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                    {r.requestedBy ? ` — ${r.requestedBy}` : ""}
                  </option>
                ))}
              </select>
            </DialogField>

            {chosen && (
              <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
                <div className="mb-1 text-group text-ink-3 uppercase">O que pediram</div>
                {chosen.profile && <p className="text-body leading-relaxed text-ink-2">{chosen.profile}</p>}
                {chosen.traits.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {chosen.traits.map((t) => (
                      <li key={t}>
                        <Pill tone="signal">{t}</Pill>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <DialogField label="Porquê este" hint="fica visível para quem pediu">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Esquerdino, confortável a sair a jogar"
                className={dialogInputClass}
              />
            </DialogField>
          </>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function sideToApi(value: string | null): string {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("r") || v.startsWith("dir")) return "RIGHT";
  if (v.startsWith("l") || v.startsWith("esq")) return "LEFT";
  if (v.startsWith("b") || v.startsWith("amb")) return "BOTH";
  return "";
}
