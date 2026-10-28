import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, dialogInputClass } from "@/components/Dialog";
import { Bar, Monogram, cx } from "@/components/primitives";
import { Spinner } from "@/components/Busy";
import { Erro } from "@/components/definicoes/ui";
import { Check, CircleCheck, CircleDashed, Copy, Search, X } from "@/lib/icons";
import { percent, relativeDays, shortDate, time } from "@/lib/format";
import { leiturasDoDocumento, type LeiturasDeConduta, type LeitorDeConduta } from "@/lib/conduta";

/**
 * Quem abriu um documento de conduta.
 *
 * A pergunta que o clube faz é "quem ainda não leu o código de ética?", e
 * logo a seguir "e no Sub-11?". Por isso a janela abre nos pais, com três
 * maneiras de estreitar que se somam: o nome (do encarregado ou do atleta),
 * o estado (abriram / por abrir) e o escalão. O que fica no ecrã pode copiar-se
 * como lista de emails, para lembrar quem falta por fora da app.
 *
 * "Abriu" quer dizer que tocou num ficheiro do documento na app. É o que se
 * consegue saber; ler até ao fim, não.
 */

type Publico = "GUARDIAN" | "ATHLETE";
type Estado = "todos" | "abriram" | "por-abrir";

const PUBLICO: Record<Publico, { tab: string; plural: string; vazio: string }> = {
  GUARDIAN: { tab: "Pais", plural: "pais", vazio: "Ainda não há encarregados com conta na app." },
  ATHLETE: { tab: "Atletas", plural: "atletas", vazio: "Ainda não há atletas com conta na app." },
};

/** Sem acentos e em minúsculas: "joão" encontra "Joao" e o contrário. */
const simples = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const quando = (iso: string) => {
  const d = new Date(iso);
  return `${shortDate(d)}, ${time(d)}`;
};

