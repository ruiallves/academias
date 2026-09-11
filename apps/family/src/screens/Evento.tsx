import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CalendarOff,
  Check,
  ChevronLeft,
  Clock,
  DoorOpen,
  Hourglass,
  MapPin,
  Minus,
  StickyNote,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { useChild } from "@/App";
import { reload, useStore, type CallUpState, type Match, type Training } from "@/lib/store";
import { responderConvocatoria } from "@/lib/convocatoria";
import { avisarAusencia, retirarAviso } from "@/lib/ausencia";
import { cx, dayName, dateShort, time } from "@/ui";

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
      {treino && !cancelado && <Ausencia treino={treino} />}

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

/**
 * Onde é que este filho está, nesta convocatória.
 *
 * Quatro estados, e são precisos os quatro: "ainda não se sabe" e "ficou de
 * fora" são coisas diferentes para quem lê, e juntá-las dizia a um pai que o
 * filho tinha sido cortado de uma lista que ainda ninguém fez.
 */
const ESTADO: Record<
  CallUpState,
  { rotulo: string; explicacao: string; icone: typeof Check; cor: string; fundo: string }
> = {
  pending: {
    rotulo: "Convocatória por lançar",
    explicacao: "O clube ainda não fechou a lista. Recebes uma notificação assim que fechar.",
    icone: Hourglass,
    cor: "text-ink-3",
    fundo: "bg-sunken",
  },
  out: {
    rotulo: "Não convocado",
    explicacao: "A lista deste jogo já saiu, e desta vez não ficou nela.",
    icone: Minus,
    cor: "text-warn",
    fundo: "bg-warn-soft",
  },
  in: {
    rotulo: "Convocado",
    explicacao: "",
    icone: Trophy,
    cor: "text-ok",
    fundo: "bg-ok-soft",
  },
  cancelled: {
    rotulo: "Jogo cancelado",
    explicacao: "Este jogo foi desmarcado.",
    icone: CalendarOff,
    cor: "text-risk",
    fundo: "bg-risk-soft",
  },
};

/**
 * O estado da convocatória, e a resposta da família.
 *
 * ## Assume-se que vai
 *
 * Sem confirmação pedida há **um** botão, discreto, a dizer "Não vai poder ir".
 * Obrigar toda a gente a carregar em "vou" em todos os jogos ensina as famílias
 * a carregar sem ler — e aí a confirmação deixa de valer nada justamente no
 * jogo em que era precisa.
 *
 * Com confirmação pedida há dois, e o "Vai jogar" é o principal: nesse jogo o
 * clube está à espera de uma resposta, e o ecrã tem de o dizer em vez de o
 * esconder numa frase.
 *
 * ## Uma resposta dada fica à vista
 *
 * Um pai que avisou na terça e abre a app na sexta tem de ver o que disse —
 * senão fica na dúvida se chegou a carregar e volta a escrever ao treinador,
 * que é o que isto veio evitar. Daí o cartão de estado com a hora da resposta e
 * uma saída discreta para a mudar.
 */
function Convocatoria({ jogo }: { jogo: Match }) {
  const meta = ESTADO[jogo.callUp];
  const Icone = meta.icone;
  const [aRecusar, setARecusar] = useState(false);

  const respondeu = jogo.reply;
  const porResponder = jogo.callUp === "in" && !respondeu;

  return (
    <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
      {/* A faixa de estado: um facto, lido de relance, com o peso de um título. */}
      <div className="flex items-start gap-3 p-4">
        <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-[14px]", meta.fundo, meta.cor)}>
          <Icone className="size-[21px]" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">
            {meta.rotulo}
          </span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">
            {meta.explicacao ||
              (respondeu
                ? respondeu.going
                  ? "Disseste que vai."
                  : "Disseste que não vai."
                : jogo.confirmationRequired
                  ? "O clube pede que confirmes a presença."
                  : "Contamos com ele. Só precisas de responder se não puder ir.")}
          </span>
        </span>
      </div>

      {jogo.callUp === "in" && (
        <div className="border-t border-ink/5 p-4">
          {respondeu && !respondeu.going && (
            <RespostaDada
              tom="risk"
              icone={X}
              titulo="Não vai a este jogo"
              detalhe={respondeu.reason ?? ""}
              quando={respondeu.at}
            >
              <Responder jogo={jogo} going label="Afinal vai" />
            </RespostaDada>
          )}

          {respondeu?.going && (
            <RespostaDada tom="ok" icone={Check} titulo="Presença confirmada" quando={respondeu.at}>
              <button
                type="button"
                onClick={() => setARecusar(true)}
                className="text-[13px] font-semibold text-ink-2 underline underline-offset-2"
              >
                Afinal não vai poder ir
              </button>
            </RespostaDada>
          )}

          {porResponder && !aRecusar && (
            <div className={cx("grid gap-2", jogo.confirmationRequired && "grid-cols-2")}>
              {jogo.confirmationRequired && <Responder jogo={jogo} going label="Vai jogar" destaque />}
              <button
                type="button"
                onClick={() => setARecusar(true)}
                className={jogo.confirmationRequired ? "cta-quiet" : "cta-quiet w-full"}
              >
                Não vai poder ir
              </button>
            </div>
          )}

          {aRecusar && <Recusar jogo={jogo} onFechar={() => setARecusar(false)} />}
        </div>
      )}
    </section>
  );
}

