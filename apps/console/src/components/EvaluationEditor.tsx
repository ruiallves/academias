import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, Monogram } from "./primitives";
import { apiPost } from "@/lib/http";
import { ArrowRight, Check, Gauge } from "@/lib/icons";
import { SCALE, type ApiEvaluation } from "@/lib/development";
import type { Athlete } from "@/data/types";

/**
 * Avaliar um atleta.
 *
 * ## Porque é que isto avança para o seguinte
 *
 * Porque ninguém avalia um atleta: avalia-se um plantel. O trabalho real é uma
 * tarde de Dezembro com vinte fichas para preencher, e um formulário que fecha ao
 * gravar obriga a vinte viagens à tabela para reabrir a linha seguinte — que é a
 * razão por que, na maioria dos clubes, as avaliações ficam a meio.
 *
 * Daí "Guardar e seguinte" ser o botão cheio: grava, puxa o atleta a seguir e
 * mantém a janela aberta. O rodapé diz sempre em que ponto vai (`3 de 18`), porque
 * uma tarefa longa sem fim à vista é uma tarefa que se abandona.
 *
 * ## Porque é que as pontuações são pontos e não um menu
 *
 * Um `<select>` de 1 a 5 obriga a abrir, ler cinco linhas e escolher — cinco vezes
 * por atleta, cem vezes por plantel. Cinco pontos clicáveis são um gesto só, e o
 * teclado (1 a 5, depois Tab) faz o mesmo sem tirar as mãos de onde estão.
 *
 * ## O que é obrigatório, e o que não é
 *
 * As pontuações. Sem elas não há nada para publicar — o servidor recusa, e a
 * interface diz porquê antes de se tentar. O texto é opcional a gravar e
 * **fortemente pedido** a publicar: uma avaliação que chega a um pai só com números
 * é a mesma coisa que um boletim de notas sem uma linha do professor.
 */

export type RosterEntry = { athlete: Athlete; evaluation: ApiEvaluation | undefined };

