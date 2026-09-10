import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";
import { Pencil, Send } from "@/lib/icons";
import { submitCallUps, updateCallUpLogistics, type CallUpLogistics } from "@/lib/callups";
import { antes, dataLonga, hora } from "@/lib/callup-sheet";

/**
 * Submeter a convocatória — e, no mesmo gesto, dizer a logística do dia.
 *
 * ## Porque é que estas perguntas mudaram de sítio
 *
 * Eram do diálogo de exportar o PDF, e viviam no `localStorage` de quem
 * exportava, por equipa. Três consequências: cada treinador tinha a sua versão
 * do ponto de encontro, mudar de computador perdia-a, e — a pior — o **pai
 * nunca via nada disto**, porque a única forma de a informação sair do produto
 * era um papel impresso no ponto de encontro. Um pai que precisa de saber a que
 * horas leva o filho é justamente quem não estava a receber a resposta.
 *
 * Agora perguntam-se aqui, que é o momento em que alguém está de facto a
 * decidir estas coisas — e o momento em que as famílias vão ser avisadas.
 * Ficam no jogo, chegam à app, e o PDF passa a descarregar directamente o que
 * já foi dito, sem voltar a perguntar.
 *
 * ## Tudo opcional, e de propósito
 *
 * Um amigável ao lado não tem ponto de encontro. Exigir estes campos para poder
 * submeter faria escrever "—" em novecentos jogos por época, e um campo cheio de
 * traços é pior do que um campo vazio: parece informação. O que existe mostra-se
 * ao pai; o que não existe não ocupa linha nenhuma no ecrã dele.
 *
 * ## Submeter continua a ser irreversível de facto
 *
 * Este diálogo não é uma confirmação disfarçada — o aviso de que as famílias vão
 * ser notificadas está no ecrã de trás, onde a lista se monta. Aqui já se
 * decidiu enviar; o que falta é dizer o resto.
 *
 * ## O mesmo diálogo corrige depois
 *
 * `modo="editar"` serve a convocatória **já enviada**: os mesmos campos, e no
 * fim um `PATCH` em vez de uma submissão. Sem isto, corrigir uma hora obrigava
 * a reabrir e ressubmeter — e o preço era um segundo "estás convocado" no
 * telemóvel de catorze famílias.
 *
 * Um diálogo e não dois porque as perguntas são as mesmas; o que muda é o que
 * acontece ao carregar no botão, e isso são três linhas.
 */
