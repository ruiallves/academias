import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, Monogram, Pill, SelectField } from "./primitives";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { Eye, Home, Lock, Send, Trash2 } from "@/lib/icons";
import { periodsFor, type ApiReport } from "@/lib/development";
import { longDate } from "@/lib/format";
import type { Athlete } from "@/data/types";

/**
 * Escrever um relatório sobre um atleta.
 *
 * ## A escolha que este ecrã existe para tornar impossível de errar
 *
 * **Para quem é.** Metade do que um clube escreve sobre um miúdo não é para os pais
 * lerem — o parecer para a direção, a nota de que talvez suba de escalão. A outra
 * metade é precisamente para eles.
 *
 * Por isso a visibilidade não é uma caixa discreta ao lado do botão de gravar: são
 * duas opções do mesmo tamanho, com a consequência escrita por baixo de cada uma, e
 * **Interno vem escolhido**. Dos dois enganos possíveis, um é barato (a família não
 * viu, partilha-se agora) e o outro não tem volta (já leram).
 *
 * ## Publicar e partilhar são duas coisas
 *
 * Publicar é dizer *está escrito* — fecha o rascunho e passa a fazer parte do
 * registo do atleta, que o resto da academia lê. Partilhar é dizer *para quem*.
 * Um relatório interno também se publica; simplesmente não sai daqui.
 */
