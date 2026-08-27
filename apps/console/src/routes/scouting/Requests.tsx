import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, Pill, cx, type Tone } from "@/components/primitives";
import { Plus, Send } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { academy } from "@/lib/api";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import {
  REQ_STATUS_LABEL,
  URGENCY_LABEL,
  createRequest,
  listRequests,
  updateRequest,
  type ReqStatus,
  type ScoutingRequest,
  type Urgency,
} from "@/lib/scouting";

/**
 * Pedidos de scouting.
 *
 * ## Porque é que isto existe
 *
 * É o que separa um departamento de scouting de uma colecção de nomes. Sem
 * pedidos, um scout observa quem lhe aparece à frente e o clube recebe uma lista
 * de miúdos bons que não resolvem nenhum problema concreto. Com pedidos, o
 * treinador diz "falta-me um lateral esquerdo no Sub-15 até janeiro" e o trabalho
 * passa a ter destinatário.
 *
 * ## Quem pode pedir, e o que vê
 *
 * `scouting:request` — a permissão do treinador, separada de `scouting:read`. Ele
 * diz o que lhe falta e acompanha os nomes que o scouting for pondo no ticket dele,
 * sem nunca ganhar acesso aos dossiês de miúdos de outros clubes. Quem tem
 * `scouting:read` (o departamento, a direção) vê a fila toda; quem só tem
 * `scouting:request` vê os pedidos que fez — e é o servidor que filtra, não isto.
 */
