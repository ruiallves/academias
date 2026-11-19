import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, Loading, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { SalarioDialog } from "@/components/finance/SalarioDialog";
import { PagarVencimentoDialog } from "@/components/finance/PagarVencimentoDialog";
import { Pencil, Plus, TriangleAlert, Wallet } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  ESTADO_DO_MES_LABEL,
  METHOD_LABEL,
  euros,
  getFolha,
  mesCurto,
  mesLongo,
  type EstadoDoMes,
  type MesDeVencimento,
  type PeriodoDeVencimento,
  type PessoaComVencimento,
} from "@/lib/finance";

/**
 * O vencimento de uma pessoa, na ficha dela.
 *
 * O mesmo painel para alguém do staff e para um atleta: um vencimento é a mesma
 * coisa nos dois, e a diferença está só em quem recebe. Lê a folha filtrada à
 * pessoa — a mesma conta da página dos Vencimentos, para os dois ecrãs dizerem
 * o mesmo número.
 *
 * Só a quem vê as Contas: o vencimento é dinheiro do clube, e um treinador que
 * abre a ficha de um colega não tem porque o saber.
 */
export function VencimentoPanel({ tipo, id, nome }: { tipo: "staff" | "atleta"; id: string; nome: string }) {
  const { session } = useSession();
  const podeEscrever = can(session, "finance:write");
  const [pessoa, setPessoa] = useState<PessoaComVencimento | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [definir, setDefinir] = useState(false);
  const [corrigir, setCorrigir] = useState<PeriodoDeVencimento | null>(null);
  const [pagar, setPagar] = useState<MesDeVencimento | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const f = await getFolha(tipo === "staff" ? { membershipId: id } : { athleteId: id });
      setPessoa(f.pessoas[0] ?? null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o vencimento.");
    }
  }, [tipo, id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <Empty title="Vencimento" detail={erro} icon={TriangleAlert} />;
  if (pessoa === undefined) return <Loading size="panel" />;

  const dialogos = (
    <>
      {definir && (
        <SalarioDialog
          pessoa={{ tipo, id, nome }}
          onClose={() => setDefinir(false)}
          onDone={() => {
            setDefinir(false);
            void carregar();
          }}
        />
      )}
      {corrigir && (
        <SalarioDialog
          periodo={corrigir}
          onClose={() => setCorrigir(null)}
          onDone={() => {
            setCorrigir(null);
            void carregar();
          }}
        />
      )}
      {pagar && (
        <PagarVencimentoDialog
          alvo={{ modo: "um", nome, mes: pagar }}
          onClose={() => setPagar(null)}
          onDone={() => {
            setPagar(null);
            void carregar();
          }}
        />
      )}
    </>
  );

  if (!pessoa) {
    return (
      <>
        <Panel>
          <Empty
            title="Sem vencimento definido"
            detail={
              podeEscrever
                ? "Define o valor mensal e o mês a partir do qual vale. Cada mês pago entra nas Contas como despesa."
                : "Esta pessoa não tem vencimento registado nas Contas."
            }
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
        {dialogos}
      </>
    );
  }

  const atraso = pessoa.emAtraso.reduce((s, m) => s + m.amountCents, 0);
  const pagos = pessoa.meses.filter((m) => m.pagamento).slice().reverse();
  const ultimo = pessoa.periodos[0];

  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-meta text-ink-3">Vencimento mensal</dt>
              <dd className="mt-0.5 text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">
                {pessoa.atual ? euros(pessoa.atual.amountCents) : "—"}
              </dd>
              <dd className="mt-1 text-meta text-ink-4">
                {pessoa.atual
                  ? `desde ${mesLongo(pessoa.atual.startsOn.slice(0, 7))}${pessoa.atual.payDay ? ` · dia ${pessoa.atual.payDay}` : " · fim do mês"}`
                  : ultimo?.endsOn
                    ? `terminou em ${mesLongo(ultimo.endsOn.slice(0, 7))}`
                    : "sem vencimento em vigor"}
              </dd>
            </div>
            <div>
              <dt className="text-meta text-ink-3">Este mês</dt>
              <dd className="mt-1.5 flex flex-wrap items-center gap-2">
                {pessoa.esteMes ? <EstadoDoMesPill estado={pessoa.esteMes.estado} /> : <span className="text-body text-ink-4">—</span>}
                {pessoa.esteMes?.pagamento && (
                  <span className="text-meta text-ink-3 tabular">
                    {euros(pessoa.esteMes.pagamento.amountCents)} a {shortDate(new Date(pessoa.esteMes.pagamento.occurredAt))}
                  </span>
                )}
                {podeEscrever && pessoa.esteMes && pessoa.esteMes.estado !== "pago" && (
                  <button type="button" className="ctl-outline h-7 text-meta" onClick={() => setPagar(pessoa.esteMes)}>
                    Pagar {mesCurto(pessoa.esteMes.period)}
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-meta text-ink-3">Em atraso</dt>
              <dd className={cx("mt-0.5 text-[22px] leading-none font-semibold tracking-[-0.02em]", atraso > 0 ? "text-risk" : "text-ink")}>
                {atraso > 0 ? euros(atraso) : "—"}
              </dd>
              {atraso > 0 && (
                <dd className="mt-1 text-meta text-ink-4">
                  {pessoa.emAtraso.length} {pessoa.emAtraso.length === 1 ? "mês" : "meses"}
                </dd>
              )}
            </div>
          </dl>
          {podeEscrever && (
            <div className="flex shrink-0 items-center gap-1.5">
              {pessoa.atual && (
                <button type="button" className="ctl-ghost" onClick={() => setCorrigir(pessoa.atual)}>
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                  Corrigir
                </button>
              )}
              <button type="button" className="ctl-outline" onClick={() => setDefinir(true)}>
                {pessoa.atual ? "Novo valor" : "Definir vencimento"}
              </button>
            </div>
          )}
        </div>
        <div className="border-t border-line px-5 py-3">
          <FaixaDeMeses meses={pessoa.meses} onPagar={podeEscrever ? setPagar : undefined} />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Períodos" hint="o valor ao longo do tempo" />
          <ul className="divide-y divide-line">
            {pessoa.periodos.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink tabular">{euros(p.amountCents)} por mês</span>
                  <span className="block truncate text-meta text-ink-3">
                    {mesLongo(p.startsOn.slice(0, 7))}
                    {p.endsOn ? ` a ${mesLongo(p.endsOn.slice(0, 7))}` : " em diante"}
                    {p.payDay ? ` · dia ${p.payDay}` : ""}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </span>
                </span>
                {!p.endsOn && <Pill tone="ok">em vigor</Pill>}
                {podeEscrever && (
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink"
                    onClick={() => setCorrigir(p)}
                    aria-label="Corrigir período"
                    title="Corrigir"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHead title="Pagamentos" hint="os meses pagos, do mais recente">
            <Link to={`/contas?vista=movimentos&q=${encodeURIComponent(nome)}`} className="ctl-ghost">
              Nos movimentos
            </Link>
          </PanelHead>
          {pagos.length === 0 ? (
            <Empty title="Ainda sem pagamentos" detail="Cada mês pago aparece aqui e nos movimentos das Contas." icon={Wallet} compact />
          ) : (
            <ul className="divide-y divide-line">
              {pagos.map((m) => (
                <li key={m.period} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-ink">{capitalizar(mesLongo(m.period))}</span>
                    <span className="block text-meta text-ink-3">
                      pago a {shortDate(new Date(m.pagamento!.occurredAt))}
                      {m.pagamento!.method ? ` · ${METHOD_LABEL[m.pagamento!.method] ?? m.pagamento!.method}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-body font-semibold text-ink tabular">{euros(m.pagamento!.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {dialogos}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças partilhadas com a página dos Vencimentos                             */
/* -------------------------------------------------------------------------- */

const TOM: Record<EstadoDoMes, "ok" | "risk" | "warn" | "neutral"> = {
  pago: "ok",
  atraso: "risk",
  "este-mes": "warn",
  futuro: "neutral",
};

export function EstadoDoMesPill({ estado }: { estado: EstadoDoMes }) {
  return <Pill tone={TOM[estado]}>{ESTADO_DO_MES_LABEL[estado]}</Pill>;
}

/**
 * Os últimos meses, um quadrado por mês: verde pago, vermelho em atraso,
 * âmbar o mês corrente por pagar, tracejado o que ainda não chegou. O
 * `title` diz o mês, o estado e o valor; com `onPagar`, um mês por pagar
 * abre o pagamento ao toque.
 */
export function FaixaDeMeses({
  meses,
  onPagar,
  compacta = false,
}: {
  meses: MesDeVencimento[];
  onPagar?: (m: MesDeVencimento) => void;
  compacta?: boolean;
}) {
  if (meses.length === 0) return <span className="text-meta text-ink-4">—</span>;
  const COR: Record<EstadoDoMes, string> = {
    pago: "bg-ok",
    atraso: "bg-risk",
    "este-mes": "bg-warn",
    futuro: "border border-dashed border-line-strong bg-transparent",
  };
  return (
    <div className={cx("flex items-end gap-1", compacta ? "gap-[3px]" : "gap-1.5")} role="list" aria-label="Meses do vencimento">
      {meses.map((m) => {
        const titulo = `${capitalizar(mesLongo(m.period))} · ${ESTADO_DO_MES_LABEL[m.estado]} · ${euros(m.pagamento?.amountCents ?? m.amountCents)}`;
        const clicavel = onPagar && m.estado !== "pago" && m.estado !== "futuro";
        const caixa = cx("block rounded-[3px]", compacta ? "size-2.5" : "h-4 w-5", COR[m.estado], clicavel && "cursor-pointer hover:ring-2 hover:ring-ink/20");
        return (
          <span key={m.period} role="listitem" className="flex flex-col items-center gap-1">
            {clicavel ? (
              <button type="button" className={caixa} title={`${titulo} · pagar`} aria-label={`${titulo}, pagar`} onClick={() => onPagar(m)} />
            ) : (
              <span className={caixa} title={titulo} aria-label={titulo} />
            )}
            {!compacta && <span className="text-[10px] leading-none text-ink-4">{mesCurto(m.period).slice(0, 1).toUpperCase()}</span>}
          </span>
        );
      })}
    </div>
  );
}

export function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
