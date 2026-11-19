import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable, Empty, Loading, Monogram, Panel, Pill, SelectField, cx } from "@/components/primitives";
import { SalarioDialog } from "@/components/finance/SalarioDialog";
import { PagarVencimentoDialog } from "@/components/finance/PagarVencimentoDialog";
import { EstadoDoMesPill, FaixaDeMeses, capitalizar } from "@/components/finance/VencimentoPanel";
import { Pencil, Plus, Search, TriangleAlert, Wallet } from "@/lib/icons";
import { athleteById, staffById } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { euros, getFolha, mesCurto, mesLongo, type Folha, type MesDeVencimento, type PeriodoDeVencimento, type PessoaComVencimento } from "@/lib/finance";

/**
 * A folha de vencimentos — quem o clube paga, quanto, e o que falta pagar.
 *
 * ## A pergunta que responde primeiro
 *
 * "Quem ainda não recebeu este mês?" É isso que o resumo diz em cima e que a
 * coluna "Este mês" responde por pessoa, com o botão de pagar na própria
 * linha. Pagar a toda a gente de uma vez está ao lado, para o clube que paga
 * tudo no mesmo dia. O resto — o histórico de cada pessoa, os períodos — está
 * na ficha dela, a um clique no nome.
 *
 * ## O que uma linha mostra
 *
 * A pessoa, o vencimento em vigor, os últimos meses num risco de quadrados
 * (pago, por pagar, em atraso), o estado deste mês e o que está em atraso. Um
 * quadrado por pagar abre o pagamento desse mês: é como se paga um mês antigo.
 */
