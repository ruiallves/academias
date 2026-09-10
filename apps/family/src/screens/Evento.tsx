import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarOff, ChevronLeft, Clock, DoorOpen, MapPin, StickyNote, UserRound } from "lucide-react";
import { useChild } from "@/App";
import { reload, useStore, type CallUpState, type Match } from "@/lib/store";
import { responderConvocatoria } from "@/lib/convocatoria";
import { Chip, cx, dayName, dateShort, time } from "@/ui";

/**
 * A página de um evento — o treino ou o jogo, por dentro.
 *
 * ## O que faltava
 *
 * O calendário e a página inicial mostravam o essencial e acabavam aí: hora,
 * sítio, e nada mais. Um cartão que não abre é um beco — o pai lê "Pavilhão
 * Municipal · 19:00", quer saber a que porta se entra ou se o filho está mesmo
 * convocado, e não tem para onde ir. Tocava-se no cartão e não acontecia nada,
 * que é a pior resposta possível: parece avaria.
 *
 * ## Um ecrã, dois eventos
 *
 * Treino e jogo partilham a moldura (a data em grande, o sítio, o balneário) e
 * separam-se no que é próprio de cada um: o treino tem treinador, o jogo tem
 * adversário e convocatória. Dois ecrãs a 90% iguais divergiriam ao terceiro
 * retoque.
 *
 * ## A rota leva o tipo
 *
 * `/evento/treino/:id` e `/evento/jogo/:id`. Sem o tipo, um id teria de ser
 * procurado nas duas listas — e o dia em que um treino e um jogo partilhassem
 * id (não partilham hoje; são tabelas diferentes com cuid) a app abria o
 * errado em silêncio.
 */
