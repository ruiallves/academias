import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Monogram, Panel, PanelHead } from "@/components/primitives";
import { DialogField, dialogInputClass } from "@/components/Dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EstadoDaConsulta } from "@/routes/medical/Consultations";
import { ArrowLeft, Check, Stethoscope } from "@/lib/icons";
import { listAthletes, teamById, today } from "@/lib/api";
import { useCatalog } from "@/lib/catalogs";
import {
  areaLabel,
  deleteClinicalEntry,
  findConsulta,
  updateClinicalEntry,
  useClinicalRecords,
} from "@/lib/clinical";
import { longDate, relativeDays } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { cx } from "@/components/primitives";
import type { Athlete, ClinicalEntry } from "@/data/types";

/**
 * A página de uma consulta.
 *
 * É onde quem dá a consulta escreve o que se passou (`notes`, que só o
 * departamento clínico lê), remarca, vê a resposta da família e a dá como
 * realizada. Chega-se aqui a partir do calendário e da lista de Consultas, e da
 * ficha do atleta.
 *
 * Lê do boletim que já está no store: a consulta vem dentro do atleta, como o
 * resto do boletim. Não há `GET` próprio.
 */
export default function ConsultationDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  useClinicalRecords();

  const achada = findConsulta(listAthletes(session), id);
  if (!achada) {
    return (
      <>
        <Voltar />
        <Panel>
          <Empty icon={Stethoscope} title="Consulta não encontrada" detail="Pode ter sido desmarcada, ou não estar no teu âmbito." />
        </Panel>
      </>
    );
  }
  // A chave remonta o formulário quando o servidor muda a consulta (outra aba, outra pessoa).
  return <Pagina key={`${achada.entry.id}:${achada.entry.date}:${achada.entry.time}`} athlete={achada.athlete} entry={achada.entry} />;
}

function Voltar() {
  return (
    <Link to="/clinico/consultas" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Consultas
    </Link>
  );
}

