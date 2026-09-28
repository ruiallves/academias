import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, PanelHead, SelectField, cx } from "@/components/primitives";
import { ArrowLeft, Check, Copy, Loader2, TriangleAlert, Wallet } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { copyBudget, euros, getBudgetHistory, getBudgets, setBudget, type BudgetRows, type BudgetSeason } from "@/lib/finance";

/**
 * Orçamento da época — quanto o clube decidiu gastar por categoria, contra o
 * que já gastou.
 *
 * O "gasto" é derivado das despesas concluídas dentro da época; aqui só se
 * escreve o tecto. Uma categoria sem tecto mostra o gasto na mesma — o
 * orçamento é opcional, a verdade não.
 *
 * ## As outras épocas
 *
 * A página mostrava só a época em curso, e o planeado nas anteriores ficava na
 * base sem caminho para lá. Agora escolhe-se a época no topo (fica no endereço,
 * `?epoca=`), e o **Histórico** no fundo põe todas lado a lado — orçado,
 * gasto e a diferença —, que é a pergunta de quem planeia a seguinte. Uma
 * época ainda sem orçamento oferece copiar o de outra, só nas categorias que
 * ainda não têm valor.
 */
export default function Budget() {
  const { session } = useSession();
  const podeEscrever = can(session, "finance:write");

  const [dados, setDados] = useState<BudgetRows | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Rascunhos por categoria, em texto de euros — só o que o utilizador tocou. */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [aGravar, setAGravar] = useState<string | null>(null);
  const [historico, setHistorico] = useState<BudgetSeason[]>([]);
  const [aCopiar, setACopiar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /* A época à vista vive no endereço: o histórico leva a ela, e o voltar atrás também. */
  const [params, setParams] = useSearchParams();
  const epoca = params.get("epoca") ?? undefined;
  const escolherEpoca = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("epoca", id);
    setParams(p, { replace: true });
    setRascunho({});
    setAviso(null);
  };

  async function carregar() {
    setErro(null);
    try {
      const [d, h] = await Promise.all([getBudgets(epoca), getBudgetHistory().catch(() => [] as BudgetSeason[])]);
      setDados(d);
      setHistorico(h);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o orçamento.");
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoca]);

  /*
   * De onde copiar: a época mais próxima, antes desta, que tenha orçamento — é
   * quase sempre a do ano anterior. Sem nenhuma antes, a mais próxima depois.
   */
  const fonteDaCopia = useMemo(() => {
    if (!dados) return undefined;
    const i = historico.findIndex((h) => h.seasonId === dados.season.id);
    const antes = historico.slice(i + 1).find((h) => h.budgetCents > 0);
    return antes ?? historico.slice(0, Math.max(i, 0)).reverse().find((h) => h.budgetCents > 0);
  }, [dados, historico]);

  async function copiar() {
    if (!dados || !fonteDaCopia || aCopiar) return;
    setACopiar(true);
    setErro(null);
    try {
      const r = await copyBudget(fonteDaCopia.seasonId, dados.season.id);
      await carregar();
      setAviso(
        r.copiadas === 0
          ? "Nada para copiar: estas categorias já tinham valor."
          : `${r.copiadas} ${r.copiadas === 1 ? "categoria copiada" : "categorias copiadas"} de ${fonteDaCopia.label}. Ajusta o que mudou.`,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível copiar.");
    } finally {
      setACopiar(false);
    }
  }

  const totais = useMemo(() => {
    const rows = dados?.rows ?? [];
    return {
      budget: rows.reduce((s, r) => s + r.budgetCents, 0),
      spent: rows.reduce((s, r) => s + r.spentCents, 0),
    };
  }, [dados]);

  async function gravar(categoryId: string) {
    if (!dados || aGravar) return;
    const texto = rascunho[categoryId];
    if (texto === undefined) return;
    const cents = paraCentimos(texto);
    if (cents === null) return;
    setAGravar(categoryId);
    setErro(null);
    try {
      await setBudget({ seasonId: dados.season.id, categoryId, amountCents: cents });
      /*
       * Recarregar primeiro, largar o rascunho depois.
       *
       * Ao contrário — que era como estava — o input ficava sem rascunho e com
       * o `dados` ainda velho: mostrava o valor antigo durante o tempo da
       * leitura, e o botão (que só existe quando há rascunho) desaparecia com o
       * spinner a meio. Assim o campo mostra sempre o que a pessoa escreveu, e
       * as duas actualizações caem no mesmo render — sem piscar.
       */
      await carregar();
      setRascunho((r) => {
        const { [categoryId]: _, ...resto } = r;
        return resto;
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setAGravar(null);
    }
  }

  if (erro && !dados) return <Empty title="Orçamento" detail={erro} icon={TriangleAlert} />;
  if (!dados) return <Loading />;

  return (
    <>
      <Link to="/contas" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        Contas
      </Link>

      <PageHeader
        eyebrow="Contas"
        title="Orçamento"
        subtitle={`Época ${dados.season.label} — o tecto de cada categoria de despesa, contra o gasto real.`}
      >
        {historico.length > 1 && (
          <SelectField
            value={dados.season.id}
            onChange={escolherEpoca}
            options={historico.map((h) => ({ value: h.seasonId, label: h.current ? `${h.label} · em curso` : h.label }))}
          />
        )}
      </PageHeader>

      {erro && <p className="mb-2 text-meta text-risk">{erro}</p>}

      {/* Uma época por orçamentar: começar pela de outra poupa escrever tudo de novo. */}
      {podeEscrever && totais.budget === 0 && fonteDaCopia && dados.rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-sunken/40 px-4 py-3">
          <span className="min-w-0 flex-1 text-meta leading-relaxed text-ink-2">
            A época {dados.season.label} ainda não tem orçamento. Podes começar pelo de {fonteDaCopia.label}
            {" "}({euros(fonteDaCopia.budgetCents)}) e ajustar a partir daí.
          </span>
          <button type="button" className="ctl-outline" onClick={() => void copiar()} disabled={aCopiar}>
            {aCopiar ? <Loader2 className="size-3.5 animate-spin" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
            Copiar de {fonteDaCopia.label}
          </button>
        </div>
      )}
      {aviso && <p className="mb-3 text-meta text-ok">{aviso}</p>}

      {dados.rows.length === 0 ? (
        <Empty
          title="Sem categorias de despesa"
          detail="Cria categorias de despesa nas configurações para orçamentar por categoria."
          icon={Wallet}
        />
      ) : (
        <Panel>
          <div className="divide-y divide-line-soft">
            {/* Totais da época primeiro — é a linha que a direcção vem ver. */}
            <div className="flex items-baseline justify-between gap-4 bg-sunken/50 px-4 py-3">
              <span className="text-meta font-semibold tracking-wide text-ink-2 uppercase">Total da época</span>
              <span className="text-body text-ink-2">
                <strong className="font-semibold text-ink tabular">{euros(totais.spent)}</strong>
                {totais.budget > 0 && <span className="text-ink-3 tabular"> de {euros(totais.budget)}</span>}
              </span>
            </div>

            {dados.rows.map((r) => {
              const texto = rascunho[r.categoryId];
              const editado = texto !== undefined;
              const cents = editado ? paraCentimos(texto) : r.budgetCents;
              const invalido = editado && cents === null;
              const aGuardar = aGravar === r.categoryId;
              const razao = r.budgetCents > 0 ? r.spentCents / r.budgetCents : 0;
              const estourou = r.budgetCents > 0 && r.spentCents > r.budgetCents;

              return (
                <div
                  key={r.categoryId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_150px_130px]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-ink">{r.label}</p>
                    <p className="text-meta text-ink-3 tabular">
                      {r.spentCents > 0 ? `Gasto ${euros(r.spentCents)}` : "Sem gastos"}
                      {r.budgetCents > 0 && (
                        <span className={estourou ? "font-semibold text-risk" : undefined}>
                          {estourou
                            ? ` — ${euros(r.spentCents - r.budgetCents)} acima do orçamento`
                            : ` — resta ${euros(r.budgetCents - r.spentCents)}`}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-sunken sm:col-span-1">
                    {r.budgetCents > 0 && (
                      <div
                        className={cx("h-full rounded-full", estourou ? "bg-risk" : razao > 0.85 ? "bg-warn" : "bg-ok")}
                        style={{ width: `${Math.min(100, Math.round(razao * 100))}%` }}
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    {podeEscrever ? (
                      <>
                        <input
                          value={editado ? texto : r.budgetCents > 0 ? String(r.budgetCents / 100).replace(".", ",") : ""}
                          onChange={(e) => setRascunho((x) => ({ ...x, [r.categoryId]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void gravar(r.categoryId);
                          }}
                          // Enquanto grava, o campo congela com o valor escrito: não é
                          // altura de o mudar, e mostrar outra coisa era a mentira que
                          // esta linha tinha antes.
                          disabled={aGuardar}
                          inputMode="decimal"
                          placeholder="0,00"
                          aria-label={`Orçamento para ${r.label}, em euros`}
                          className={cx(
                            "h-8 w-24 rounded-[var(--radius-control)] border bg-surface px-2 text-right text-body text-ink tabular placeholder:text-ink-4",
                            invalido ? "border-risk" : "border-line",
                            aGuardar && "opacity-60",
                          )}
                        />
                        {/* O botão sobrevive ao fim do rascunho: o spinner tem de durar
                            até os números novos estarem no ecrã, não até à resposta. */}
                        {(editado || aGuardar) && (
                          <button
                            type="button"
                            className="ctl-primary h-8 px-2.5"
                            disabled={invalido || aGuardar}
                            onClick={() => void gravar(r.categoryId)}
                            title="Gravar orçamento"
                          >
                            {aGuardar ? (
                              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                            ) : (
                              <Check className="size-3.5" strokeWidth={2} />
                            )}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-body text-ink-2 tabular">{r.budgetCents > 0 ? euros(r.budgetCents) : "—"}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {podeEscrever && (
        <p className="mt-3 text-meta text-ink-4">Escreve o valor em euros e confirma — um orçamento a zero remove o tecto.</p>
      )}

      {historico.length > 0 && <Historico epocas={historico} atual={dados.season.id} onEscolher={escolherEpoca} />}
    </>
  );
}

/**
 * O histórico: todas as épocas lado a lado, o orçado contra o gasto.
 *
 * Tocar numa linha abre essa época em cima. A diferença diz para onde foi o
 * desvio — a vermelho quando se gastou mais do que se orçou —, e uma época sem
 * orçamento mostra o gasto na mesma: foi o que custou, planeado ou não.
 */
function Historico({
  epocas,
  atual,
  onEscolher,
}: {
  epocas: BudgetSeason[];
  atual: string;
  onEscolher: (id: string) => void;
}) {
  return (
    <Panel className="mt-6">
      <PanelHead title="Histórico" hint="o orçado contra o gasto, por época" />
      <div className="hidden grid-cols-[minmax(0,1fr)_110px_110px_130px] gap-3 border-b border-line px-4 py-2 text-meta font-medium text-ink-3 sm:grid">
        <span>Época</span>
        <span className="text-right">Orçado</span>
        <span className="text-right">Gasto</span>
        <span className="text-right">Diferença</span>
      </div>
      <ul>
        {epocas.map((h) => {
          const diferenca = h.spentCents - h.budgetCents;
          const escolhida = h.seasonId === atual;
          return (
            <li key={h.seasonId} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => onEscolher(h.seasonId)}
                aria-current={escolhida ? "true" : undefined}
                className={cx(
                  "grid w-full grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-sunken/50 sm:grid-cols-[minmax(0,1fr)_110px_110px_130px]",
                  escolhida && "bg-signal-soft/30",
                )}
              >
                <span className="col-span-2 min-w-0 sm:col-span-1">
                  <span className="text-body font-medium text-ink">{h.label}</span>
                  {h.current && <span className="ml-2 text-meta text-signal-ink">em curso</span>}
                  <span className="block text-meta text-ink-4">
                    {h.categoriasOrcamentadas > 0
                      ? `${h.categoriasOrcamentadas} ${h.categoriasOrcamentadas === 1 ? "categoria orçamentada" : "categorias orçamentadas"}`
                      : "sem orçamento"}
                  </span>
                </span>
                <span className="text-body text-ink-2 tabular sm:text-right">
                  <span className="text-meta text-ink-4 sm:hidden">Orçado </span>
                  {h.budgetCents > 0 ? euros(h.budgetCents) : "—"}
                </span>
                <span className="text-body text-ink-2 tabular sm:text-right">
                  <span className="text-meta text-ink-4 sm:hidden">Gasto </span>
                  {euros(h.spentCents)}
                </span>
                <span
                  className={cx(
                    "col-span-2 text-body tabular sm:col-span-1 sm:text-right",
                    h.budgetCents === 0 ? "text-ink-4" : diferenca > 0 ? "font-semibold text-risk" : "text-ok",
                  )}
                >
                  {h.budgetCents === 0 ? "—" : diferenca > 0 ? `${euros(diferenca)} acima` : `${euros(-diferenca)} abaixo`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** "450", "450,50" em euros para cêntimos; nulo quando não é um valor. */
function paraCentimos(v: string): number | null {
  const limpo = v.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!limpo) return 0;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