export default function Evento() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const { child } = useChild();
  const store = useStore();
  const navigate = useNavigate();

  const treino = kind === "treino" ? store.trainings.find((t) => t.sessionId === id && t.childId === child.id) : null;
  const jogo = kind === "jogo" ? store.matches.find((m) => m.matchId === id && m.childId === child.id) : null;

  if (!treino && !jogo) return <NaoExiste onBack={() => navigate("/agenda")} />;

  const start = treino?.start ?? jogo!.start;
  const end = treino?.end ?? jogo!.end;
  const cancelado = treino?.cancelled ?? jogo!.cancelled;

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2"
      >
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Voltar
      </button>

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
          {jogo ? "Jogo" : "Treino"}
        </p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {jogo ? `${jogo.isHome ? "vs" : "@"} ${jogo.opponent}` : child.team}
        </h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {dayName(start)}, {dateShort(start)} · {time(start)}–{time(end)}
        </p>
        {cancelado && (
          <p className="mt-2 inline-flex rounded-full bg-risk-soft px-2.5 py-1 text-[12px] font-semibold text-risk">
            Cancelado
          </p>
        )}
      </header>

      {jogo && !cancelado && <Convocatoria jogo={jogo} />}

      <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
        <Facto icone={MapPin} rotulo="Onde" valor={treino?.venue ?? jogo!.venue} />

        {/* O balneário: o que um pai à porta de um pavilhão com quatro portas procura. */}
        {treino?.dressingRoom && <Facto icone={DoorOpen} rotulo="Balneário" valor={treino.dressingRoom} />}

        {treino?.coach && <Facto icone={UserRound} rotulo="Treinador" valor={treino.coach} />}

        {/*
          A logística do jogo — dita pelo clube ao submeter a convocatória.
          Só aparece a quem está convocado: quem ficou de fora não tem ponto de
          encontro nenhum, e mostrar-lho seria mandá-lo para lá.
        */}
        {jogo?.callUp === "in" && jogo.meetingAt && (
          <Facto
            icone={Clock}
            rotulo="Encontro"
            valor={time(jogo.meetingAt)}
            nota={
              // Uma concentração na véspera é um facto diferente de "uma hora
              // antes", e a data tem de o dizer.
              jogo.meetingAt.toDateString() !== start.toDateString()
                ? `${dayName(jogo.meetingAt)}, ${dateShort(jogo.meetingAt)}`
                : undefined
            }
          />
        )}
        {jogo?.callUp === "in" && jogo.meetingPoint && (
          <Facto icone={MapPin} rotulo="Ponto de encontro" valor={jogo.meetingPoint} />
        )}
        {jogo?.callUp === "in" && jogo.arrivalAt && (
          <Facto icone={Clock} rotulo="Chegada ao campo" valor={time(jogo.arrivalAt)} />
        )}
        {jogo?.round && <Facto icone={StickyNote} rotulo="Jornada" valor={jogo.round} />}
      </section>

      {(treino?.notes || (jogo?.callUp === "in" && jogo.notes)) && (
        <section className="mt-3 rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-soft)]">
          <p className="text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Do clube</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">
            {treino?.notes ?? jogo?.notes}
          </p>
        </section>
      )}

      <p className="mt-6 px-1 pb-1 text-[12px] leading-relaxed text-ink-4">
        As alterações chegam por notificação, no momento em que acontecem.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Facto({
  icone: Icone,
  rotulo,
  valor,
  nota,
}: {
  icone: typeof MapPin;
  rotulo: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-ink/5 px-4 py-3 last:border-0">
      <Icone className="mt-0.5 size-[18px] shrink-0 text-ink-4" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink-3">{rotulo}</span>
        <span className="block text-[15px] font-medium text-ink">{valor}</span>
        {nota && <span className="block text-[12px] text-ink-3">{nota}</span>}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A convocatória                                                              */
/* -------------------------------------------------------------------------- */

const ESTADO: Record<CallUpState, { rotulo: string; explicacao: string; tom: "ok" | "warn" | "neutral" | "risk" }> = {
  pending: {
    rotulo: "Convocatória por lançar",
    explicacao: "O clube ainda não fechou a lista. Recebes uma notificação assim que fechar.",
    tom: "neutral",
  },
  out: {
    rotulo: "Não convocado",
    explicacao: "A lista deste jogo já saiu, e desta vez não ficou nela.",
    tom: "warn",
  },
  in: { rotulo: "Convocado", explicacao: "", tom: "ok" },
  cancelled: { rotulo: "Jogo cancelado", explicacao: "Este jogo foi desmarcado.", tom: "risk" },
};

/**
 * O estado da convocatória, e a resposta da família.
 *
 * ## Os quatro estados são precisos
 *
 * "Ainda não se sabe" e "ficou de fora" são coisas diferentes para quem lê, e
 * juntá-las num "não convocado" dizia a um pai que o filho tinha sido cortado
 * de uma lista que ainda ninguém fez.
 *
 * ## Assume-se que vai
 *
 * O botão de baixo diz "Não vou poder ir", e não há botão de "vou" a não ser
 * que o clube tenha pedido confirmação. É de propósito: obrigar toda a gente a
 * carregar num botão em todos os jogos ensina as famílias a carregar sem ler, e
 * aí a confirmação deixa de valer nada justamente no jogo em que era precisa.
 */
function Convocatoria({ jogo }: { jogo: Match }) {
  const meta = ESTADO[jogo.callUp];
  const [aRecusar, setARecusar] = useState(false);

  return (
    <section className="mt-4 rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={meta.tom}>{meta.rotulo}</Chip>
        {jogo.callUp === "in" && jogo.confirmationRequired && !jogo.reply && (
          <Chip tone="warn">Confirmação pedida</Chip>
        )}
      </div>

      {meta.explicacao && <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{meta.explicacao}</p>}

      {jogo.callUp === "in" && (
        <>
          {jogo.reply && !jogo.reply.going ? (
            /*
             * A recusa fica escrita, e com o motivo à vista.
             *
             * Um pai que disse "não vai" na terça e abre a app na sexta tem de
             * ver o que disse — sem isso, fica na dúvida se chegou a carregar, e
             * volta a escrever ao treinador, que é o que isto veio evitar.
             */
            <div className="mt-3 rounded-[var(--radius-lg)] bg-risk-soft p-3.5">
              <p className="text-[14px] font-semibold text-risk">Disseste que não vai</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{jogo.reply.reason}</p>
              <Responder jogo={jogo} going label="Afinal vai" ghost />
            </div>
          ) : jogo.reply?.going ? (
            <div className="mt-3 rounded-[var(--radius-lg)] bg-ok-soft p-3.5">
              <p className="text-[14px] font-semibold text-ok">Confirmaste a presença</p>
              <button
                type="button"
                onClick={() => setARecusar(true)}
                className="mt-1 text-[13px] font-medium text-ink-2 underline underline-offset-2"
              >
                Afinal não vai poder ir
              </button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                {jogo.confirmationRequired
                  ? "O clube pede que confirmes a presença."
                  : "Contamos com ele. Só precisas de responder se não puder ir."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {jogo.confirmationRequired && <Responder jogo={jogo} going label="Vai" />}
                <button
                  type="button"
                  onClick={() => setARecusar(true)}
                  className={cx(
                    "rounded-full px-4 py-2 text-[14px] font-semibold",
                    jogo.confirmationRequired ? "bg-sunken text-ink-2" : "bg-ink text-white",
                  )}
                >
                  Não vai poder ir
                </button>
              </div>
            </>
          )}

          {aRecusar && <Recusar jogo={jogo} onFechar={() => setARecusar(false)} />}
        </>
      )}
    </section>
  );
}

/** Um botão que responde "vai" — a confirmação, ou o desfazer de uma recusa. */
function Responder({ jogo, going, label, ghost }: { jogo: Match; going: boolean; label: string; ghost?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function responder() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await responderConvocatoria(jogo.matchId, jogo.childId, { going });
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível responder.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void responder()}
        className={cx(
          ghost
            ? "mt-2 text-[13px] font-medium text-ink-2 underline underline-offset-2"
            : "rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white",
        )}
      >
        {busy ? "A enviar…" : label}
      </button>
      {erro && <p className="mt-1.5 text-[13px] text-risk">{erro}</p>}
    </>
  );
}

/**
 * Dizer que não vai — e porquê.
 *
 * O motivo é obrigatório, e a explicação de porquê está no ecrã: um treinador
 * que lê "não vai" sem mais nada não sabe se procura substituto ou se telefona
 * a perguntar se está tudo bem. Não é burocracia — é a diferença entre uma
 * ausência tratada e um telefonema no sábado de manhã.
 */
function Recusar({ jogo, onFechar }: { jogo: Match; onFechar: () => void }) {
  const [motivo, setMotivo] = useState(jogo.reply?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pronto = motivo.trim().length >= 3;

  async function enviar() {
    if (!pronto || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await responderConvocatoria(jogo.matchId, jogo.childId, { going: false, reason: motivo.trim() });
      await reload();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-[var(--radius-lg)] bg-sunken p-3.5">
      <label className="block text-[13px] font-semibold text-ink" htmlFor="motivo-falta">
        Porque é que não vai?
      </label>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
        O treinador precisa de saber para decidir a equipa. Uma linha chega.
      </p>
      <textarea
        id="motivo-falta"
        autoFocus
        rows={2}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={300}
        placeholder="Está doente. / Tem prova na escola. / Está fora com a família."
        className="mt-2 w-full resize-y rounded-[var(--radius-lg)] border border-ink/10 bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink outline-none focus:border-ink/25"
      />

      {erro && <p className="mt-1.5 text-[13px] text-risk">{erro}</p>}

      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={onFechar} className="rounded-full bg-surface px-4 py-2 text-[13px] font-semibold text-ink-2">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!pronto || busy}
          onClick={() => void enviar()}
          className="flex-1 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "A enviar…" : "Avisar o clube"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NaoExiste({ onBack }: { onBack: () => void }) {
  return (
    <div className="mt-10 rounded-[var(--radius-xl)] bg-surface p-10 text-center shadow-[var(--shadow-soft)]">
      <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">
        <CalendarOff className="size-6" strokeWidth={1.75} />
      </span>
      <p className="text-[15px] font-semibold text-ink">Este evento já não existe</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
        Pode ter sido desmarcado, ou ser de outro filho — troca lá em cima.
      </p>
      <button type="button" onClick={onBack} className="mt-4 rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white">
        Ver a agenda
      </button>
    </div>
  );
}