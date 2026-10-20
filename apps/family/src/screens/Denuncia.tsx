import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, EyeOff, Send, ShieldAlert } from "lucide-react";
import { FRASE_DO_ESTADO, responder, verDenuncia, type DenunciaCompleta } from "@/lib/conduta";
import { cx, dateShort, time } from "@/ui";

/**
 * Um caso: o que se enviou, o estado em que está e a conversa com o clube.
 *
 * Acabado de enviar (`?enviada=1`), abre com a confirmação em cima: é o único
 * momento em que a pessoa precisa de ouvir "chegou". Depois disso é uma
 * conversa, com as mensagens do clube de um lado e as da pessoa do outro.
 */
export default function Denuncia() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [caso, setCaso] = useState<DenunciaCompleta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const enviada = params.get("enviada") === "1";

  const carregar = () => {
    if (!id) return;
    verDenuncia(id)
      .then(setCaso)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível abrir o caso."));
  };
  useEffect(carregar, [id]);
  useEffect(() => {
    if (caso && caso.messages.length > 0) fim.current?.scrollIntoView({ block: "nearest" });
  }, [caso?.messages.length]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!id || !texto.trim() || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await responder(id, texto.trim());
      setTexto("");
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  if (erro && !caso) {
    return (
      <div className="mt-10 rounded-[var(--radius-xl)] bg-surface p-10 text-center shadow-[var(--shadow-soft)]">
        <p className="text-[15px] font-semibold text-ink">Não foi possível abrir o caso</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{erro}</p>
        <button type="button" onClick={() => navigate("/denuncias")} className="mt-4 rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white">
          Voltar às denúncias
        </button>
      </div>
    );
  }
  if (!caso) return null;

  const fechado = caso.status === "RESOLVED" || caso.status === "ARCHIVED";

  return (
    <div className="pt-2">
      <button type="button" onClick={() => navigate("/denuncias")} className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2">
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Denúncias
      </button>

      {enviada && (
        <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-lg)] bg-ok-soft p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ok text-white">
            <Check className="size-[18px]" strokeWidth={2.6} />
          </span>
          <div className="min-w-0">
            <p className="text-body font-semibold text-ink">A tua denúncia chegou à direção.</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">Quando o clube responder, recebes uma notificação e a resposta aparece aqui.</p>
          </div>
        </div>
      )}

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Caso #{caso.number}</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{caso.categoryLabel}</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {FRASE_DO_ESTADO[caso.status]} · {dateShort(new Date(caso.createdAt))}
        </p>
      </header>

      <section className="mt-4 overflow-hidden rounded-[var(--radius-xl)] bg-surface shadow-[var(--shadow-soft)]">
        <div className="px-4 pt-4 pb-3">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{caso.description}</p>
        </div>
        {(caso.happenedOn || caso.place || caso.involved || caso.athlete) && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line px-4 py-3">
            {caso.athlete && <Facto rotulo="Educando" valor={caso.athlete.name} />}
            {caso.happenedOn && <Facto rotulo="Quando" valor={dateShort(new Date(`${caso.happenedOn}T12:00:00`))} />}
            {caso.place && <Facto rotulo="Onde" valor={caso.place} />}
            {caso.involved && <Facto rotulo="Envolvidos" valor={caso.involved} />}
          </dl>
        )}
        <div className="flex items-center gap-2 border-t border-line bg-sunken/50 px-4 py-2.5 text-[12px] text-ink-3">
          {caso.anonymous ? <EyeOff className="size-3.5 shrink-0" strokeWidth={1.75} /> : <ShieldAlert className="size-3.5 shrink-0" strokeWidth={1.75} />}
          {caso.anonymous ? "Enviada sem identificação: o clube não vê quem és." : "Enviada com o teu nome: a direção pode falar contigo."}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Conversa com o clube</h2>
        {caso.messages.length === 0 ? (
          <p className="px-1 text-[13px] leading-relaxed text-ink-3">Ainda sem resposta. Podes acrescentar mais informação aqui em baixo.</p>
        ) : (
          <ol className="space-y-2.5">
            {caso.messages.map((m) => (
              <li key={m.id} className={cx("flex", m.fromStaff ? "justify-start" : "justify-end")}>
                <div className={cx("max-w-[86%] rounded-[18px] px-4 py-3", m.fromStaff ? "rounded-bl-[6px] bg-surface shadow-[var(--shadow-soft)]" : "rounded-br-[6px] bg-ink text-surface")}>
                  <p className={cx("text-[11.5px] font-medium", m.fromStaff ? "text-ink-3" : "text-surface/70")}>
                    {m.fromStaff ? (m.authorName ?? "O clube") : "Tu"} · {dateShort(new Date(m.createdAt))}, {time(new Date(m.createdAt))}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{m.body}</p>
                </div>
              </li>
            ))}
            <div ref={fim} />
          </ol>
        )}

        {fechado ? (
          <p className="mt-4 rounded-[var(--radius-md)] bg-sunken px-4 py-3 text-center text-[13px] leading-relaxed text-ink-3">
            Este caso está fechado. Se houver algo novo, envia uma nova denúncia.
          </p>
        ) : (
          <form onSubmit={enviar} className="mt-4 flex items-end gap-2">
            <label htmlFor="denuncia-resposta" className="sr-only">
              Escrever ao clube
            </label>
            <textarea
              id="denuncia-resposta"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={2}
              maxLength={3000}
              placeholder="Escrever ao clube…"
              className="min-h-12 flex-1 resize-none rounded-[22px] border border-line bg-surface px-4 py-3 text-[15px] leading-snug text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none"
            />
            <button type="submit" disabled={!texto.trim() || busy} aria-label="Enviar" className="cta flex size-12 shrink-0 items-center justify-center rounded-full">
              <Send className="size-[18px]" strokeWidth={2} />
            </button>
          </form>
        )}
        {erro && (
          <p role="alert" className="mt-2 px-1 text-[12px] text-risk">
            {erro}
          </p>
        )}
      </section>
    </div>
  );
}

function Facto({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-4">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-[14px] text-ink-2">{valor}</dd>
    </div>
  );
}
