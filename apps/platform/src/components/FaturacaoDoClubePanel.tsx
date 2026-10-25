import { useState } from "react";
import { Panel, PanelHead } from "@/components/primitives";
import { apiPatch } from "@/lib/http";
import type { FaturacaoDoClube } from "@/lib/types";

/** Os programas certificados que os clubes costumam usar. "Outro" deixa escrever o nome. */
const PROGRAMAS = ["InvoiceXpress", "Moloni", "Primavera", "PHC", "Sage"];

/**
 * A faturação das vendas do site de um clube, na ficha dele.
 *
 * Quem fatura um bilhete pago ou uma encomenda da loja é o clube, no programa
 * certificado dele. Por isso o clube só vende no site com a faturação marcada
 * aqui, depois de confirmar com ele que o programa está pronto para faturar as
 * vendas do site. Sem ela, a bilheteira só vende bilhetes a 0 € e a loja fica
 * em catálogo, mesmo com os pagamentos ligados.
 *
 * Por cima, as quatro coisas de que a venda depende (site no plano, canal
 * euPago, pagamentos ligados pelo clube, faturação), para se ver de uma vez
 * porque é que um clube ainda não vende.
 *
 * `OWNER` e `ADMIN` marcam, como a euPago; `SUPPORT` vê.
 */
export function FaturacaoDoClubePanel({
  academyId,
  faturacao: inicial,
  mayEdit,
}: {
  academyId: string;
  faturacao: FaturacaoDoClube;
  mayEdit: boolean;
}) {
  const [estado, setEstado] = useState(inicial);
  const conhecido = estado.programa && PROGRAMAS.includes(estado.programa);
  const [escolha, setEscolha] = useState<string>(estado.programa ? (conhecido ? estado.programa : "outro") : PROGRAMAS[0]);
  const [outro, setOutro] = useState(estado.programa && !conhecido ? estado.programa : "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const programa = escolha === "outro" ? outro.trim() : escolha;

  async function gravar(valor: string, mensagem: string) {
    setBusy(true);
    setErro(null);
    setOk(null);
    try {
      setEstado(await apiPatch<FaturacaoDoClube>(`/academies/${academyId}/faturacao`, { programa: valor }));
      setOk(mensagem);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  const passos: { feito: boolean; texto: string; falta: string }[] = [
    { feito: estado.passos.site, texto: "Site no plano (Connect Pro)", falta: "O plano do clube não inclui o site." },
    { feito: estado.passos.eupago, texto: "Canal euPago do clube", falta: "Faltam as chaves da euPago do clube (painel acima)." },
    { feito: estado.passos.pagamentos, texto: "Pagamentos ligados pelo clube", falta: "O clube liga-os na consola, em Definições › Pagamentos." },
    { feito: estado.passos.faturacao, texto: "Faturação configurada", falta: "Marca-se aqui em baixo, depois de confirmar com o clube." },
  ];
  const desde = estado.desde ? new Date(estado.desde).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <Panel>
      <PanelHead title="Vendas no site e faturação" hint={estado.vende ? "vende bilhetes e na loja" : "ainda não vende"} />
      <div className="space-y-4 px-5 py-4">
        <div className={`rounded-[var(--radius-control)] px-3 py-2.5 text-meta leading-relaxed ${estado.vende ? "bg-ok-soft text-ok" : "bg-sunken text-ink-2"}`}>
          {estado.vende ? (
            <>
              <strong className="font-semibold">Este clube pode vender no site:</strong> bilhetes pagos na bilheteira e artigos na loja.
            </>
          ) : (
            <>
              <strong className="font-semibold text-ink">Ainda não vende no site.</strong> A bilheteira só abre bilhetes a 0 € e a loja fica em catálogo até
              estarem as quatro coisas ligadas.
            </>
          )}
        </div>

        <ul className="space-y-1.5 text-meta">
          {passos.map((p) => (
            <li key={p.texto} className="flex items-start gap-2">
              <span
                aria-hidden
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${p.feito ? "bg-ok text-white" : "border border-line-strong text-transparent"}`}
              >
                ✓
              </span>
              <span className="min-w-0">
                <span className={p.feito ? "text-ink" : "text-ink-2"}>{p.texto}</span>
                {!p.feito && <span className="block text-[11px] text-ink-4">{p.falta}</span>}
              </span>
              <span className="sr-only">{p.feito ? "(feito)" : "(por fazer)"}</span>
            </li>
          ))}
        </ul>

        {estado.programa && (
          <p className="text-meta text-ink-2">
            Fatura no <strong className="font-semibold text-ink">{estado.programa}</strong>
            {desde ? `, confirmado a ${desde}` : ""}.
          </p>
        )}

        {mayEdit && (
          <div className="space-y-2.5 border-t border-line pt-3.5">
            <p className="text-[11px] leading-relaxed text-ink-4">
              Marca só depois de confirmar com o clube que o programa de faturação dele está pronto para faturar as vendas do site. É o clube que fatura cada
              bilhete e cada encomenda.
            </p>
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-ink">Programa de faturação do clube</span>
              <select
                value={escolha}
                onChange={(e) => setEscolha(e.target.value)}
                className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body focus:border-line-strong focus:outline-none"
              >
                {PROGRAMAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="outro">Outro</option>
              </select>
            </label>
            {escolha === "outro" && (
              <label className="block">
                <span className="mb-1 block text-meta font-medium text-ink">Nome do programa</span>
                <input
                  value={outro}
                  maxLength={60}
                  onChange={(e) => setOutro(e.target.value)}
                  placeholder="O programa certificado que o clube usa"
                  className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body focus:border-line-strong focus:outline-none"
                />
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="ctl-primary"
                disabled={busy || !programa || (estado.passos.faturacao && programa === estado.programa)}
                onClick={() => void gravar(programa, "Faturação marcada. Fica no registo de auditoria.")}
              >
                {busy ? "A guardar…" : estado.passos.faturacao ? "Mudar o programa" : "Marcar faturação configurada"}
              </button>
              {estado.passos.faturacao && (
                <button
                  type="button"
                  className="ctl-ghost text-ink-3 hover:text-risk"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Desmarcar a faturação? O site deste clube deixa de vender: a loja volta a catálogo e a bilheteira só vende bilhetes a 0 €. O que já foi vendido não muda.")) {
                      void gravar("", "Faturação desmarcada: o clube deixou de vender no site.");
                    }
                  }}
                >
                  Desmarcar
                </button>
              )}
            </div>
            {erro && <p className="text-meta text-risk">{erro}</p>}
            {ok && !erro && <p className="text-meta text-ok">{ok}</p>}
          </div>
        )}
      </div>
    </Panel>
  );
}