export function EvaluationEditor({
  roster,
  startAt,
  period,
  skills,
  onClose,
  onSaved,
}: {
  roster: RosterEntry[];
  startAt: number;
  period: string;
  skills: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [index, setIndex] = useState(startAt);
  const entry = roster[index];

  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [strengths, setStrengths] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Cada atleta traz o que já lá estava. Sem isto, abrir a ficha de quem já tinha
  // um rascunho mostrava-a em branco — e quem gravasse por cima apagava o trabalho.
  useEffect(() => {
    const e = entry?.evaluation;
    setScores(e?.scores ?? {});
    setNote(e?.note ?? "");
    setStrengths(e?.strengths ?? "");
    setFocus(e?.focus ?? "");
    setError(null);
  }, [entry?.evaluation, entry?.athlete.id]);

  const done = useMemo(() => Object.keys(scores).length, [scores]);
  const complete = done === skills.length && skills.length > 0;
  const published = entry?.evaluation?.status === "PUBLISHED";

  if (!entry) return null;

  async function save(advance: boolean) {
    if (busy || done === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/evaluations", {
        athleteId: entry.athlete.id,
        period,
        scores,
        note: note.trim(),
        strengths: strengths.trim(),
        focus: focus.trim(),
      });
      onSaved();

      if (advance && index < roster.length - 1) {
        setIndex(index + 1);
      } else {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1600);
        if (advance) onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="avaliar"
      title={entry.athlete.name}
      subtitle={period}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3 tabular">
            {index + 1} de {roster.length}
            {published && <span className="ml-2 text-[#1f7a45]">· publicada</span>}
            {savedFlash && <span className="ml-2 text-[#1f7a45]">· guardado</span>}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost">
              Fechar
            </button>
            <button type="button" onClick={() => void save(false)} disabled={busy || done === 0} className="ctl-outline">
              Guardar
            </button>
            <button type="button" onClick={() => void save(true)} disabled={busy || done === 0} className="ctl-primary">
              {index < roster.length - 1 ? (
                <>
                  Guardar e seguinte
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </>
              ) : (
                <>
                  <Check className="size-3.5" strokeWidth={2} />
                  Guardar e fechar
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {/* Quem se está a avaliar, e como percorrer o plantel sem fechar a janela. */}
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5">
          <Monogram name={entry.athlete.name} photoUrl={entry.athlete.photoUrl} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-ink">{entry.athlete.name}</div>
            <div className="text-meta text-ink-3">
              {entry.evaluation
                ? `Avaliada por ${entry.evaluation.coachName.split(" ")[0]}`
                : "Ainda sem avaliação neste período"}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setIndex(Math.max(0, index - 1))}
              disabled={index === 0}
              className="ctl-ghost size-8 justify-center px-0"
              aria-label="Atleta anterior"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setIndex(Math.min(roster.length - 1, index + 1))}
              disabled={index === roster.length - 1}
              className="ctl-ghost size-8 justify-center px-0"
              aria-label="Atleta seguinte"
            >
              →
            </button>
          </div>
        </div>

        {skills.length === 0 ? (
          <p className="rounded-[var(--radius-control)] bg-[#fdf1dd] px-3 py-2.5 text-meta leading-relaxed text-[#8a5a12]">
            A modalidade desta equipa ainda não tem competências configuradas. Define-as em Definições → Modalidades
            e a grelha aparece aqui.
          </p>
        ) : (
          <div className="space-y-1">
            {skills.map((skill) => (
              <ScoreRow
                key={skill}
                label={skill}
                value={scores[skill]}
                onChange={(v) =>
                  setScores((s) => {
                    // Clicar no valor que já lá está limpa-o: é como se corrige um
                    // engano sem ter de escolher um número que não se quer dizer.
                    const next = { ...s };
                    if (next[skill] === v) delete next[skill];
                    else next[skill] = v;
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}

        <DialogField label="O que está bem" hint="os pais lêem isto primeiro">
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={2}
            placeholder="Primeiro toque e leitura de jogo. Nunca falha um treino."
            className={cx(dialogInputClass, "h-auto resize-y py-2")}
          />
        </DialogField>

        <DialogField label="A trabalhar no próximo período" hint="a parte accionável">
          <textarea
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            rows={2}
            placeholder="Finalização com o pé esquerdo. Ocupar melhor o espaço sem bola."
            className={cx(dialogInputClass, "h-auto resize-y py-2")}
          />
        </DialogField>

        <DialogField label="Nota do treinador" hint="opcional">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Um parágrafo sobre o período — o que mudou desde a última avaliação."
            className={cx(dialogInputClass, "h-auto resize-y py-2")}
          />
        </DialogField>

        {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

        {!complete && skills.length > 0 && (
          <p className="flex items-center gap-1.5 text-meta text-ink-3">
            <Gauge className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
            {done === 0
              ? "Sem pontuações não se publica — o pai receberia um aviso a apontar para um ecrã vazio."
              : `${done} de ${skills.length} competências. Podes gravar assim e voltar depois.`}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Uma competência, cinco pontos.
 *
 * Os botões são `radio` em espírito mas `button` em código: um grupo de rádios
 * nativo não deixa desmarcar, e desmarcar é a forma óbvia de corrigir um clique
 * errado. O `aria-label` diz "Técnica: 4 de 5" a quem usa leitor de ecrã.
 */
function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] px-1 py-1.5 hover:bg-sunken/60">
      <span className="min-w-0 flex-1 truncate text-body text-ink">{label}</span>

      <div className="flex shrink-0 items-center gap-1">
        {SCALE.map((n) => {
          const on = value !== undefined && n <= value;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-label={`${label}: ${n} de 5`}
              aria-pressed={value === n}
              className={cx(
                "size-7 rounded-full border transition-colors duration-[120ms]",
                on ? "border-signal bg-signal" : "border-line bg-surface hover:border-line-strong",
              )}
            />
          );
        })}
      </div>

      <span className={cx("w-6 shrink-0 text-right text-meta tabular", value ? "text-ink" : "text-ink-4")}>
        {value ?? "—"}
      </span>
    </div>
  );
}
