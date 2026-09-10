import { useEffect, useState } from "react";
import { Panel, PanelHead, Pill } from "./primitives";
import { ReadDialog } from "./LegalGate";
import { Spinner } from "./Busy";
import {
  dataPT,
  legalDocuments,
  legalHistory,
  type LegalAcceptanceRow,
  type LegalDocumentView,
} from "@/lib/legal";

/**
 * Os documentos legais, nas Definições.
 *
 * Duas listas: o que está em vigor (com "Ler"), e o que esta conta — e o clube,
 * para quem o representa — já aceitou, versão a versão. É o histórico de que o
 * gate fala: "Termos v1.0 aceites em 10/09/2026, v2.0 em 14/11/2026". Nada
 * aqui se edita — a aceitação de versões novas é pedida à entrada.
 */
export function LegalPanel() {
  const [docs, setDocs] = useState<LegalDocumentView[] | null>(null);
  const [history, setHistory] = useState<LegalAcceptanceRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aLer, setALer] = useState<LegalDocumentView | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([legalDocuments(), legalHistory()])
      .then(([d, h]) => {
        if (!vivo) return;
        setDocs(d);
        setHistory(h);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível carregar."));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <Panel>
      <PanelHead title="Documentos legais" />
      {erro && <p className="px-5 py-4 text-meta text-risk">{erro}</p>}
      {!erro && (!docs || !history) && (
        <Spinner />
      )}
      {docs && history && (
        <>
          <ul className="divide-y divide-line">
            {docs.map((d) => {
              const aceite = history.find((h) => h.type === d.type && h.version === d.version);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-ink">{d.title}</p>
                    <p className="text-meta text-ink-3">
                      Versão {d.version} · em vigor desde {dataPT(d.effectiveAt)}
                      {aceite && <> · aceite em {dataPT(aceite.acceptedAt)}{aceite.onBehalfOfClub && !aceite.mine && ` por ${aceite.by}`}</>}
                    </p>
                  </div>
                  <button type="button" className="ctl-outline shrink-0" onClick={() => setALer(d)}>
                    Ler
                  </button>
                </li>
              );
            })}
            {docs.length === 0 && <li className="px-5 py-4 text-meta text-ink-3">Ainda não há documentos publicados.</li>}
          </ul>

          {history.length > 0 && (
            <div className="border-t border-line px-5 py-3">
              <p className="mb-2 text-group uppercase text-ink-3">Histórico de aceitações</p>
              <ul className="space-y-1">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-2">
                    <span className="tabular-nums text-ink-3">{dataPT(h.acceptedAt)}</span>
                    <span className="text-ink">
                      {h.title} v{h.version}
                    </span>
                    {h.onBehalfOfClub ? <Pill tone="signal">pelo clube{!h.mine && ` · ${h.by}`}</Pill> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {aLer && <ReadDialog doc={aLer} onClose={() => setALer(null)} />}
    </Panel>
  );
}
