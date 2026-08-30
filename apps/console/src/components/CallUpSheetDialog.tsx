import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { Segmented } from "./filters";
import { cx } from "./primitives";
import { Download } from "@/lib/icons";
import { teamById } from "@/lib/api";
import { useStore } from "@/lib/store";
import {
  antes,
  dataLonga,
  exportCallUpSheet,
  hora,
  type SheetLogistics,
  type SheetOrder,
  type SheetRow,
} from "@/lib/callup-sheet";

/**
 * Exportar a convocatória em PDF.
 *
 * ## O que este diálogo pergunta, e porque é só isto
 *
 * A folha precisa de coisas que a base não tem — a prova, o ponto de encontro,
 * a hora a que a malta se junta. Havia dois caminhos: pô-las no modelo do jogo,
 * ou perguntá-las na hora. Perguntá-las na hora ganhou por uma razão prática:
 * são dados de **logística de um dia**, escritos por quem imprime, e um campo
 * "ponto de encontro" no formulário de marcar jogo seria um campo que fica
 * vazio em novecentos jogos por época. Se um dia forem parte do jogo — porque a
 * app da família também os quer mostrar — sobem à base sem esta folha mudar.
 *
 * ## Escreve-se uma vez por equipa
 *
 * O que se repete de jogo para jogo — o ponto de encontro, a prova, a
 * antecedência do encontro — fica guardado por equipa no navegador de quem
 * exporta. Da segunda convocatória em diante o diálogo abre preenchido e
 * carrega-se em Descarregar. As horas guardam-se em **minutos antes do apito** e
 * não como `09:30`: um jogo às 10:00 e outro às 15:00 partilham "encontro 30
 * minutos antes", e não partilhavam hora nenhuma.
 *
 * ## Só de uma convocatória submetida
 *
 * Não é este diálogo que o decide — quem o decide é `exportCallUpSheet`, e os
 * dois ecrãs que chegam aqui já só mostram o botão depois de a lista fechar.
 * Vale a pena repeti-lo aqui na mesma: a lista que sai no PDF é a que as
 * famílias receberam, não a que está a ser montada.
 */