/** O cartão de uma resposta já dada — o que se disse, quando, e como mudar. */
function RespostaDada({
  tom,
  icone: Icone,
  titulo,
  detalhe,
  quando,
  children,
}: {
  tom: "ok" | "risk";
  icone: typeof Check;
  titulo: string;
  detalhe?: string;
  quando: Date;
  children: ReactNode;
}) {
  return (
    <div className={cx("rounded-[var(--radius-lg)] p-3.5", tom === "ok" ? "bg-ok-soft" : "bg-risk-soft")}>
      <p className={cx("flex items-center gap-1.5 text-[14px] font-semibold", tom === "ok" ? "text-ok" : "text-risk")}>
        <Icone className="size-4 shrink-0" strokeWidth={2.5} />
        {titulo}
      </p>
      {detalhe && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{detalhe}</p>}
      <p className="mt-1 text-[12px] text-ink-3">
        Respondeste {dayName(quando).toLowerCase()}, {dateShort(quando)} às {time(quando)}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Um botão que responde "vai" — a confirmação, ou o desfazer de uma recusa. */
function Responder({ jogo, going, label, destaque }: { jogo: Match; going: boolean; label: string; destaque?: boolean }) {
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
        className={destaque ? "cta w-full" : "text-[13px] font-semibold text-ink-2 underline underline-offset-2"}
      >
        {destaque && !busy && <Check className="size-[18px]" strokeWidth={2.4} />}
        {busy ? "A enviar…" : label}
      </button>
      {erro && <p className="mt-1.5 text-[13px] text-risk">{erro}</p>}
    </>
  );
}

/**
 * Os motivos que se repetem, num toque — **só na recusa de convocatória**.
 *
 * Escrever num telemóvel é o passo onde as pessoas desistem, e faltar a um jogo
 * é a ausência que custa ao treinador: quatro botões cobrem quase tudo o que
 * acontece a sério e poupam o "n vai" que não explica nada. Continua a dar para
 * escrever — os botões preenchem a caixa, não a substituem.
 *
 * No aviso de falta a um **treino** não há sugestões nenhumas: são dezenas por
 * época, e uma lista de motivos à mão convida a carregar sempre no primeiro.
 */
const MOTIVOS = ["Está doente", "Tem prova na escola", "Está fora com a família", "Lesionado"];

/**
 * Dizer que não vai — e porquê.
 *
 * O motivo é obrigatório, e a razão está no ecrã: um treinador que lê "não vai"
 * sem mais nada não sabe se procura substituto ou se telefona a perguntar se
 * está tudo bem. Não é burocracia — é a diferença entre uma ausência tratada e
 * um telefonema no sábado de manhã.
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
    <div className="rounded-[var(--radius-lg)] bg-sunken p-3.5">
      <p className="text-[14px] font-semibold text-ink">Porque é que não vai?</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
        O treinador precisa de saber para decidir a equipa.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMotivo(m)}
            aria-pressed={motivo === m}
            className={cx(
              "rounded-full px-3 py-1.5 text-[13px] font-medium",
              motivo === m ? "bg-ink text-surface" : "bg-surface text-ink-2",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <textarea
        id="motivo-falta"
        rows={2}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={300}
        placeholder="Ou escreve o motivo"
        aria-label="Motivo da ausência"
        className="mt-2 w-full resize-y rounded-[var(--radius-md)] border border-ink/10 bg-surface px-3 py-2.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-ink/25"
      />

      {erro && <p className="mt-1.5 text-[13px] text-risk">{erro}</p>}

      <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={onFechar} className="cta-quiet px-5">
          Cancelar
        </button>
        <button type="button" disabled={!pronto || busy} onClick={() => void enviar()} className="cta">
          {busy ? "A enviar…" : "Avisar o clube"}
        </button>
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* O treino: avisar que não vai                                                */
/* -------------------------------------------------------------------------- */

/**
 * O irmão da `Convocatoria`, para os treinos.
 *
 * ## Porque é mais simples do que um jogo
 *
 * Num jogo há uma convocatória: estar na lista é um facto que se mostra, e a
 * resposta pode ser "vai" ou "não vai". Num treino vai o plantel todo — não há
 * lista, não há nada a confirmar, e **o silêncio é presença**. Por isso aqui não
 * há dois botões nem estado nenhum a desenhar: há um aviso, que se dá e se
 * retira.
 *
 * ## Depois de a folha estar fechada, não
 *
 * O treinador já registou quem faltou; um aviso a chegar depois disso não avisa
 * ninguém e só serviria para discutir uma falta já lançada. O servidor recusa-o,
 * e o ecrã não o oferece — em vez de um botão que dá erro.
 */
function Ausencia({ treino }: { treino: Training }) {
  const [aAvisar, setAAvisar] = useState(false);
  const jaPassou = treino.end <= new Date();

  if (treino.recorded || (jaPassou && !treino.notice)) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-soft)]">
      {treino.notice ? (
        <>
          {/*
            Cartão próprio, e não o `RespostaDada` dos jogos: aquele diz
            "Respondeste", que é verdade para quem respondeu a uma convocatória e
            falso para quem avisou sem ninguém ter perguntado.
          */}
          <div className="rounded-[var(--radius-lg)] bg-risk-soft p-3.5">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-risk">
              <X className="size-4 shrink-0" strokeWidth={2.5} />
              Avisaste que não vai
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{treino.notice.reason}</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Avisaste {dayName(treino.notice.at).toLowerCase()}, {dateShort(treino.notice.at)} às{" "}
              {time(treino.notice.at)}
            </p>
          </div>
          {!jaPassou && !aAvisar && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAAvisar(true)} className="cta-quiet">
                Mudar o motivo
              </button>
              <Retirar treino={treino} />
            </div>
          )}
        </>
      ) : (
        !aAvisar && (
          <>
            <p className="text-[15px] leading-relaxed text-ink-2">
              Não vai poder ir a este treino? Avisa o treinador por aqui.
            </p>
            <button type="button" onClick={() => setAAvisar(true)} className="cta-quiet mt-3 w-full">
              Não vai poder ir
            </button>
          </>
        )
      )}

      {aAvisar && <Avisar treino={treino} onFechar={() => setAAvisar(false)} />}
    </section>
  );
}