export function Vencimentos({ podeEscrever, onChange }: { podeEscrever: boolean; onChange: () => void }) {
  const [folha, setFolha] = useState<Folha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [definir, setDefinir] = useState<null | { tipo: "staff" | "atleta"; id: string; nome: string } | true>(null);
  const [corrigir, setCorrigir] = useState<PeriodoDeVencimento | null>(null);
  const [pagar, setPagar] = useState<{ nome: string; mes: MesDeVencimento } | null>(null);
  const [pagarTodos, setPagarTodos] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      setFolha(await getFolha());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os vencimentos.");
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const mudou = () => {
    void carregar();
    onChange();
  };

  const filtradas = useMemo(() => {
    if (!folha) return [];
    const termo = q.trim().toLowerCase();
    return folha.pessoas.filter((p) => {
      if (tipo && p.tipo !== tipo) return false;
      if (estado === "por-pagar" && p.esteMes?.estado !== "este-mes") return false;
      if (estado === "atraso" && p.emAtraso.length === 0) return false;
      if (estado === "pago" && p.esteMes?.estado !== "pago") return false;
      if (estado === "sem-vigor" && p.atual) return false;
      if (termo && !`${p.nome} ${p.detalhe ?? ""}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [folha, q, tipo, estado]);

  if (erro) return <Empty title="Vencimentos" detail={erro} icon={TriangleAlert} />;
  if (!folha) return <Loading />;

  const r = folha.resumo;
  const porPagar = folha.pessoas.filter((p) => p.esteMes?.estado === "este-mes");

  if (folha.pessoas.length === 0) {
    return (
      <>
        <Panel>
          <Empty
            title="Ainda sem vencimentos"
            detail="Define o vencimento de quem o clube paga: treinadores, staff, atletas. Cada mês pago entra nas Contas como despesa, ligado à pessoa."
            icon={Wallet}
          >
            {podeEscrever && (
              <button type="button" className="ctl-primary" onClick={() => setDefinir(true)}>
                <Plus className="size-3.5" strokeWidth={2} />
                Definir vencimento
              </button>
            )}
          </Empty>
        </Panel>
        {definir && (
          <SalarioDialog
            pessoa={definir === true ? undefined : definir}
            onClose={() => setDefinir(null)}
            onDone={() => {
              setDefinir(null);
              mudou();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      {/* O resumo: a folha e o que falta deste mês. Cada número filtra a lista. */}
      <Panel className="p-5 max-sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <p className="text-meta text-ink-3">Folha mensal</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-metric text-ink">{euros(r.folhaMensal)}</span>
              <span className="text-body text-ink-3">
                {r.pessoas} {r.pessoas === 1 ? "pessoa" : "pessoas"} · {capitalizar(mesLongo(folha.mesAtual))}
              </span>
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Numero rotulo="Pago este mês" valor={euros(r.pagoEsteMes.amountCents)} nota={`${r.pagoEsteMes.n} ${r.pagoEsteMes.n === 1 ? "pessoa" : "pessoas"}`} onClick={() => setEstado(estado === "pago" ? "" : "pago")} ativo={estado === "pago"} />
            <Numero
              rotulo="Por pagar este mês"
              valor={euros(r.porPagarEsteMes.amountCents)}
              nota={`${r.porPagarEsteMes.n} ${r.porPagarEsteMes.n === 1 ? "pessoa" : "pessoas"}`}
              tom={r.porPagarEsteMes.n > 0 ? "warn" : undefined}
              onClick={() => setEstado(estado === "por-pagar" ? "" : "por-pagar")}
              ativo={estado === "por-pagar"}
            />
            <Numero
              rotulo="Em atraso"
              valor={euros(r.emAtraso.amountCents)}
              nota={`${r.emAtraso.n} ${r.emAtraso.n === 1 ? "mês" : "meses"}`}
              tom={r.emAtraso.n > 0 ? "risk" : undefined}
              onClick={() => setEstado(estado === "atraso" ? "" : "atraso")}
              ativo={estado === "atraso"}
            />
          </dl>
          {podeEscrever && (
            <div className="flex flex-wrap items-center gap-1.5">
              {porPagar.length > 0 && (
                <button type="button" className="ctl-outline" onClick={() => setPagarTodos(true)}>
                  Pagar {mesCurto(folha.mesAtual)} a todos
                </button>
              )}
              <button type="button" className="ctl-primary" onClick={() => setDefinir(true)}>
                <Plus className="size-3.5" strokeWidth={2} />
                Definir vencimento
              </button>
            </div>
          )}
        </div>
      </Panel>

      <Panel className="mt-3 mb-3">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar pessoa…"
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-8 text-body text-ink placeholder:text-ink-4"
            />
          </div>
          <SelectField
            value={tipo}
            onChange={setTipo}
            options={[
              { value: "", label: "Staff e atletas" },
              { value: "staff", label: "Staff" },
              { value: "atleta", label: "Atletas" },
            ]}
          />
          <SelectField
            value={estado}
            onChange={setEstado}
            options={[
              { value: "", label: "Todos os estados" },
              { value: "por-pagar", label: "Por pagar este mês" },
              { value: "atraso", label: "Em atraso" },
              { value: "pago", label: "Pagos este mês" },
              { value: "sem-vigor", label: "Sem vencimento em vigor" },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <DataTable
          rows={filtradas}
          keyOf={(p) => `${p.tipo}-${p.id}`}
          empty={<Empty title="Ninguém com estes filtros" icon={Wallet} compact />}
          columns={[
            {
              key: "pessoa",
              header: "Pessoa",
              render: (p) => <Pessoa p={p} />,
            },
            {
              key: "vencimento",
              header: "Vencimento",
              align: "right",
              render: (p) =>
                p.atual ? (
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink tabular">{euros(p.atual.amountCents)}</span>
                    <span className="block text-meta text-ink-3">{p.atual.payDay ? `dia ${p.atual.payDay}` : "fim do mês"}</span>
                  </span>
                ) : (
                  <span className="text-meta text-ink-4">{p.periodos[0]?.endsOn ? `terminou ${mesCurto(p.periodos[0].endsOn.slice(0, 7), true)}` : "—"}</span>
                ),
            },
            {
              key: "meses",
              header: "Últimos meses",
              hideBelow: "lg",
              render: (p) => <FaixaDeMeses meses={p.meses.slice(-13)} compacta onPagar={podeEscrever ? (m) => setPagar({ nome: p.nome, mes: m }) : undefined} />,
            },
            {
              key: "este-mes",
              header: "Este mês",
              render: (p) =>
                p.esteMes ? (
                  <span className="flex items-center gap-2">
                    <EstadoDoMesPill estado={p.esteMes.estado} />
                    {podeEscrever && p.esteMes.estado === "este-mes" && (
                      <button
                        type="button"
                        className="ctl-ghost h-7 text-meta"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPagar({ nome: p.nome, mes: p.esteMes! });
                        }}
                      >
                        Pagar
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="text-meta text-ink-4">—</span>
                ),
            },
            {
              key: "atraso",
              header: "Em atraso",
              align: "right",
              hideBelow: "sm",
              render: (p) =>
                p.emAtraso.length > 0 ? (
                  <span className="min-w-0">
                    <span className="block font-semibold text-risk tabular">{euros(p.emAtraso.reduce((s, m) => s + m.amountCents, 0))}</span>
                    <span className="block text-meta text-ink-3">
                      {p.emAtraso.length === 1 ? mesCurto(p.emAtraso[0].period, true) : `${p.emAtraso.length} meses`}
                    </span>
                  </span>
                ) : (
                  <span className="text-meta text-ink-4">—</span>
                ),
            },
            {
              key: "ultimo",
              header: "Último pagamento",
              hideBelow: "lg",
              render: (p) =>
                p.ultimoPagamento ? (
                  <span className="min-w-0">
                    <span className="block text-ink tabular">{euros(p.ultimoPagamento.amountCents)}</span>
                    <span className="block text-meta text-ink-3">
                      {shortDate(new Date(p.ultimoPagamento.occurredAt))}
                      {p.ultimoPagamento.period ? ` · ${mesCurto(p.ultimoPagamento.period, true)}` : ""}
                    </span>
                  </span>
                ) : (
                  <span className="text-meta text-ink-4">—</span>
                ),
            },
            ...(podeEscrever
              ? [
                  {
                    key: "accoes",
                    header: "",
                    align: "right" as const,
                    width: "88px",
                    render: (p: PessoaComVencimento) => (
                      <span className="flex items-center justify-end gap-1">
                        {p.atual && (
                          <button
                            type="button"
                            className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCorrigir(p.atual);
                            }}
                            aria-label="Corrigir o vencimento"
                            title="Corrigir o período em vigor"
                          >
                            <Pencil className="size-3.5" strokeWidth={1.75} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="ctl-ghost h-7 text-meta"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDefinir({ tipo: p.tipo, id: p.id, nome: p.nome });
                          }}
                          title="Um valor novo a partir de um mês"
                        >
                          {p.atual ? "Novo valor" : "Definir"}
                        </button>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      {definir && (
        <SalarioDialog
          pessoa={definir === true ? undefined : definir}
          onClose={() => setDefinir(null)}
          onDone={() => {
            setDefinir(null);
            mudou();
          }}
        />
      )}
      {corrigir && (
        <SalarioDialog
          periodo={corrigir}
          onClose={() => setCorrigir(null)}
          onDone={() => {
            setCorrigir(null);
            mudou();
          }}
        />
      )}
      {pagar && (
        <PagarVencimentoDialog
          alvo={{ modo: "um", nome: pagar.nome, mes: pagar.mes }}
          onClose={() => setPagar(null)}
          onDone={() => {
            setPagar(null);
            mudou();
          }}
        />
      )}
      {pagarTodos && (
        <PagarVencimentoDialog
          alvo={{
            modo: "todos",
            period: folha.mesAtual,
            n: porPagar.length,
            amountCents: porPagar.reduce((s, p) => s + (p.esteMes?.amountCents ?? 0), 0),
          }}
          onClose={() => setPagarTodos(false)}
          onDone={() => {
            setPagarTodos(false);
            mudou();
          }}
        />
      )}
    </>
  );
}

/** A pessoa, com a fotografia que a consola já tem dela e o caminho para a ficha. */
function Pessoa({ p }: { p: PessoaComVencimento }) {
  const foto = p.tipo === "staff" ? staffById(p.id)?.photoUrl : athleteById(p.id)?.photoUrl;
  const para = p.tipo === "staff" ? `/staff/${p.id}?separador=vencimento` : `/atletas/${p.id}?separador=vencimento`;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Monogram name={p.nome} size="sm" photoUrl={foto} />
      <span className="min-w-0">
        <Link to={para} className="block truncate font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
          {p.nome}
        </Link>
        <span className="flex items-center gap-1.5 text-meta text-ink-3">
          <span className="truncate">{p.detalhe ?? (p.tipo === "staff" ? "Staff" : "Atleta")}</span>
          {p.detalhe && <Pill tone="neutral">{p.tipo === "staff" ? "Staff" : "Atleta"}</Pill>}
          {!p.ativo && <Pill tone="warn">inativo</Pill>}
        </span>
      </span>
    </span>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  tom,
  ativo,
  onClick,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tom?: "warn" | "risk";
  ativo?: boolean;
  onClick: () => void;
}) {
  return (
    <div>
      <dt className="text-meta text-ink-3">{rotulo}</dt>
      <dd>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={ativo}
          className={cx(
            "-mx-1 rounded-[6px] px-1 text-left hover:bg-sunken",
            ativo && "bg-sunken",
          )}
        >
          <span className={cx("block text-[18px] leading-none font-semibold tracking-[-0.02em] tabular", tom === "risk" ? "text-risk" : tom === "warn" ? "text-warn" : "text-ink")}>
            {valor}
          </span>
          {nota && <span className="mt-1 block text-meta text-ink-4">{nota}</span>}
        </button>
      </dd>
    </div>
  );
}