export function CallUpSheetDialog({ match, rows, onClose }: { match: SheetMatch; rows: SheetRow[]; onClose: () => void }) {
  const { academy, season } = useStore();

  const kickOff = useMemo(() => new Date(match.startsAt), [match.startsAt]);
  const lembrado = useMemo(() => recall(match.teamId), [match.teamId]);

  /*
   * A competição vem do jogo.
   *
   * Era escrita à mão a cada exportação e lembrada no `localStorage` de quem
   * exportava: cada treinador tinha a sua versão do nome da prova, e mudar de
   * computador perdia-a. Agora o jogo sabe em que prova se disputa (escolhida ao
   * marcá-lo, de entre as da equipa) e a folha herda-a.
   *
   * Continua editável, e o que se escrever continua a ser lembrado: um jogo sem
   * prova associada — um amigável, ou um marcado antes disto existir — não pode
   * ficar sem forma de o dizer na folha.
   */
  const [competition, setCompetition] = useState(match.competition?.label ?? lembrado.competition);
  const [round, setRound] = useState("");
  const [meetingPoint, setMeetingPoint] = useState(lembrado.meetingPoint || match.venue);
  const [meetingTime, setMeetingTime] = useState(antes(kickOff, lembrado.meetingOffset));
  const [arrivalTime, setArrivalTime] = useState(antes(kickOff, lembrado.arrivalOffset));
  const [notes, setNotes] = useState("");
  const [order, setOrder] = useState<SheetOrder>(lembrado.order);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErro(null);

    const logistica: SheetLogistics = {
      competition,
      round,
      meetingPoint,
      meetingTime,
      arrivalTime,
      notes,
      order,
    };

    remember(match.teamId, logistica, kickOff);

    try {
      await exportCallUpSheet({
        ...logistica,
        academy: { name: academy.name, logoUrl: academy.logoUrl, signalColor: academy.signalColor },
        season,
        team: match.teamName,
        opponent: match.opponent,
        isHome: match.isHome,
        venue: match.venue,
        kickOff,
        submitted: match.submitted,
        coachName: match.coachName ?? teamById(match.teamId)?.coaches[0]?.name ?? null,
        staff: match.staff,
        rows,
      });
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gerar o PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="folha-convocatoria"
      title="Exportar convocatória"
      subtitle={`${match.teamName} ${match.isHome ? "vs" : "@"} ${match.opponent} · ${dataLonga(kickOff)}`}
      icon={<Download className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={620}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {/* O ficheiro cai nas transferências com nome próprio — dizê-lo poupa a
              procura em quem esperava uma janela de impressão. */}
          <span className="text-meta text-ink-3">Descarrega um PDF pronto a imprimir ou a enviar.</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost">
              Cancelar
            </button>
            <button type="submit" form="form-folha" disabled={busy || rows.length === 0} className="ctl-primary">
              <Download className="size-3.5" strokeWidth={1.75} />
              {busy ? "A gerar…" : "Descarregar PDF"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-folha" onSubmit={exportar} className="space-y-4 p-5">
        <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-meta text-ink-2">
          {`${rows.length} ${rows.length === 1 ? "convocado" : "convocados"}`}, com número, coluna de transporte,
          espaço para assinatura e um quadro de observações.
        </p>

        <Bloco titulo="A prova">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <DialogField
              label="Competição"
              hint={match.competition ? "do jogo" : "opcional"}
            >
              <input
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                placeholder="Campeonato Distrital"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Jornada" hint="opcional">
              <input
                value={round}
                onChange={(e) => setRound(e.target.value)}
                placeholder="Jornada 3"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
        </Bloco>

        <Bloco titulo="O encontro">
          <DialogField label="Ponto de encontro">
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

        {/*
          Um quadro só, com a largura toda da folha.

          Havia aqui dois — "Informação adicional" e "Observações" — lado a lado
          em meia página cada. O primeiro repetia o que a app da família já diz a
          toda a gente; o segundo é o que se escreve **no campo**, à mão e à
          pressa, e meia página não chegava para isso.
        */}
        <Bloco titulo="O que a folha diz por baixo da lista">
          <DialogField label="Observações" hint="opcional">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Fica em branco para se escrever à mão."
              className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
            />
          </DialogField>
        </Bloco>

        <Bloco titulo="A lista">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-meta font-medium text-ink">Ordenar por</span>
              <Segmented
                label="Ordenar a lista por"
                value={order}
                onChange={setOrder}
                options={[
                  { value: "name", label: "Nome", hint: "mais rápido de encontrar para assinar" },
                  { value: "number", label: "Número", hint: "a ordem do plantel" },
                ]}
              />
            </div>
          </div>
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
/* O jogo, como a folha precisa dele                                           */
/* -------------------------------------------------------------------------- */

/**
 * O mínimo que a folha precisa de saber sobre o jogo.
 *
 * Um tipo próprio e não `ApiMatch` ou `MatchDetail`: os dois ecrãs que imprimem
 * têm modelos de jogo diferentes (a lista e a ficha), e obrigar um a converter-se
 * no outro só para imprimir era pedir a conversão errada. Isto é o que ambos
 * têm.
 */
export type SheetMatch = {
  teamId: string;
  teamName: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  startsAt: string;
  /** A prova, quando o jogo tem uma. É o que pré-preenche a folha. */
  competition: { id: string; label: string } | null;
  submitted: boolean;
  coachName: string | null;
  staff: { name: string; role: string }[];
};

/* -------------------------------------------------------------------------- */
/* O que fica lembrado                                                         */
/* -------------------------------------------------------------------------- */

type Remembered = {
  competition: string;
  meetingPoint: string;
  /** Minutos antes do apito. Ver a nota no topo. */
  meetingOffset: number;
  arrivalOffset: number;
  order: SheetOrder;
};

const OMISSAO: Remembered = {
  competition: "",
  meetingPoint: "",
  meetingOffset: 60,
  arrivalOffset: 30,
  order: "name",
};

const chave = (teamId: string) => `academia.convocatoria.folha.${teamId}`;

function recall(teamId: string): Remembered {
  try {
    const raw = localStorage.getItem(chave(teamId));
    return raw ? { ...OMISSAO, ...(JSON.parse(raw) as Partial<Remembered>) } : OMISSAO;
  } catch {
    // Um navegador sem `localStorage` (janela privada, política do sistema) não
    // impede ninguém de imprimir: perde-se a memória, não a folha.
    return OMISSAO;
  }
}

function remember(teamId: string, l: SheetLogistics, kickOff: Date): void {
  try {
    const guardar: Remembered = {
      competition: l.competition,
      meetingPoint: l.meetingPoint,
      meetingOffset: offset(kickOff, l.meetingTime, OMISSAO.meetingOffset),
      arrivalOffset: offset(kickOff, l.arrivalTime, OMISSAO.arrivalOffset),
      order: l.order,
    };
    localStorage.setItem(chave(teamId), JSON.stringify(guardar));
  } catch {
    /* Ver `recall`. */
  }
}

/**
 * Quantos minutos antes do apito é `hh:mm`.
 *
 * Uma hora **depois** do apito não é uma antecedência e não se guarda — devolve
 * a omissão. Acontece com jogos ao início da manhã, em que recuar uma hora
 * atravessa a meia-noite e o cálculo dava um número absurdo para o jogo
 * seguinte.
 */
function offset(kickOff: Date, hhmm: string, fallback: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;

  const quando = new Date(kickOff);
  quando.setHours(h, m, 0, 0);
  const minutos = Math.round((kickOff.getTime() - quando.getTime()) / 60_000);

  return minutos > 0 && minutos <= 6 * 60 ? minutos : fallback;
}
