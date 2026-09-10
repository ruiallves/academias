import { useEffect, useState } from "react";
import { DialogField, dialogInputClass } from "@/components/Dialog";
import { Empty, Loading, Panel, PanelHead, Pill } from "@/components/primitives";
import { Plus, Trash2 } from "@/lib/icons";
import { closePoll, createPoll, listPolls, publishPoll, removePoll, type PollRow } from "@/lib/members";

/**
 * As sondagens aos sócios — perguntar, e não só avisar.
 *
 * ## Porque é que isto vive na Comunicação
 *
 * Vivia dentro de um diálogo chamado "App do clube", na página dos sócios, ao
 * lado dos interruptores do cartão. Duas coisas erradas de uma vez: quem quer
 * perguntar alguma coisa aos sócios vai à Comunicação — é lá que está o gesto
 * de falar com as pessoas — e nunca abriria um diálogo de configuração à
 * procura dele. E o nome era do sítio onde a coisa aparece, não do que ela é:
 * "App do clube" é onde os sócios leem, não o que a direcção faz.
 *
 * Um aviso e uma sondagem são o mesmo trabalho com sentidos opostos: um diz,
 * o outro pergunta. Estão na mesma página, e a direcção escolhe qual usa.
 *
 * ## O rascunho é de propósito
 *
 * Uma sondagem nasce em rascunho e só chega aos sócios quando alguém a publica.
 * Uma pergunta mal escrita não se corrige depois de trezentas pessoas a terem
 * lido — e ao contrário de um aviso, cada resposta que entra torna a correcção
 * mais cara.
 */

const POLL_STATUS: Record<PollRow["status"], { label: string; tone: "neutral" | "ok" | "warn" }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  OPEN: { label: "Aberta", tone: "ok" },
  CLOSED: { label: "Fechada", tone: "warn" },
};

export function SondagensPanel({ mayWrite }: { mayWrite: boolean }) {
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
    <Panel>
      <PanelHead title="Sondagens aos sócios" hint={polls ? `${polls.length}` : undefined}>
        {mayWrite && !aCriar && (
          <button type="button" className="ctl-ghost" onClick={() => setACriar(true)}>
            <Plus className="size-3.5" strokeWidth={2} />
            Nova sondagem
          </button>
        )}
      </PanelHead>

      <div className="space-y-3 px-5 py-4">
        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}

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
                          <button
                            type="button"
                            className="ctl-primary"
                            disabled={busy === p.id}
                            onClick={() => void agir(p.id, publishPoll)}
                          >
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
                        <button
                          type="button"
                          className="ctl-outline"
                          disabled={busy === p.id}
                          onClick={() => void agir(p.id, closePoll)}
                        >
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
    </Panel>
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