/**
 * Dizer que não vai a um treino — e porquê.
 *
 * Sem os atalhos da recusa de convocatória, de propósito: um jogo é uma vez por
 * semana e um treino são três, e uma lista de motivos à mão acaba a ser sempre
 * o primeiro botão. Escrito à mão, o treinador lê uma coisa que é verdade.
 */
function Avisar({ treino, onFechar }: { treino: Training; onFechar: () => void }) {
  const [motivo, setMotivo] = useState(treino.notice?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pronto = motivo.trim().length >= 3;

  async function enviar() {
    if (!pronto || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await avisarAusencia(treino.sessionId, treino.childId, motivo.trim());
      await reload();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-[var(--radius-lg)] bg-sunken p-3.5">
      <p className="text-[14px] font-semibold text-ink">Porque é que não vai?</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
        O treinador precisa de saber para contar com ele ou não.
      </p>

      <textarea
        rows={2}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={200}
        placeholder="Escreve o motivo"
        aria-label="Motivo da ausência ao treino"
        className="mt-2 w-full resize-y rounded-[var(--radius-md)] border border-ink/10 bg-surface px-3 py-2.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-ink/25"
      />

      {erro && <p className="mt-1.5 text-[13px] text-risk">{erro}</p>}

      <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={onFechar} className="cta-quiet px-5">
          Cancelar
        </button>
        <button type="button" disabled={!pronto || busy} onClick={() => void enviar()} className="cta">
          {busy ? "A enviar…" : "Avisar o clube"}
        </button>
      </div>
    </div>
  );
}

/** Afinal vai. O aviso desaparece — ver `AbsenceNotice`, do lado do servidor. */
function Retirar({ treino }: { treino: Training }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await retirarAviso(treino.sessionId, treino.childId);
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível retirar o aviso.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => void enviar()} className="cta">
        {busy ? "Um momento…" : "Afinal vai"}
      </button>
      {erro && <p className="col-span-2 mt-1.5 text-[13px] text-risk">{erro}</p>}
    </>
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