export function ReportDialog({
  report,
  athletes,
  onClose,
  onSaved,
}: {
  report: ApiReport | null;
  athletes: Athlete[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [athleteId, setAthleteId] = useState(report?.athleteId ?? athletes[0]?.id ?? "");
  const [title, setTitle] = useState(report?.title ?? "");
  const [period, setPeriod] = useState(report?.period ?? "");
  const [body, setBody] = useState(report?.body ?? "");
  const [visibility, setVisibility] = useState<"INTERNAL" | "FAMILY">(report?.visibility ?? "INTERNAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const published = report?.status === "PUBLISHED";
  const valid = athleteId !== "" && title.trim().length >= 3 && body.trim().length >= 10;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    const payload = { title: title.trim(), period: period || undefined, body: body.trim(), visibility };

    try {
      if (report) await apiPatch(`/api/reports/${report.id}`, payload);
      else await apiPost("/api/reports", { athleteId, ...payload });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Gravar e publicar de uma vez.
   *
   * Um relatório escreve-se de um fôlego e entrega-se no mesmo momento — obrigar a
   * gravar, fechar, reabrir e publicar seria cerimónia com uma armadilha no meio:
   * os que ficam por publicar.
   */
  async function saveAndPublish() {
    if (!valid || busy) return;
    const aviso = visibility === "FAMILY"
      ? "Publicar e partilhar com a família? Recebem um aviso na app."
      : "Publicar como relatório interno? A família não o vê.";
    if (!confirm(aviso)) return;

    setBusy(true);
    setError(null);
    try {
      const payload = { title: title.trim(), period: period || undefined, body: body.trim(), visibility };
      const id = report
        ? (await apiPatch<{ ok: true }>(`/api/reports/${report.id}`, payload), report.id)
        : (await apiPost<{ id: string }>("/api/reports", { athleteId, ...payload })).id;

      await apiPost(`/api/reports/${id}/publish`, {});
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível publicar.");
    } finally {
      setBusy(false);
    }
  }

  /** Partilhar um relatório que já estava publicado como interno. */
  async function share() {
    if (!report || busy) return;
    if (!confirm("Partilhar com a família? Passa a estar na app deles e recebem um aviso.")) return;
    setBusy(true);
    try {
      await apiPatch(`/api/reports/${report.id}`, { visibility: "FAMILY" });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível partilhar.");
    } finally {
      setBusy(false);
    }
  }

  async function unshare() {
    if (!report || busy) return;
    if (!confirm("Tirar da app da família? Quem já o leu, leu — deixa é de aparecer daqui para a frente.")) return;
    setBusy(true);
    try {
      await apiPatch(`/api/reports/${report.id}`, { visibility: "INTERNAL" });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível alterar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!report || busy) return;
    if (!confirm(`Apagar "${report.title}"?`)) return;
    setBusy(true);
    try {
      await apiDelete(`/api/reports/${report.id}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível apagar.");
    } finally {
      setBusy(false);
    }
  }

  const athlete = athletes.find((a) => a.id === athleteId);

  return (
    <Dialog
      labelledBy="relatorio"
      title={report ? report.title : "Novo relatório"}
      subtitle={report ? `${report.athleteName} · ${report.authorName}` : undefined}
      onClose={onClose}
      width={640}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {report ? (
            <button type="button" onClick={remove} disabled={busy} className="ctl-ghost text-[#a82a20]">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Apagar
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost">
              Fechar
            </button>

            {published ? (
              visibility === "FAMILY" ? (
                <button type="button" onClick={unshare} disabled={busy} className="ctl-outline">
                  <Lock className="size-3.5" strokeWidth={1.75} />
                  Tornar interno
                </button>
              ) : (
                <button type="button" onClick={share} disabled={busy} className="ctl-primary">
                  <Send className="size-3.5" strokeWidth={1.75} />
                  Partilhar com a família
                </button>
              )
            ) : (
              <>
                <button type="submit" form="form-relatorio" disabled={!valid || busy} className="ctl-outline">
                  Guardar rascunho
                </button>
                <button type="button" onClick={saveAndPublish} disabled={!valid || busy} className="ctl-primary">
                  <Send className="size-3.5" strokeWidth={1.75} />
                  {visibility === "FAMILY" ? "Publicar e partilhar" : "Publicar (interno)"}
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      <form id="form-relatorio" onSubmit={save} className="space-y-4 p-5">
        {published && (
          <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-meta text-ink-2">
            Publicado {report?.publishedAt ? longDate(new Date(report.publishedAt)) : ""} ·{" "}
            {visibility === "FAMILY" ? "a família vê-o na app" : "só a academia o vê"}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Atleta">
            {report ? (
              <div className="flex h-9 items-center gap-2.5">
                <Monogram name={report.athleteName} />
                <span className="truncate text-body text-ink">{report.athleteName}</span>
              </div>
            ) : (
              <SelectField
                className="w-full"
                value={athleteId}
                onChange={setAthleteId}
                options={athletes.map((a) => ({ value: a.id, label: a.name }))}
              />
            )}
          </DialogField>

          <DialogField label="Período" hint="opcional">
            <SelectField
              className="w-full"
              value={period}
              onChange={setPeriod}
              options={[{ value: "", label: "Sem período" }, ...periodsFor().map((p) => ({ value: p.value, label: p.label }))]}
            />
          </DialogField>
        </div>

        <DialogField label="Título">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Relatório do 1.º período"
            className={dialogInputClass}
            autoFocus={!report}
          />
        </DialogField>

        <DialogField label="Relatório" hint={`${body.trim().length} caracteres`}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder={
              visibility === "FAMILY"
                ? "O que os pais devem saber sobre o percurso do filho neste período."
                : "O que a academia precisa de registar. Não sai daqui."
            }
            className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
          />
        </DialogField>

        {/*
          A escolha em dois cartões do mesmo tamanho, com a consequência escrita.
          Uma caixa "partilhar com a família" ao lado do botão de gravar era o mesmo
          desenho com metade da atenção — e esta é a decisão que não se pode desfazer
          depois de alguém ler.
        */}
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Quem pode ler</legend>
          <div className="grid grid-cols-2 gap-2">
            <VisibilityCard
              icon={Lock}
              label="Só a academia"
              detail="Fica no registo do atleta. A família nunca o vê."
              active={visibility === "INTERNAL"}
              onClick={() => setVisibility("INTERNAL")}
            />
            <VisibilityCard
              icon={Home}
              label="Partilhar com a família"
              detail="Aparece na app dos pais e recebem um aviso."
              active={visibility === "FAMILY"}
              onClick={() => setVisibility("FAMILY")}
            />
          </div>
        </fieldset>

        {athlete && !report && visibility === "FAMILY" && (
          <p className="flex items-start gap-1.5 text-meta leading-relaxed text-ink-3">
            <Eye className="mt-0.5 size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
            Escreve a pensar em quem vai ler: o pai do {athlete.name.split(" ")[0]}, no telemóvel, ao fim do dia.
          </p>
        )}

        {report?.snapshot?.attendance && (
          <dl className="grid grid-cols-3 gap-3 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta">
            <div>
              <dt className="text-ink-4">Assiduidade</dt>
              <dd className="mt-0.5 font-medium text-ink tabular">
                {report.snapshot.attendance.total > 0
                  ? `${Math.round((report.snapshot.attendance.attended / report.snapshot.attendance.total) * 100)}%`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-4">Jogos</dt>
              <dd className="mt-0.5 font-medium text-ink tabular">{report.snapshot.matches ?? 0}</dd>
            </div>
            <div>
              <dt className="text-ink-4">Números de</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {report.snapshot.takenAt ? longDate(new Date(report.snapshot.takenAt)) : "—"}
              </dd>
            </div>
          </dl>
        )}

        {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function VisibilityCard({
  icon: Icon,
  label,
  detail,
  active,
  onClick,
}: {
  icon: typeof Lock;
  label: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "flex flex-col items-start gap-1 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors duration-[120ms]",
        active ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
      )}
    >
      <span className="flex items-center gap-2 text-body font-medium text-ink">
        <Icon className={cx("size-3.5", active ? "text-signal" : "text-ink-3")} strokeWidth={1.75} />
        {label}
      </span>
      <span className="text-[11px] leading-relaxed text-ink-3">{detail}</span>
    </button>
  );
}

/** A etiqueta que a lista usa. Vive aqui para o rótulo não divergir do diálogo. */
export function VisibilityPill({ visibility }: { visibility: ApiReport["visibility"] }) {
  return visibility === "FAMILY" ? <Pill tone="signal">Família</Pill> : <Pill tone="neutral">Interno</Pill>;
}