export function LeiturasDaConduta({ documentId, title, onClose }: { documentId: string; title: string; onClose: () => void }) {
  const [dados, setDados] = useState<LeiturasDeConduta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [publico, setPublico] = useState<Publico>("GUARDIAN");
  const [estado, setEstado] = useState<Estado>("todos");
  const [equipa, setEquipa] = useState("");
  const [procura, setProcura] = useState("");
  const [copiado, setCopiado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    leiturasDoDocumento(documentId)
      .then((d) => vivo && setDados(d))
      .catch((e: unknown) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível carregar quem abriu."));
    return () => {
      vivo = false;
    };
  }, [documentId]);

  // As pessoas do separador escolhido, e as contas de cada separador para as etiquetas.
  const doPublico = useMemo(() => (dados?.people ?? []).filter((p) => p.kind === publico), [dados, publico]);
  const contas = useMemo(() => {
    const de = (k: Publico) => {
      const l = (dados?.people ?? []).filter((p) => p.kind === k);
      return { total: l.length, abriram: l.filter((p) => p.count > 0).length };
    };
    return { GUARDIAN: de("GUARDIAN"), ATHLETE: de("ATHLETE") };
  }, [dados]);

  // Os escalões que existem neste separador: não se oferece um filtro que dá sempre zero.
  const equipas = useMemo(() => {
    const ids = new Set(doPublico.flatMap((p) => p.athletes.flatMap((a) => a.teams.map((t) => t.id))));
    return (dados?.teams ?? []).filter((t) => ids.has(t.id));
  }, [dados, doPublico]);

  // O nome e o escalão estreitam primeiro; o estado conta-se por cima disso, para as etiquetas dizerem a verdade.
  const recorte = useMemo(() => {
    const q = simples(procura.trim());
    return doPublico.filter((p) => {
      if (equipa && !p.athletes.some((a) => a.teams.some((t) => t.id === equipa))) return false;
      if (!q) return true;
      return [p.name, p.email ?? "", ...p.athletes.map((a) => a.name)].some((s) => simples(s).includes(q));
    });
  }, [doPublico, procura, equipa]);

  const abriramNoRecorte = recorte.filter((p) => p.count > 0).length;
  const visiveis = useMemo(() => {
    const l = recorte.filter((p) => (estado === "abriram" ? p.count > 0 : estado === "por-abrir" ? p.count === 0 : true));
    // Quem abriu, do mais recente para trás; o resto por nome (já vem ordenado do servidor).
    return estado === "abriram" ? [...l].sort((a, b) => (b.lastViewedAt ?? "").localeCompare(a.lastViewedAt ?? "")) : l;
  }, [recorte, estado]);

  const filtrado = procura.trim() !== "" || equipa !== "" || estado !== "todos";
  const limpar = () => {
    setProcura("");
    setEquipa("");
    setEstado("todos");
    campo.current?.focus();
  };

  const emails = visiveis.map((p) => p.email).filter((e): e is string => Boolean(e));
  async function copiar() {
    try {
      await navigator.clipboard.writeText([...new Set(emails)].join(", "));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("Não foi possível copiar. Seleciona os emails à mão.");
    }
  }

  const c = contas[publico];
  const meta = PUBLICO[publico];

  return (
    <Dialog
      labelledBy="leituras-conduta"
      title="Quem abriu"
      subtitle={title}
      onClose={onClose}
      width={760}
      footer={
        dados && doPublico.length > 0 ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-meta text-ink-3 tabular" aria-live="polite">
              {visiveis.length === doPublico.length ? `${visiveis.length} ${meta.plural}` : `${visiveis.length} de ${doPublico.length} ${meta.plural}`}
            </span>
            <button type="button" className="ctl-outline" onClick={() => void copiar()} disabled={emails.length === 0}>
              {copiado ? <Check className="size-3.5" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
              {copiado ? "Copiado" : estado === "por-abrir" ? `Copiar emails de quem falta (${emails.length})` : `Copiar emails (${emails.length})`}
            </button>
          </div>
        ) : undefined
      }
    >
      {!dados && !erro && (
        <div className="flex min-h-[320px] items-center justify-center">
          <Spinner />
        </div>
      )}
      {erro && (
        <div className="p-5">
          <Erro>{erro}</Erro>
        </div>
      )}

      {dados && (
        <>
          <div className="space-y-4 border-b border-line px-5 pt-4 pb-4">
            {/* Pais ou atletas: dois públicos, cada um com a sua conta. */}
            <div className="inline-flex rounded-[var(--radius-control)] border border-line bg-sunken p-0.5" role="group" aria-label="Público">
              {(Object.keys(PUBLICO) as Publico[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={publico === k}
                  onClick={() => {
                    setPublico(k);
                    setEquipa("");
                  }}
                  className={cx(
                    "flex h-8 items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-3 text-meta font-medium transition-colors duration-[120ms]",
                    publico === k ? "bg-surface text-ink shadow-[var(--shadow-soft)]" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {PUBLICO[k].tab}
                  <span className={cx("tabular", publico === k ? "text-ink-3" : "text-ink-4")}>
                    {contas[k].abriram}/{contas[k].total}
                  </span>
                </button>
              ))}
            </div>

            {/* O número primeiro: é a resposta a "quantos já leram". */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <div className="text-[28px] leading-none font-semibold tracking-[-0.02em] text-ink tabular">
                  {c.abriram}
                  <span className="text-body font-normal text-ink-3"> de {c.total}</span>
                </div>
                <div className="mt-1 text-meta text-ink-3">
                  {meta.plural} abriram{c.total > 0 && ` · ${percent(c.abriram / c.total)}`}
                </div>
              </div>
              <div className="min-w-[160px] flex-1 pb-1.5">
                <Bar value={c.total > 0 ? c.abriram / c.total : 0} tone={c.total > 0 && c.abriram === c.total ? "ok" : "signal"} />
              </div>
            </div>

            {doPublico.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
                    <input
                      ref={campo}
                      type="search"
                      value={procura}
                      onChange={(e) => setProcura(e.target.value)}
                      placeholder={publico === "GUARDIAN" ? "Nome do encarregado ou do atleta" : "Nome do atleta"}
                      aria-label="Procurar"
                      className={cx(dialogInputClass, "pl-8")}
                    />
                  </div>
                  {equipas.length > 0 && (
                    <select
                      value={equipa}
                      onChange={(e) => setEquipa(e.target.value)}
                      aria-label="Escalão"
                      className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none sm:w-52"
                    >
                      <option value="">Todos os escalões</option>
                      {equipas.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex rounded-[var(--radius-control)] border border-line p-0.5 sm:inline-flex" role="group" aria-label="Estado">
                  {(
                    [
                      ["todos", "Todos", recorte.length],
                      ["abriram", "Abriram", abriramNoRecorte],
                      ["por-abrir", "Por abrir", recorte.length - abriramNoRecorte],
                    ] as const
                  ).map(([k, rotulo, n]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={estado === k}
                      onClick={() => setEstado(k)}
                      className={cx(
                        "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-3 text-meta font-medium transition-colors duration-[120ms] sm:flex-none",
                        estado === k ? "bg-signal-soft text-signal-ink" : "text-ink-3 hover:bg-sunken hover:text-ink",
                      )}
                    >
                      {rotulo}
                      <span className="tabular opacity-70">{n}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {doPublico.length === 0 ? (
            <p className="px-5 py-12 text-center text-meta text-ink-3">{meta.vazio}</p>
          ) : visiveis.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-body font-medium text-ink">
                {estado === "por-abrir" && !procura && !equipa
                  ? `Todos os ${meta.plural} já abriram`
                  : estado === "abriram" && !procura && !equipa
                    ? `Ainda nenhum dos ${meta.plural} abriu`
                    : "Ninguém com estes filtros"}
              </p>
              {procura.trim() && <p className="mt-1 text-meta text-ink-3">Nada com «{procura.trim()}». Experimenta só o primeiro nome.</p>}
              {filtrado && (
                <button type="button" className="ctl-outline mt-3" onClick={limpar}>
                  <X className="size-3.5" strokeWidth={1.75} />
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <ul>
              {visiveis.map((p) => (
                <Pessoa key={`${p.kind}:${p.userId}`} p={p} />
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}

function Pessoa({ p }: { p: LeitorDeConduta }) {
  const abriu = p.count > 0 && p.firstViewedAt;
  // Para um encarregado, os educandos com o escalão; para um atleta, só o escalão.
  const detalhe =
    p.kind === "GUARDIAN"
      ? p.athletes.map((a) => (a.teams.length ? `${a.name} · ${a.teams.map((t) => t.name).join(", ")}` : a.name)).join("  ·  ")
      : p.athletes.flatMap((a) => a.teams.map((t) => t.name)).join(", ") || "Sem escalão";

  const estado = abriu ? (
    <>
      <span className="inline-flex items-center gap-1.5 text-meta font-medium text-ok">
        <CircleCheck className="size-3.5 shrink-0" strokeWidth={2} />
        Abriu a {quando(p.firstViewedAt!)}
      </span>
      {p.count > 1 && p.lastViewedAt && (
        <span className="block text-[11px] text-ink-4 max-sm:pl-5">
          {p.count} vezes · última {relativeDays(new Date(p.lastViewedAt))}
        </span>
      )}
    </>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-meta text-ink-4">
      <CircleDashed className="size-3.5 shrink-0" strokeWidth={1.75} />
      Por abrir
    </span>
  );

  return (
    <li className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
      <Monogram name={p.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{p.name}</div>
        <div className="truncate text-meta text-ink-3" title={detalhe}>
          {detalhe}
        </div>
        {/* No telemóvel o estado vai por baixo do nome: à direita apertava-o. */}
        <div className="mt-1 sm:hidden">{estado}</div>
      </div>
      <div className="shrink-0 text-right max-sm:hidden">{estado}</div>
    </li>
  );
}