function Pagina({ athlete, entry }: { athlete: Athlete; entry: ClinicalEntry }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const tipos = useCatalog("consultationTypes");
  const mayWrite = can(session, "clinical:write");
  const marcada = entry.status === "scheduled";
  const rotulo = areaLabel(entry, tipos);

  const [notes, setNotes] = useState(entry.notes ?? "");
  const [date, setDate] = useState(entry.date);
  const [time, setTime] = useState(entry.time ?? "");
  const [location, setLocation] = useState(entry.location ?? "");
  const [title, setTitle] = useState(entry.title);
  const [detail, setDetail] = useState(entry.detail ?? "");

  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);
  const [aDesmarcar, setADesmarcar] = useState(false);

  /*
   * Só vai o que mudou. Mandar a data sem lhe mexer contava como remarcar: a
   * família recebia um aviso de "data nova" e a resposta dela era apagada.
   */
  const mudancas = {
    ...(notes !== (entry.notes ?? "") ? { notes } : {}),
    ...(date !== entry.date ? { date } : {}),
    ...(time !== (entry.time ?? "") ? { time } : {}),
    ...(location !== (entry.location ?? "") ? { location } : {}),
    ...(title !== entry.title ? { title } : {}),
    ...(detail !== (entry.detail ?? "") ? { detail } : {}),
  };
  const sujo = Object.keys(mudancas).length > 0;
  const remarca = marcada && ("date" in mudancas || "time" in mudancas || "location" in mudancas);

  async function gravar(extra: Parameters<typeof updateClinicalEntry>[1] = {}) {
    setBusy(true);
    setErro(null);
    setGravado(false);
    try {
      await updateClinicalEntry(entry.id, { ...mudancas, ...extra });
      setGravado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Voltar />
      <PageHeader
        eyebrow={rotulo}
        title={athlete.name}
        subtitle={[
          capitalize(longDate(new Date(`${entry.date}T00:00:00`))),
          entry.time,
          entry.location,
          relativeDays(new Date(`${entry.date}T00:00:00`), today),
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <EstadoDaConsulta entry={entry} />
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <Panel>
            <PanelHead title="Notas da consulta" hint="só o departamento clínico vê" />
            <div className="p-5">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={!mayWrite}
                rows={10}
                placeholder={mayWrite ? "O que se observou, o que se fez, o plano para a próxima…" : "Sem notas."}
                className={cx(dialogInputClass, "h-auto min-h-[200px] resize-y py-2 leading-relaxed")}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Marcação" />
            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <DialogField label="Data">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!mayWrite} className={dialogInputClass} />
                </DialogField>
                <DialogField label="Hora">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!mayWrite} className={dialogInputClass} />
                </DialogField>
                <DialogField label="Local">
                  <input value={location} onChange={(e) => setLocation(e.target.value)} disabled={!mayWrite} className={dialogInputClass} />
                </DialogField>
              </div>
              <DialogField label="Descrição">
                <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!mayWrite} className={dialogInputClass} />
              </DialogField>
              <DialogField label="Nota para a família" hint="a família vê esta nota">
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  disabled={!mayWrite}
                  rows={2}
                  className={cx(dialogInputClass, "h-auto resize-none py-2")}
                />
              </DialogField>
              {remarca && (
                <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
                  Ao gravar, a família e o atleta recebem um aviso com a nova marcação
                  {entry.confirmationRequired ? " e a confirmação volta a ficar por responder." : "."}
                </p>
              )}
            </div>
          </Panel>

          {mayWrite && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {erro && <span className="mr-auto text-meta text-risk">{erro}</span>}
              {gravado && !sujo && (
                <span className="mr-auto inline-flex items-center gap-1.5 text-meta text-ok">
                  <Check className="size-3.5" strokeWidth={2.25} />
                  Gravado
                </span>
              )}
              <button type="button" className="ctl-primary" disabled={!sujo || busy} onClick={() => void gravar()}>
                {busy ? "A gravar…" : "Gravar"}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Panel>
            <PanelHead title="Atleta" />
            <Link to={`/atletas/${athlete.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-sunken/50">
              <Monogram name={athlete.name} photoUrl={athlete.photoUrl} />
              <span className="min-w-0">
                <span className="block truncate text-body font-medium text-ink">{athlete.name}</span>
                <span className="block truncate text-meta text-ink-3">{teamById(athlete.teamId)?.name ?? "Sem equipa"}</span>
              </span>
            </Link>
          </Panel>

          <Panel>
            <PanelHead title="Resposta" />
            <div className="px-5 py-4 text-meta leading-relaxed">
              <Resposta entry={entry} />
            </div>
          </Panel>

          {mayWrite && marcada && (
            <Panel>
              <PanelHead title="Depois da consulta" />
              <div className="space-y-3 px-5 py-4">
                <button
                  type="button"
                  className="ctl-primary w-full justify-center"
                  disabled={busy}
                  onClick={() => void gravar({ status: "done" })}
                >
                  <Check className="size-3.5" strokeWidth={2.25} />
                  Dar como realizada
                </button>
                <button type="button" className="ctl-ghost w-full justify-center text-ink-3 hover:text-risk" onClick={() => setADesmarcar(true)}>
                  Desmarcar consulta
                </button>
              </div>
            </Panel>
          )}
        </div>
      </div>

      {aDesmarcar && (
        <ConfirmDialog
          title="Desmarcar consulta"
          confirmLabel="Desmarcar"
          onClose={() => setADesmarcar(false)}
          onConfirm={async () => {
            await deleteClinicalEntry(entry.id);
            navigate("/clinico/consultas", { replace: true });
          }}
        >
          A consulta de {athlete.name} deixa de aparecer no calendário e na app da família. As outras da
          mesma série ficam como estão.
        </ConfirmDialog>
      )}
    </>
  );
}

/** O que a família disse, ou porque é que não há nada para dizer. */
function Resposta({ entry }: { entry: ClinicalEntry }) {
  const quem = entry.respondBy === "ATHLETE" ? "o atleta" : "o encarregado";
  if (!entry.confirmationRequired) {
    return <p className="text-ink-3">Não se pediu confirmação. A família e o atleta foram avisados da marcação.</p>;
  }
  const quando = entry.respondedAt
    ? new Date(entry.respondedAt).toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  if (entry.reply === "confirmed") {
    return (
      <p className="text-ok">
        <span className="font-semibold">Confirmada</span>
        <span className="text-ink-3"> por {quem}{quando ? `, ${quando}` : ""}.</span>
      </p>
    );
  }
  if (entry.reply === "declined") {
    return (
      <div>
        <p className="font-semibold text-risk">Não vai</p>
        {entry.declineReason && <p className="mt-1 text-ink-2">“{entry.declineReason}”</p>}
        <p className="mt-1 text-ink-3">Respondeu {quem}{quando ? `, ${quando}` : ""}. Remarca a data para voltar a pedir.</p>
      </div>
    );
  }
  return <p className="text-ink-3">À espera de resposta. Pediu-se a {quem} que confirme na app.</p>;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
