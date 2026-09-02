import { useEffect, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Empty, Loading, Pill, cx } from "@/components/primitives";
import { Megaphone, Plus, Trash2 } from "@/lib/icons";
import {
  closePoll,
  createPoll,
  listPolls,
  publishPoll,
  removePoll,
  setMemberCard,
  type PollRow,
} from "@/lib/members";

/**
 * A app do clube, do lado da direcção: sondagens e cartão.
 *
 * Um diálogo com dois separadores, no mesmo espírito do "Gerir página de
 * inscrição" da mesma página: são as duas coisas que a direcção configura sobre
 * a experiência dos sócios na app, e espalhá-las por dois sítios era garantir
 * que ninguém encontrava a segunda.
 */
export function SociosAppDialog({ mayWrite, onClose }: { mayWrite: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"polls" | "card">("polls");

  return (
    <Dialog
      title="App do clube"
      subtitle="O que os sócios veem e respondem na app"
      icon={<Megaphone className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={640}
      labelledBy="socios-app"
      footer={
        <button type="button" className="ctl-ghost" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <div className="flex gap-1.5 border-b border-line px-5 py-3">
        <TabChip active={tab === "polls"} onClick={() => setTab("polls")}>
          Sondagens
        </TabChip>
        <TabChip active={tab === "card"} onClick={() => setTab("card")}>
          Cartão de sócio
        </TabChip>
      </div>

      {tab === "polls" ? <Sondagens mayWrite={mayWrite} /> : <Cartao mayWrite={mayWrite} />}
    </Dialog>
  );
}

function TabChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full px-3 py-1.5 text-meta font-medium transition-colors",
        active ? "bg-signal-soft text-signal-ink" : "text-ink-3 hover:bg-sunken hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Sondagens                                                                   */
/* -------------------------------------------------------------------------- */

const POLL_STATUS: Record<PollRow["status"], { label: string; tone: "neutral" | "ok" | "warn" }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  OPEN: { label: "Aberta", tone: "ok" },
  CLOSED: { label: "Fechada", tone: "warn" },
};

function Sondagens({ mayWrite }: { mayWrite: boolean }) {
  const [polls, setPolls] = useState<PollRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aCriar, setACriar] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const carregar = () =>
    listPolls()
      .then(setPolls)
      .catch((e: Error) => setErro(e.message));

  useEffect(() => {
    void carregar();
  }, []);

  async function agir(id: string, fn: (id: string) => Promise<unknown>) {
    if (busy) return;
    setBusy(id);
    setErro(null);
    try {
      await fn(id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 px-5 py-4">
      {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}

      {mayWrite && !aCriar && (
        <button type="button" className="ctl-outline" onClick={() => setACriar(true)}>
          <Plus className="size-3.5" strokeWidth={2} />
          Nova sondagem
        </button>
      )}

      {aCriar && (
        <NovaSondagem
          onDone={() => {
            setACriar(false);
            void carregar();
          }}
          onCancel={() => setACriar(false)}
        />
      )}

      {polls === null ? (
        <div className="py-8">
          <Loading size="panel" />
        </div>
      ) : polls.length === 0 && !aCriar ? (
        <Empty
          title="Ainda não há sondagens"
          detail='Cria uma pergunta com opções — "qual deve ser o equipamento da próxima época?" — e publica-a aos sócios.'
        />
      ) : (
        <ul className="space-y-3">
          {polls.map((p) => {
            const total = p.totalVotes;
            return (
              <li key={p.id} className="rounded-[var(--radius-control)] border border-line p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-medium text-ink">{p.question}</p>
                    <p className="mt-0.5 text-meta text-ink-3">
                      {total} {total === 1 ? "voto" : "votos"}
                    </p>
                  </div>
                  <Pill tone={POLL_STATUS[p.status].tone}>{POLL_STATUS[p.status].label}</Pill>
                </div>

                {/* Os resultados, sempre à vista da direcção — em rascunho ainda não há. */}
                {p.status !== "DRAFT" && (
                  <div className="mt-3 space-y-1.5">
                    {p.options.map((o) => {
                      const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
                      return (
                        <div key={o.id}>
                          <div className="flex items-baseline justify-between gap-2 text-meta">
                            <span className="min-w-0 truncate text-ink-2">{o.label}</span>
                            <span className="shrink-0 text-ink-3 tabular">
                              {o.votes} · {pct}%
                            </span>
                          </div>
                          <span className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                            <span className="h-full rounded-full bg-signal-strong" style={{ width: `${pct}%` }} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p.status === "DRAFT" && (
                  <p className="mt-2 text-meta text-ink-3">{p.options.map((o) => o.label).join(" · ")}</p>
                )}

                {mayWrite && (
                  <div className="mt-3 flex items-center gap-2">
                    {p.status === "DRAFT" && (
                      <>
                        <button type="button" className="ctl-primary" disabled={busy === p.id} onClick={() => void agir(p.id, publishPoll)}>
                          Publicar
                        </button>
                        <button
                          type="button"
                          className="ctl-ghost text-risk"
                          disabled={busy === p.id}
                          onClick={() => void agir(p.id, removePoll)}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.75} />
                          Apagar
                        </button>
                      </>
                    )}
                    {p.status === "OPEN" && (
                      <button type="button" className="ctl-outline" disabled={busy === p.id} onClick={() => void agir(p.id, closePoll)}>
                        Encerrar
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NovaSondagem({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [question, setQuestion] = useState("");
  const [details, setDetails] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const validas = options.map((o) => o.trim()).filter(Boolean);
  const pronta = question.trim().length >= 5 && validas.length >= 2;

  async function criar() {
    if (!pronta || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await createPoll({ question: question.trim(), details: details.trim() || undefined, options: validas });
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-control)] border border-line p-3.5">
      <DialogField label="Pergunta">
        <input
          autoFocus
          className={dialogInputClass}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Qual deve ser o equipamento da próxima época?"
          maxLength={200}
        />
      </DialogField>
      <DialogField label="Contexto" hint="opcional">
        <input
          className={dialogInputClass}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Uma linha por baixo da pergunta"
          maxLength={1000}
        />
      </DialogField>
      <DialogField label="Opções" hint="entre 2 e 10">
        <div className="space-y-1.5">
          {options.map((o, i) => (
            <input
              key={i}
              className={dialogInputClass}
              value={o}
              onChange={(e) => setOptions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Opção ${String.fromCharCode(65 + i)}`}
              maxLength={120}
            />
          ))}
          {options.length < 10 && (
            <button type="button" className="ctl-ghost" onClick={() => setOptions((xs) => [...xs, ""])}>
              <Plus className="size-3.5" strokeWidth={2} />
              Mais uma opção
            </button>
          )}
        </div>
      </DialogField>

      {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ctl-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="ctl-primary" disabled={!pronta || busy} onClick={() => void criar()}>
          {busy ? "A criar…" : "Criar rascunho"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cartão                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Os dois interruptores do cartão.
 *
 * O estado inicial lê-se com um PATCH vazio — o endpoint devolve os valores
 * actuais sem mudar nada. Não é elegante, mas evita um GET que só serviria a
 * este par de caixas.
 */
function Cartao({ mayWrite }: { mayWrite: boolean }) {
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

  if (erro) return <p className="px-5 py-4 text-meta text-risk">{erro}</p>;
  if (!estado)
    return (
      <div className="py-8">
        <Loading size="panel" />
      </div>
    );

  return (
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
