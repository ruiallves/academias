import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, EyeOff, Lock, ShieldAlert, UserRound } from "lucide-react";
import { useStore } from "@/lib/store";
import { categorias as carregarCategorias, enviarDenuncia, type Categoria } from "@/lib/conduta";
import { cx } from "@/ui";

/**
 * Enviar uma denúncia.
 *
 * ## Um passo de cada vez
 *
 * Primeiro o tipo de situação, em botões grandes: é a pergunta mais fácil e
 * põe a pessoa a andar. Depois o que aconteceu, numa caixa só, com os
 * pormenores (quando, onde, quem) por baixo e opcionais. Por fim a pergunta
 * que decide muita coisa, e que por isso fica em último, quando o texto já
 * está escrito: identificar-se ou não.
 *
 * Nada aqui grava sozinho. O botão do fim diz o que vai acontecer ("Enviar à
 * direção") e, enviado, o ecrã confirma e leva ao caso, onde as respostas vão
 * chegar.
 */

const MIN = 20;

export default function NovaDenuncia() {
  const store = useStore();
  const navigate = useNavigate();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [athleteId, setAthleteId] = useState<string | null>(store.atleta ? null : (store.children.length === 1 ? store.children[0].id : null));
  const [happenedOn, setHappenedOn] = useState("");
  const [place, setPlace] = useState("");
  const [involved, setInvolved] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    carregarCategorias().then(setCategorias).catch(() => setCategorias([]));
  }, []);

  const faltaCategoria = category === null;
  const faltaTexto = description.trim().length < MIN;
  const hoje = new Date().toISOString().slice(0, 10);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setTentou(true);
    if (faltaCategoria || faltaTexto || busy) return;
    setBusy(true);
    setErro(null);
    try {
      const caso = await enviarDenuncia({
        category: category!,
        anonymous,
        athleteId: store.atleta ? null : athleteId,
        happenedOn: happenedOn || null,
        place: place.trim() || null,
        involved: involved.trim() || null,
        description: description.trim(),
      });
      navigate(`/denuncia/${caso.id}?enviada=1`, { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível enviar. Tenta outra vez.");
      setBusy(false);
    }
  }

  const campo = "w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-3 text-[15px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none";

  return (
    <form onSubmit={enviar} className="pt-2" noValidate>
      <button type="button" onClick={() => navigate(-1)} className="-ml-2 mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[14px] font-medium text-ink-2">
        <ChevronLeft className="size-4" strokeWidth={2.2} />
        Voltar
      </button>

      <header className="px-1">
        <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Canal de denúncia</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">O que aconteceu?</h1>
      </header>

      {/* 1. O tipo de situação. */}
      <section className="mt-5">
        <Rotulo n={1} texto="A situação é de" />
        <div role="radiogroup" aria-label="Tipo de situação" className="grid grid-cols-2 gap-2">
          {categorias.map((c) => {
            const on = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setCategory(c.key)}
                className={cx(
                  "min-h-12 rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-[14px] font-semibold leading-snug transition-colors duration-150",
                  on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink active:bg-sunken",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {tentou && faltaCategoria && <Aviso>Escolhe o tipo de situação.</Aviso>}
      </section>

      {/* 2. O que aconteceu. */}
      <section className="mt-6">
        <Rotulo n={2} texto="Conta o que aconteceu" />
        <label htmlFor="denuncia-texto" className="sr-only">
          O que aconteceu
        </label>
        <textarea
          id="denuncia-texto"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={5000}
          placeholder="Com as tuas palavras. O que viste ou te contaram, e como ficaste a saber."
          className={cx(campo, "resize-y leading-relaxed")}
          aria-invalid={tentou && faltaTexto}
        />
        <div className="mt-1 flex items-center justify-between px-1 text-[12px] text-ink-4">
          <span>{tentou && faltaTexto ? <span className="text-risk">Conta um pouco mais: pelo menos {MIN} caracteres.</span> : "Quanto mais concreto, mais fácil é ao clube agir."}</span>
          <span className="num">{description.trim().length}</span>
        </div>

        <details className="mt-3 rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
          <summary className="cursor-pointer select-none px-4 py-3.5 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
            Pormenores <span className="font-normal text-ink-3">(se souberes)</span>
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-4">
            {!store.atleta && store.children.length > 0 && (
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Sobre qual dos teus educandos?</span>
                <div className="flex flex-wrap gap-2">
                  {store.children.map((c) => (
                    <button key={c.id} type="button" onClick={() => setAthleteId(athleteId === c.id ? null : c.id)} aria-pressed={athleteId === c.id} className={cx("h-10 rounded-full border px-3.5 text-[14px] font-medium", athleteId === c.id ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink")}>
                      {c.firstName}
                    </button>
                  ))}
                  <button type="button" onClick={() => setAthleteId(null)} aria-pressed={athleteId === null} className={cx("h-10 rounded-full border px-3.5 text-[14px] font-medium", athleteId === null ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink")}>
                    Nenhum em especial
                  </button>
                </div>
              </div>
            )}
            <div>
              <label htmlFor="denuncia-quando" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Quando
              </label>
              <input id="denuncia-quando" type="date" max={hoje} value={happenedOn} onChange={(e) => setHappenedOn(e.target.value)} className={campo} />
            </div>
            <div>
              <label htmlFor="denuncia-onde" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Onde
              </label>
              <input id="denuncia-onde" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} placeholder="No balneário, no autocarro, no treino de terça…" className={campo} />
            </div>
            <div>
              <label htmlFor="denuncia-quem" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Quem esteve envolvido
              </label>
              <input id="denuncia-quem" value={involved} onChange={(e) => setInvolved(e.target.value)} maxLength={200} placeholder="Nomes ou descrição, como souberes" className={campo} />
            </div>
          </div>
        </details>
      </section>

      {/* 3. Identificar-se ou não. */}
      <section className="mt-6">
        <Rotulo n={3} texto="O clube pode saber quem és?" />
        <div role="radiogroup" aria-label="Identificação" className="space-y-2">
          <Escolha on={!anonymous} onClick={() => setAnonymous(false)} icone={UserRound} titulo={`Sim, sou ${store.guardian.firstName}`} texto="A direção vê o teu nome e pode falar contigo diretamente." />
          <Escolha on={anonymous} onClick={() => setAnonymous(true)} icone={EyeOff} titulo="Não, prefiro não ser identificado" texto="O clube não vê quem enviou. As respostas chegam-te aqui na app, na mesma." />
        </div>
      </section>

      {erro && (
        <p role="alert" className="mt-4 rounded-[var(--radius-md)] bg-risk-soft px-4 py-3 text-[13px] leading-relaxed text-risk">
          {erro}
        </p>
      )}

      <div className="mt-6 space-y-3">
        <button type="submit" disabled={busy} className="cta flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold">
          {busy ? (
            "A enviar…"
          ) : (
            <>
              <ShieldAlert className="size-[18px]" strokeWidth={2} />
              Enviar à direção
            </>
          )}
        </button>
        <p className="flex items-start justify-center gap-1.5 px-2 text-center text-[12px] leading-relaxed text-ink-4">
          <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          Só quem trata das denúncias no clube lê isto. Nunca os treinadores.
        </p>
      </div>
    </form>
  );
}

function Rotulo({ n, texto }: { n: number; texto: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2 px-1">
      <span className="flex size-6 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-surface">{n}</span>
      <span className="text-[15px] font-semibold text-ink">{texto}</span>
    </div>
  );
}

function Aviso({ children }: { children: string }) {
  return (
    <p role="alert" className="mt-2 px-1 text-[12px] text-risk">
      {children}
    </p>
  );
}

function Escolha({ on, onClick, icone: Icone, titulo, texto }: { on: boolean; onClick: () => void; icone: typeof EyeOff; titulo: string; texto: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cx(
        "flex w-full items-start gap-3 rounded-[var(--radius-lg)] border p-4 text-left transition-colors duration-150",
        on ? "border-ink bg-surface shadow-[var(--shadow-soft)]" : "border-transparent bg-surface/70",
      )}
    >
      <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-full", on ? "bg-ink text-surface" : "bg-sunken text-ink-3")}>
        {on ? <Check className="size-[18px]" strokeWidth={2.4} /> : <Icone className="size-[18px]" strokeWidth={1.9} />}
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold text-ink">{titulo}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-3">{texto}</span>
      </span>
    </button>
  );
}