export function SubmitCallUpDialog({
  match,
  convocados,
  modo = "submeter",
  onDone,
  onClose,
}: {
  /** `submeter` envia a convocatória; `editar` corrige uma já enviada. */
  modo?: "submeter" | "editar";
  match: {
    id: string;
    teamName: string;
    opponent: string;
    isHome: boolean;
    venue: string;
    startsAt: string;
    /*
     * O que já foi dito deste jogo, quando se está a re-submeter.
     *
     * Reabrir e voltar a submeter é o caso normal de quem tirou um lesionado da
     * lista — e sem isto o diálogo abria com os valores por omissão e apagava o
     * ponto de encontro que já tinha sido combinado. O jogo ganha à memória do
     * navegador: o que está no jogo é o que as famílias já leram.
     */
    roundLabel?: string | null;
    meetingPoint?: string | null;
    meetingAt?: string | null;
    arrivalAt?: string | null;
    callUpNotes?: string | null;
    confirmationRequired?: boolean;
  };
  convocados: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const kickOff = useMemo(() => new Date(match.startsAt), [match.startsAt]);
  const lembrado = useMemo(() => recall(teamKeyOf(match)), [match]);

  /*
   * A ordem de preferência é sempre a mesma: o que **este jogo** já diz, depois
   * o que se costuma escrever nesta equipa, e só por fim a omissão. O jogo vem
   * primeiro porque é o que as famílias já leram — reabrir uma convocatória
   * para trocar um atleta não pode mudar-lhes o ponto de encontro por
   * distracção.
   */
  const [roundLabel, setRoundLabel] = useState(match.roundLabel ?? "");
  const [meetingPoint, setMeetingPoint] = useState(match.meetingPoint ?? lembrado.meetingPoint ?? match.venue);
  const [meetingTime, setMeetingTime] = useState(
    match.meetingAt ? hora(new Date(match.meetingAt)) : antes(kickOff, lembrado.meetingOffset),
  );
  const [arrivalTime, setArrivalTime] = useState(
    match.arrivalAt ? hora(new Date(match.arrivalAt)) : antes(kickOff, lembrado.arrivalOffset),
  );
  const [notes, setNotes] = useState(match.callUpNotes ?? "");
  const [confirmationRequired, setConfirmationRequired] = useState(match.confirmationRequired === true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErro(null);

    const logistica: CallUpLogistics = {
      roundLabel: roundLabel.trim() || undefined,
      meetingPoint: meetingPoint.trim() || undefined,
      meetingTime: meetingTime || undefined,
      arrivalTime: arrivalTime || undefined,
      notes: notes.trim() || undefined,
      confirmationRequired,
    };

    try {
      if (modo === "editar") await updateCallUpLogistics(match.id, logistica);
      else await submitCallUps(match.id, logistica);
      remember(teamKeyOf(match), { meetingPoint, meetingTime, arrivalTime }, kickOff);
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
      setBusy(false);
    }
  }

  const editar = modo === "editar";

  return (
    <Dialog
      labelledBy="submeter-convocatoria"
      title={editar ? "Detalhes da convocatória" : "Submeter convocatória"}
      subtitle={`${match.teamName} ${match.isHome ? "vs" : "@"} ${match.opponent} · ${dataLonga(kickOff)}`}
      icon={editar ? <Pencil className="size-4" strokeWidth={1.75} /> : <Send className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={620}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {/*
            A frase muda com o gesto, e diz a verdade nos dois casos: submeter
            avisa sempre; corrigir só avisa se alguma coisa mudar de facto — o
            servidor compara antes de mandar seja o que for.
          */}
          <span className="text-meta text-ink-3">
            {editar
              ? `${convocados} ${convocados === 1 ? "família é avisada" : "famílias são avisadas"} do que mudar.`
              : `${convocados} ${convocados === 1 ? "família é avisada" : "famílias são avisadas"} assim que submeteres.`}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost">
              Cancelar
            </button>
            <button type="submit" form="form-submeter" disabled={busy} className="ctl-primary">
              {editar ? <Pencil className="size-3.5" strokeWidth={1.75} /> : <Send className="size-3.5" strokeWidth={1.75} />}
              {busy ? "A gravar…" : editar ? "Gravar e avisar" : "Submeter e avisar"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-submeter" onSubmit={submeter} className="space-y-4 p-5">
        <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-meta leading-relaxed text-ink-2">
          O que escreveres aqui aparece na app das famílias e na folha em PDF. Deixa em branco o que não se
          aplica — o que não existe não aparece.
          {editar && " A convocatória não é reaberta: a lista fica como está."}
        </p>

        <Bloco titulo="O encontro">
          <DialogField label="Ponto de encontro" hint="opcional">
            <input
              value={meetingPoint}
              onChange={(e) => setMeetingPoint(e.target.value)}
              placeholder={match.venue}
              className={dialogInputClass}
            />
          </DialogField>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <DialogField label="Hora de encontro">
              <input
                type="time"
                value={meetingTime}
                onChange={(e) => setMeetingTime(e.target.value)}
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Chegada ao campo">
              <input
                type="time"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Início do jogo" hint="do calendário">
              <div className="flex h-9 items-center rounded-[var(--radius-control)] bg-sunken px-2.5 text-body font-medium text-ink tabular">
                {hora(kickOff)}
              </div>
            </DialogField>
          </div>
        </Bloco>

        <Bloco titulo="O jogo">
          <DialogField label="Jornada" hint="opcional">
            <input
              value={roundLabel}
              onChange={(e) => setRoundLabel(e.target.value)}
              placeholder="Jornada 3"
              className={dialogInputClass}
            />
          </DialogField>

          <div className="mt-3">
            <DialogField label="O que mais é preciso dizer" hint="opcional">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Equipamento alternativo, almoço, boleias."
                className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
              />
            </DialogField>
          </div>
        </Bloco>

        {/*
          A confirmação é uma excepção, e o texto tem de o dizer.

          Ligada em todos os jogos, ensina as famílias a carregar num botão sem
          ler — e aí a confirmação deixa de valer nada justamente no jogo em que
          era precisa. Fica desligada, e liga-se no autocarro alugado.
        */}
        <Bloco titulo="A resposta das famílias">
          <button
            type="button"
            role="switch"
            aria-checked={confirmationRequired}
            onClick={() => setConfirmationRequired((v) => !v)}
            className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line p-3.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">Pedir confirmação</span>
              <span className="block text-meta leading-relaxed text-ink-3">
                {confirmationRequired
                  ? "A app pede à família que confirme. Vês quem confirmou e quem ainda não abriu."
                  : "Assume-se que quem está convocado vai. A família só responde se não puder ir."}
              </span>
            </span>
            <span
              aria-hidden
              className={cx(
                "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                confirmationRequired ? "bg-signal-strong" : "bg-sunken",
              )}
            >
              <span
                className={cx(
                  "absolute top-0.5 size-5 rounded-full bg-surface shadow transition-[left]",
                  confirmationRequired ? "left-[18px]" : "left-0.5",
                )}
              />
            </span>
          </button>
        </Bloco>

        {erro && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{titulo}</h3>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* O que fica lembrado                                                         */
/* -------------------------------------------------------------------------- */

/**
 * O ponto de encontro repete-se de jogo para jogo; as horas repetem-se
 * **relativamente ao apito**.
 *
 * Guardar `09:30` não servia: um jogo às 10:00 e outro às 15:00 partilham
 * "encontro uma hora antes" e não partilham hora nenhuma. Por isso os minutos.
 *
 * Continua no navegador, e agora sem consequência: o que fica no jogo é o que
 * se submeteu, e isto é só o preenchimento inicial do diálogo seguinte.
 */
type Remembered = { meetingPoint: string; meetingOffset: number; arrivalOffset: number };

const OMISSAO: Remembered = { meetingPoint: "", meetingOffset: 60, arrivalOffset: 30 };

const teamKeyOf = (m: { teamName: string }) => m.teamName;
const chave = (team: string) => `academia.convocatoria.encontro.${team}`;

function recall(team: string): Remembered {
  try {
    const raw = localStorage.getItem(chave(team));
    return raw ? { ...OMISSAO, ...(JSON.parse(raw) as Partial<Remembered>) } : OMISSAO;
  } catch {
    return OMISSAO;
  }
}

function remember(
  team: string,
  l: { meetingPoint: string; meetingTime: string; arrivalTime: string },
  kickOff: Date,
): void {
  try {
    localStorage.setItem(
      chave(team),
      JSON.stringify({
        meetingPoint: l.meetingPoint,
        meetingOffset: offset(kickOff, l.meetingTime, OMISSAO.meetingOffset),
        arrivalOffset: offset(kickOff, l.arrivalTime, OMISSAO.arrivalOffset),
      } satisfies Remembered),
    );
  } catch {
    /* sem armazenamento: perde-se o preenchimento, não a convocatória */
  }
}

/** De `09:30` para "60 minutos antes do apito". */
function offset(kickOff: Date, hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return fallback;
  const d = new Date(kickOff);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const minutos = Math.round((kickOff.getTime() - d.getTime()) / 60_000);
  return minutos >= 0 && minutos <= 24 * 60 ? minutos : fallback;
}
