import { Link } from "react-router-dom";
import { ArrowRight, CircleCheck } from "@/lib/icons";
import type { AttentionItem } from "@/data/types";
import { cx, Empty, Panel, PanelHead } from "./primitives";

/**
 * "Precisa de atenção" — o painel que define o produto.
 *
 * Está acima das métricas de propósito. As métricas descrevem; esta lista pede
 * acção. Um diretor que abra a consola de manhã tem de conseguir despachar isto e
 * fechar o portátil.
 *
 * Regras que mantêm a lista credível:
 *  - nunca mais de cinco linhas — uma lista de vinte não é uma lista de trabalho;
 *  - cada linha é um facto contável, com um destino e um verbo;
 *  - vazio é boa notícia e diz-se assim.
 */
export function Attention({ items }: { items: AttentionItem[] }) {
  const shown = items.slice(0, 5);

  return (
    <Panel>
      <PanelHead title="Precisa de atenção" hint={items.length > 0 ? `${items.length} ${items.length === 1 ? "assunto" : "assuntos"}` : undefined} />

      {shown.length === 0 ? (
        <div className="px-5 py-12">
          <Empty
            icon={CircleCheck}
            tone="ok"
            title="Está tudo em dia"
            detail="Sem mensalidades vencidas, treinos por atribuir ou presenças por registar."
          />
        </div>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className="group flex items-center gap-3 border-b border-line px-5 py-3 transition-colors duration-[120ms] last:border-0 hover:bg-sunken/50"
              >
                <SeverityMark severity={item.severity} />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{item.title}</span>
                  <span className="block truncate text-meta text-ink-3">{item.detail}</span>
                </span>

                <span className="ctl-outline shrink-0 gap-1 group-hover:border-line-strong group-hover:text-ink">
                  {item.action}
                  <ArrowRight className="size-3 transition-transform duration-[120ms] group-hover:translate-x-0.5" strokeWidth={2} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Marca de gravidade: uma barra vertical, não um ícone.
 *
 * Três ícones diferentes numa lista de cinco linhas pesam mais que a informação
 * que transportam. A barra dá a leitura periférica — quanto vermelho há no painel —
 * sem competir com o texto.
 */
function SeverityMark({ severity }: { severity: AttentionItem["severity"] }) {
  const color = { risk: "bg-risk", warn: "bg-warn", info: "bg-ink-4" }[severity];
  const label = { risk: "Urgente", warn: "Atenção", info: "Informação" }[severity];
  return <span className={cx("h-8 w-[3px] shrink-0 rounded-full", color)} role="img" aria-label={label} />;
}
