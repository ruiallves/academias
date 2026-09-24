import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarOff, Check, ChevronLeft, Clock, Hourglass, MapPin, StickyNote, Stethoscope, X } from "lucide-react";
import { reload, useStore, type Appointment } from "@/lib/store";
import { responderConsulta } from "@/lib/consulta";
import { cx, dateShort, dayName, time } from "@/ui";

/**
 * Uma consulta marcada.
 *
 * O que o clube marcou (dia, hora, sítio e a nota que deixou) e, quando pediu
 * confirmação, os botões para dizer se vai. É o mesmo gesto da convocatória:
 * quem responde é um só, e quem não é vê a consulta sem botões.
 *
 * Procura-se em todos os educandos e não só no escolhido lá em cima: o aviso
 * pode ser do irmão, e abrir "esta consulta já não existe" por causa disso era
 * mentir.
 */
export default function Consulta() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const navigate = useNavigate();

  const achada = store.children.flatMap((c) => c.appointments.map((a) => ({ c, a }))).find((x) => x.a.id === id);

  if (!achada) {
    return (
      <div className="mt-10 rounded-[var(--radius-xl)] bg-surface p-10 text-center shadow-[var(--shadow-soft)]">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-sunken text-ink-3">
          <CalendarOff className="size-6" strokeWidth={1.75} />
        </span>
        <p className="text-[15px] font-semibold text-ink">Esta consulta já não está marcada</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">Pode ter sido desmarcada, ou já ter passado.</p>
        <button type="button" onClick={() => navigate("/")} className="mt-4 rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white">
          Voltar ao início
        </button>
      </div>
    );
  }

  const { c: child, a } = achada;

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
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Consulta</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{a.title}</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {!store.atleta && store.children.length > 1 ? `${child.firstName} · ` : ""}
          {dayName(a.date)}, {dateShort(a.date)}
          {a.time ? ` · ${a.time}` : ""}
        </p>
      </header>

      {a.confirmationRequired && <Confirmacao consulta={a} />}

      <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
        <Facto icone={Stethoscope} rotulo="Consulta" valor={a.title} />
        <Facto icone={Clock} rotulo="Quando" valor={`${dayName(a.date)}, ${dateShort(a.date)}${a.time ? ` às ${a.time}` : ""}`} />
        {a.location && <Facto icone={MapPin} rotulo="Onde" valor={a.location} />}
        {a.note && <Facto icone={StickyNote} rotulo="Nota do clube" valor={a.note} />}
      </section>
    </div>
  );
}

function Facto({ icone: Icone, rotulo, valor }: { icone: typeof MapPin; rotulo: string; valor: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-ink/5 px-4 py-3 last:border-0">
      <Icone className="mt-0.5 size-[18px] shrink-0 text-ink-4" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink-3">{rotulo}</span>
        <span className="block text-[15px] font-medium whitespace-pre-line text-ink">{valor}</span>
      </span>
    </div>
  );
}

/**
 * Vai ou não vai.
 *
 * Aqui, ao contrário da convocatória, o silêncio não é presença: o clube pediu
 * confirmação porque precisa de saber. Por isso há dois botões lado a lado, e a
 * recusa pede o motivo.
 */
function Confirmacao({ consulta }: { consulta: Appointment }) {
  const { atleta } = useStore();
  const [aRecusar, setARecusar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const souQuemResponde = atleta ? consulta.respondBy === "ATHLETE" : consulta.respondBy === "GUARDIAN";
  const r = consulta.reply;

  async function confirmar() {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await responderConsulta(consulta.id, { going: true });
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível responder.");
    } finally {
      setBusy(false);
    }
  }

  const estado = r
    ? r.going
      ? { icone: Check, fundo: "bg-ok-soft", cor: "text-ok", titulo: "Presença confirmada" }
      : { icone: X, fundo: "bg-risk-soft", cor: "text-risk", titulo: atleta ? "Disseste que não vais" : "Disseste que não vai" }
    : { icone: Hourglass, fundo: "bg-warn-soft", cor: "text-warn", titulo: "O clube pede confirmação" };
  const Icone = estado.icone;

  return (
    <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-3 p-4">
        <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-[14px]", estado.fundo, estado.cor)}>
          <Icone className="size-[21px]" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">{estado.titulo}</span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">
            {r
              ? r.going
                ? `Respondeste ${dayName(r.at).toLowerCase()}, ${dateShort(r.at)} às ${time(r.at)}.`
                : r.reason ?? ""
              : !souQuemResponde
                ? consulta.respondBy === "ATHLETE"
                  ? "Nesta consulta é o atleta que responde."
                  : "Quem responde é o encarregado de educação."
                : atleta
                  ? "Diz se vais, para o clube contar contigo."
                  : "Diz se vai, para o clube contar com ele."}
          </span>
        </span>
      </div>

      {souQuemResponde && (
        <div className="border-t border-ink/5 p-4">
          {aRecusar ? (
            <Recusar consulta={consulta} onFechar={() => setARecusar(false)} />
          ) : r ? (
            <button
              type="button"
              onClick={() => (r.going ? setARecusar(true) : void confirmar())}
              disabled={busy}
              className="text-[13px] font-semibold text-ink-2 underline underline-offset-2"
            >
              {busy ? "A enviar…" : r.going ? (atleta ? "Afinal não vou poder ir" : "Afinal não vai poder ir") : atleta ? "Afinal vou" : "Afinal vai"}
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => void confirmar()} className="cta w-full">
                {!busy && <Check className="size-[18px]" strokeWidth={2.4} />}
                {busy ? "A enviar…" : atleta ? "Vou" : "Vai"}
              </button>
              <button type="button" onClick={() => setARecusar(true)} className="cta-quiet">
                {atleta ? "Não posso ir" : "Não pode ir"}
              </button>
            </div>
          )}
          {erro && <p className="mt-1.5 text-[13px] text-risk">{erro}</p>}
        </div>
      )}
    </section>
  );
}

/** O motivo é obrigatório: é o que diz ao clube se remarca ou se telefona. */
function Recusar({ consulta, onFechar }: { consulta: Appointment; onFechar: () => void }) {
  const { atleta } = useStore();
  const [motivo, setMotivo] = useState(consulta.reply?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pronto = motivo.trim().length >= 3;

  async function enviar() {
    if (!pronto || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await responderConsulta(consulta.id, { going: false, reason: motivo.trim() });
      await reload();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] bg-sunken p-3.5">
      <p className="text-[14px] font-semibold text-ink">{atleta ? "Porque é que não podes ir?" : "Porque é que não pode ir?"}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">O clube precisa de saber para remarcar.</p>
      <textarea
        rows={2}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={300}
        placeholder="Escreve o motivo"
        aria-label="Motivo"
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