export default function Requests() {
  const { session } = useSession();
  const [rows, setRows] = useState<ScoutingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<ReqStatus | null>(null);

  const load = useCallback(() => {
    listRequests(filter ?? undefined)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar."));
  }, [filter]);

  useEffect(load, [load]);

  const mayWrite = can(session, "scouting:write");
  /*
   * Quem só pode pedir vê **os pedidos que fez** — o servidor é que filtra, aqui
   * só se muda a linguagem para o dizer. E os nomes propostos aparecem-lhe como
   * texto, não como links: ele acompanha os candidatos do seu ticket sem ganhar
   * acesso aos dossiês, que é exactamente a troca que `scouting:request` existe
   * para fazer.
   */
  const seesAll = can(session, "scouting:read");
  const open = rows?.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS").length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Scouting"
        title={seesAll ? "Pedidos" : "Os meus pedidos"}
        subtitle={
          rows
            ? seesAll
              ? `${open} por resolver`
              : `${open} por resolver · o scouting responde aqui com nomes`
            : undefined
        }
      >
        <button type="button" className="ctl-primary" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" strokeWidth={2} />
          Novo pedido
        </button>
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip active={filter === null} onClick={() => setFilter(null)}>
          Todos
        </Chip>
        {(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {REQ_STATUS_LABEL[s]}
          </Chip>
        ))}
      </div>

      {error && (
        <Panel>
          <div className="px-5 py-10">
            <Empty title="Não foi possível carregar" detail={error} />
          </div>
        </Panel>
      )}

      {!rows && !error && (
        <Panel>
          <Loading />
        </Panel>
      )}

      {rows && rows.length === 0 && (
        <Panel>
          <div>
            <Empty
              icon={Send}
              title="Sem pedidos"
              detail="Um pedido dá destinatário ao trabalho: “falta-me um lateral esquerdo no Sub-15 até janeiro”."
            />
          </div>
        </Panel>
      )}

      <div className="space-y-3">
        {rows?.map((r) => (
          <Panel key={r.id}>
            <PanelHead
              title={r.title}
              hint={[r.ageGroup, r.position].filter(Boolean).join(" · ") || undefined}
            >
              <Pill tone={URGENCY_TONE[r.urgency]}>{URGENCY_LABEL[r.urgency]}</Pill>
              <Pill tone={STATUS_TONE[r.status]}>{REQ_STATUS_LABEL[r.status]}</Pill>
            </PanelHead>

            <div className="space-y-3 px-5 py-4">
              {r.profile && <p className="text-body leading-relaxed text-ink-2">{r.profile}</p>}

              {r.traits.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {r.traits.map((t) => (
                    <li key={t}>
                      <Pill tone="signal">{t}</Pill>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-3">
                <span>Pedido por {r.requestedBy ?? "—"}</span>
                {r.assignedTo && <span>· Responsável: {r.assignedTo}</span>}
                {r.dueDate && <span>· Prazo {new Date(r.dueDate).toLocaleDateString("pt-PT")}</span>}
              </div>

              {/* Os nomes propostos em resposta. É aqui que se vê se o pedido
                  está a ser trabalhado ou só registado. */}
              <div className="border-t border-line pt-3">
                <div className="mb-2 text-group text-ink-3 uppercase">
                  {r.candidates.length === 0
                    ? "Ainda sem nomes propostos"
                    : `${r.candidates.length} ${r.candidates.length === 1 ? "nome proposto" : "nomes propostos"}`}
                </div>
                {r.candidates.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {r.candidates.map((c) => {
                      const body = (
                        <>
                          {c.prospect.name}
                          {c.prospect.position && <span className="text-ink-4"> · {c.prospect.position}</span>}
                          {c.note && <span className="text-ink-4"> · {c.note}</span>}
                        </>
                      );
                      const cls =
                        "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-meta text-ink-2";
                      return (
                        <li key={c.id}>
                          {seesAll ? (
                            <Link to={`/scouting/prospects/${c.prospect.id}`} className={cx(cls, "hover:border-line-strong")}>
                              {body}
                            </Link>
                          ) : (
                            <span className={cls}>{body}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-2 text-meta text-ink-4">
                  {seesAll
                    ? "Propõem-se nomes a partir da ficha de cada prospecto."
                    : "O departamento de scouting acrescenta aqui os nomes que encontrar."}
                </p>
              </div>

              {mayWrite && r.status !== "FULFILLED" && r.status !== "CANCELLED" && (
                <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
                  <button
                    type="button"
                    className="ctl-ghost"
                    onClick={() => void updateRequest(r.id, { status: "FULFILLED" }).then(load)}
                  >
                    Marcar resolvido
                  </button>
                  <button
                    type="button"
                    className="ctl-ghost"
                    onClick={() => void updateRequest(r.id, { status: "CANCELLED" }).then(load)}
                  >
                    Cancelar pedido
                  </button>
                </div>
              )}
            </div>
          </Panel>
        ))}
      </div>

      {creating && (
        <NewRequestDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const URGENCY_TONE: Record<Urgency, Tone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warn",
  CRITICAL: "risk",
};

const STATUS_TONE: Record<ReqStatus, Tone> = {
  OPEN: "signal",
  IN_PROGRESS: "signal",
  FULFILLED: "ok",
  CANCELLED: "neutral",
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
        active ? "border-transparent bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

function NewRequestDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [sportId, setSportId] = useState(academy.sports[0]?.id ?? "");
  const [ageGroup, setAgeGroup] = useState("");
  const [position, setPosition] = useState("");
  const [profile, setProfile] = useState("");
  const [traits, setTraits] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("NORMAL");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = title.trim().length >= 3;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createRequest({
        title: title.trim(),
        ...(sportId ? { sportId } : {}),
        ...(ageGroup.trim() ? { ageGroup: ageGroup.trim() } : {}),
        ...(position.trim() ? { position: position.trim() } : {}),
        ...(profile.trim() ? { profile: profile.trim() } : {}),
        traits: traits
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12),
        urgency,
        ...(dueDate ? { dueDate } : {}),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Novo pedido"
      subtitle="O que falta ao clube"
      onClose={onClose}
      width={520}
      labelledBy="new-request"
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="ctl-primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? "A enviar…" : "Enviar pedido"}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <DialogField label="O que precisas">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defesa esquerdo para o Sub-15"
            className={dialogInputClass}
          />
        </DialogField>

        <div className="grid grid-cols-3 gap-3">
          <DialogField label="Modalidade">
            <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={dialogInputClass}>
              {academy.sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Escalão" hint="opcional">
            <input value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} className={dialogInputClass} />
          </DialogField>
          <DialogField label="Posição" hint="opcional">
            <input value={position} onChange={(e) => setPosition(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>

        <DialogField label="Perfil" hint="por palavras tuas">
          <textarea
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            rows={3}
            placeholder="Rápido a recuperar, confortável a sair a jogar pela esquerda."
            className={cx(dialogInputClass, "h-auto py-2 leading-relaxed")}
          />
        </DialogField>

        <DialogField label="Características" hint="separadas por vírgulas">
          <input
            value={traits}
            onChange={(e) => setTraits(e.target.value)}
            placeholder="Velocidade, Passe longo, Cabeceamento"
            className={dialogInputClass}
          />
        </DialogField>

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Urgência">
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as Urgency)}
              className={dialogInputClass}
            >
              {(Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => (
                <option key={u} value={u}>
                  {URGENCY_LABEL[u]}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Prazo" hint="opcional">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>
      </div>
    </Dialog>
  );
}
