import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Minus, Plus, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "@/lib/http";
import { cx } from "@/ui";

/**
 * As notas da escola — a secção "Escola" do ecrã do educando.
 *
 * ## Para que serve
 *
 * O clube quer saber como vai a escola dos miúdos que treina, e até aqui pedia
 * a ficha de avaliação em papel. Aqui o encarregado submete as notas: **o
 * período, a disciplina e a nota**. O clube lê-as na ficha do atleta; só o
 * encarregado as escreve, e só as dos seus educandos — é o servidor que o
 * garante, e é ele que diz em `editable` se há botão.
 *
 * ## O gesto
 *
 * Uma pauta tem dez disciplinas, e dez formulários iguais seguidos são dez
 * oportunidades para desistir. Por isso a folha **não fecha ao gravar**: fica
 * no mesmo período e na mesma escala, limpa a disciplina, e está pronta para a
 * seguinte. As disciplinas mais comuns estão a um toque, e as que já foram
 * submetidas neste período saem da lista de sugestões.
 *
 * Tocar numa nota abre-a para corrigir ou apagar. Submeter outra vez a mesma
 * disciplina no mesmo período corrige a que lá estava.
 */

type Nota = {
  id: string;
  schoolYear: string;
  period: string;
  subject: string;
  grade: number;
  scale: number;
};

const PERIODOS: { key: string; label: string; curto: string }[] = [
  { key: "1P", label: "1.º período", curto: "1.º P" },
  { key: "2P", label: "2.º período", curto: "2.º P" },
  { key: "3P", label: "3.º período", curto: "3.º P" },
  { key: "1S", label: "1.º semestre", curto: "1.º S" },
  { key: "2S", label: "2.º semestre", curto: "2.º S" },
];
const nomeDoPeriodo = (k: string) => PERIODOS.find((p) => p.key === k)?.label ?? k;

const SUGESTOES = [
  "Português", "Matemática", "Inglês", "Estudo do Meio", "Ciências Naturais", "Físico-Química",
  "História", "Geografia", "Educação Física", "Educação Visual", "Francês", "TIC",
];

