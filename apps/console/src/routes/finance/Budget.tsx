import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Panel, cx } from "@/components/primitives";
import { ArrowLeft, Check, Loader2, TriangleAlert, Wallet } from "@/lib/icons";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import { euros, getBudgets, setBudget, type BudgetRows } from "@/lib/finance";

/**
 * Orçamento da época — quanto o clube decidiu gastar por categoria, contra o
 * que já gastou.
 *
 * O "gasto" é derivado das despesas concluídas dentro da época; aqui só se
 * escreve o tecto. Uma categoria sem tecto mostra o gasto na mesma — o
 * orçamento é opcional, a verdade não.
 */
export default function Budget() {
  const { session } = useSession();
  const podeEscrever = can(session, "finance:write");

  const [dados, setDados] = useState<BudgetRows | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Rascunhos por categoria, em texto de euros — só o que o utilizador tocou. */
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [aGravar, setAGravar] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    try {
      setDados(await getBudgets());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o orçamento.");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

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
      />

      {erro && <p className="mb-2 text-meta text-risk">{erro}</p>}

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
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[1fr_150px_130px]"
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
    </>
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