/** O ano lectivo de hoje: vira em Agosto, como no servidor. */
function anoLectivoDeHoje(): string {
  const d = new Date();
  const ano = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

const negativa = (n: { grade: number; scale: number }) => (n.scale === 5 ? n.grade < 3 : n.grade < 10);
const chave = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function NotasDaEscola({ childId, childName }: { childId: string; childName: string }) {
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [editable, setEditable] = useState(false);
  const [aberta, setAberta] = useState<Nota | "nova" | null>(null);

  const carregar = useCallback(() => {
    apiGet<{ editable: boolean; notas: Nota[] }>(`/api/athletes/${childId}/notas-escolares`)
      .then((r) => {
        setNotas(r.notas);
        setEditable(r.editable);
      })
      // Sem resposta, a secção não aparece: é melhor do que uma pauta a fingir.
      .catch(() => setNotas(null));
  }, [childId]);

  useEffect(() => {
    setNotas(null);
    carregar();
  }, [carregar]);

  if (notas === null) return null;
  // Quem só lê (o próprio atleta) não precisa de uma secção vazia.
  if (notas.length === 0 && !editable) return null;

  const ano = anoLectivoDeHoje();
  const anos = [...new Set([ano, ...notas.map((n) => n.schoolYear)])].sort().reverse();

  return (
    <section>
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Escola</h2>
        {editable && notas.length > 0 && (
          <button type="button" onClick={() => setAberta("nova")} className="flex items-center gap-1 text-[13px] font-semibold text-signal-ink">
            <Plus className="size-4" strokeWidth={2.2} />
            Nota
          </button>
        )}
      </div>

      {notas.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] bg-surface p-5 text-center shadow-[var(--shadow-soft)]">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <GraduationCap className="size-[22px]" strokeWidth={1.9} />
          </span>
          <p className="mt-3 text-body font-semibold text-ink">As notas da escola</p>
          <p className="mx-auto mt-1 max-w-[30ch] text-[13px] leading-relaxed text-ink-3">
            O clube acompanha a escola dos atletas. Submete aqui as notas de cada período.
          </p>
          <button type="button" onClick={() => setAberta("nova")} className="cta mt-4 w-full justify-center gap-2">
            <Plus className="size-[18px]" strokeWidth={2.2} />
            Submeter notas
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {anos
            .filter((a) => notas.some((n) => n.schoolYear === a))
            .map((a) => (
              <div key={a} className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
                {PERIODOS.filter((p) => notas.some((n) => n.schoolYear === a && n.period === p.key)).map((p) => {
                  const doPeriodo = notas
                    .filter((n) => n.schoolYear === a && n.period === p.key)
                    .sort((x, y) => x.subject.localeCompare(y.subject, "pt"));
                  return (
                    <div key={p.key} className="border-b border-line last:border-0">
                      <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
                        <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                        <span className="num text-[12px] text-ink-4">{a}</span>
                      </div>
                      <ul>
                        {doPeriodo.map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => setAberta(n)}
                              className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left", editable && "active:bg-sunken/60")}
                            >
                              <span className="min-w-0 flex-1 truncate text-body text-ink-2">{n.subject}</span>
                              <span className={cx("num text-[17px] font-semibold", negativa(n) ? "text-risk" : "text-ink")}>
                                {n.grade}
                                <span className="ml-0.5 text-[12px] font-medium text-ink-4">/{n.scale}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      )}

      {aberta && (
        <NotaSheet
          childId={childId}
          childName={childName}
          nota={aberta === "nova" ? null : aberta}
          existentes={notas}
          anoPorOmissao={ano}
          onChanged={carregar}
          onClose={() => setAberta(null)}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function NotaSheet({
  childId,
  childName,
  nota,
  existentes,
  anoPorOmissao,
  onChanged,
  onClose,
}: {
  childId: string;
  childName: string;
  nota: Nota | null;
  existentes: Nota[];
  anoPorOmissao: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  /*
   * Uma nota nova começa onde a última ficou: o mesmo período e a mesma escala
   * da última submetida. Quem está a meio de uma pauta não volta a escolher.
   */
  const ultima = existentes[existentes.length - 1];
  const schoolYear = nota?.schoolYear ?? anoPorOmissao;
  const [period, setPeriod] = useState(nota?.period ?? ultima?.period ?? "1P");
  const [subject, setSubject] = useState(nota?.subject ?? "");
  const [scale, setScale] = useState<number>(nota?.scale ?? ultima?.scale ?? 5);
  const [grade, setGrade] = useState<number | null>(nota?.grade ?? null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravadas, setGravadas] = useState<string[]>([]);

  const semestral = period.endsWith("S");
  const periodos = PERIODOS.filter((p) => p.key.endsWith(semestral ? "S" : "P"));

  /* As disciplinas já submetidas neste período saem das sugestões. */
  const jaTem = new Set(
    [...existentes.filter((n) => n.schoolYear === schoolYear && n.period === period).map((n) => n.subject), ...gravadas].map(chave),
  );
  const sugestoes = nota ? [] : SUGESTOES.filter((s) => !jaTem.has(chave(s)));

  const valido = subject.trim().length > 0 && grade !== null;

  function mudarEscala(nova: number) {
    setScale(nova);
    setGrade(null);
  }

  async function gravar() {
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPost(`/api/athletes/${childId}/notas-escolares`, { schoolYear, period, subject: subject.trim(), grade, scale });
      onChanged();
      if (nota) {
        onClose();
        return;
      }
      // Fica aberta para a disciplina seguinte, no mesmo período e escala.
      setGravadas((l) => [...l, subject.trim()]);
      setSubject("");
      setGrade(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar a nota.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar() {
    if (!nota || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiDelete(`/api/notas-escolares/${nota.id}`);
      onChanged();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a nota.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={nota ? "Corrigir nota" : "Submeter nota"}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[var(--radius-xl)] bg-canvas px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
      >
        <header className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] leading-tight font-semibold text-ink">{nota ? "Corrigir nota" : "Submeter nota"}</h2>
            <p className="mt-0.5 text-meta text-ink-3">
              {childName} · {schoolYear}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn -mr-2 shrink-0" aria-label="Fechar">
            <X className="size-5" strokeWidth={2} />
          </button>
        </header>

        {gravadas.length > 0 && (
          <p className="mb-4 rounded-[var(--radius-md)] bg-ok-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ok">
            {gravadas.length === 1 ? `${gravadas[0]} gravada.` : `${gravadas.length} notas gravadas.`} Podes submeter a
            seguinte.
          </p>
        )}

        {/* ---- o período ---- */}
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-meta font-medium text-ink-3">Período</span>
          {!nota && (
            <button
              type="button"
              onClick={() => setPeriod(semestral ? "1P" : "1S")}
              className="text-[12px] font-medium text-ink-3 underline underline-offset-2"
            >
              {semestral ? "A escola tem períodos" : "A escola tem semestres"}
            </button>
          )}
        </div>
        <div className="mb-4 grid grid-flow-col auto-cols-fr gap-1.5" role="radiogroup" aria-label="Período">
          {periodos.map((p) => (
            <Escolha key={p.key} on={period === p.key} disabled={!!nota} onClick={() => setPeriod(p.key)}>
              {p.curto}
            </Escolha>
          ))}
        </div>

        {/* ---- a disciplina ---- */}
        <div className="mb-1.5 text-meta font-medium text-ink-3">Disciplina</div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Matemática"
          aria-label="Disciplina"
          maxLength={60}
          disabled={!!nota}
          className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none disabled:opacity-70"
        />
        {sugestoes.length > 0 && (
          <div className="-mx-5 mt-2 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {sugestoes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSubject(s)}
                className={cx(
                  "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                  chave(subject) === chave(s) ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-2",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* ---- a nota ---- */}
        <div className="mt-4 mb-1.5 flex items-baseline justify-between">
          <span className="text-meta font-medium text-ink-3">Nota</span>
          <span className="flex items-center gap-1" role="radiogroup" aria-label="Escala">
            {[5, 20].map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={scale === e}
                onClick={() => mudarEscala(e)}
                className={cx(
                  "rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  scale === e ? "bg-ink text-white" : "text-ink-3",
                )}
              >
                {e === 5 ? "1 a 5" : "0 a 20"}
              </button>
            ))}
          </span>
        </div>

        {scale === 5 ? (
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Nota de 1 a 5">
            {[1, 2, 3, 4, 5].map((v) => (
              <Escolha key={v} on={grade === v} grande onClick={() => setGrade(v)}>
                {v}
              </Escolha>
            ))}
          </div>
        ) : (
          /* De 0 a 20 são vinte e um botões: um número grande com menos e mais é mais rápido. */
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface p-2 shadow-[var(--shadow-soft)]">
            <button
              type="button"
              onClick={() => setGrade((g) => Math.max(0, (g ?? 10) - 1))}
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2 active:scale-95"
              aria-label="Menos um valor"
            >
              <Minus className="size-5" strokeWidth={2.2} />
            </button>
            <input
              value={grade ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                setGrade(v === "" ? null : Math.min(20, Number(v)));
              }}
              inputMode="numeric"
              placeholder="—"
              aria-label="Nota de 0 a 20"
              className="num h-12 min-w-0 flex-1 bg-transparent text-center text-[28px] font-semibold text-ink placeholder:text-ink-4 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setGrade((g) => Math.min(20, (g ?? 9) + 1))}
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2 active:scale-95"
              aria-label="Mais um valor"
            >
              <Plus className="size-5" strokeWidth={2.2} />
            </button>
          </div>
        )}

        {erro && <p className="mt-3 text-[13px] font-medium text-risk">{erro}</p>}

        <button type="button" onClick={() => void gravar()} disabled={!valido || busy} className="cta mt-5 w-full justify-center disabled:opacity-40">
          {busy ? "A gravar…" : nota ? "Guardar" : `Submeter${subject.trim() && grade !== null ? ` ${subject.trim()} · ${grade}` : ""}`}
        </button>

        {nota ? (
          <button type="button" onClick={() => void apagar()} disabled={busy} className="mt-2 flex w-full items-center justify-center gap-1.5 py-2.5 text-meta font-medium text-risk">
            <Trash2 className="size-4" strokeWidth={1.9} />
            Apagar esta nota
          </button>
        ) : (
          <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-4">
            {nomeDoPeriodo(period)}. O clube vê as notas na ficha do atleta.
          </p>
        )}
      </div>
    </div>
  );
}

/** Um botão de escolher uma de várias: o período, ou a nota de 1 a 5. */
function Escolha({
  on,
  grande,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  grande?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "num rounded-[var(--radius-md)] font-semibold transition-colors duration-150 disabled:opacity-60",
        grande ? "h-14 text-[20px]" : "h-11 text-[14px]",
        on ? "bg-signal-strong text-signal-on" : "bg-surface text-ink-2 shadow-[var(--shadow-soft)]",
      )}
    >
      {children}
    </button>
  );
}
