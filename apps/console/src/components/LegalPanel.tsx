import { useEffect, useState } from "react";
import { Pill } from "./primitives";
import { Bloco, Erro, Lista, Linha } from "./definicoes/ui";
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

  if (erro) return <Erro>{erro}</Erro>;
  if (!docs || !history) return <Spinner />;

  return (
    <>
      <Bloco
        titulo="Em vigor"
        descricao="Os documentos que regem o uso da plataforma. Não se editam aqui: quando sai uma versão nova, é pedida a aceitação à entrada."
      >
        {docs.length === 0 ? (
          <p className="text-meta text-ink-3">Ainda não há documentos publicados.</p>
        ) : (
          <Lista>
            <ul>
              {docs.map((d) => {
                const aceite = history.find((h) => h.type === d.type && h.version === d.version);
                return (
                  <Linha key={d.id}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-body font-medium text-ink">{d.title}</span>
                        <Pill>v{d.version}</Pill>
                      </div>
                      <p className="text-meta text-ink-3">
                        Em vigor desde {dataPT(d.effectiveAt)}
                        {aceite && (
                          <>
                            {" "}
                            · aceite em {dataPT(aceite.acceptedAt)}
                            {aceite.onBehalfOfClub && !aceite.mine && ` por ${aceite.by}`}
                          </>
                        )}
                      </p>
                    </div>
                    <button type="button" className="ctl-outline shrink-0" onClick={() => setALer(d)}>
                      Ler
                    </button>
                  </Linha>
                );
              })}
            </ul>
          </Lista>
        )}
      </Bloco>

      {history.length > 0 && (
        <Bloco
          titulo="Aceitações"
          descricao="O que esta conta, e o clube por quem o representa, já aceitou, versão a versão."
        >
          <Lista>
            <ul>
              {history.map((h) => (
                <Linha key={h.id} className="py-2.5">
                  <span className="w-24 shrink-0 text-meta text-ink-3 tabular">{dataPT(h.acceptedAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    {h.title} <span className="text-ink-3">v{h.version}</span>
                  </span>
                  {h.onBehalfOfClub ? <Pill tone="signal">pelo clube{!h.mine && ` · ${h.by}`}</Pill> : null}
                </Linha>
              ))}
            </ul>
          </Lista>
        </Bloco>
      )}

      {aLer && <ReadDialog doc={aLer} onClose={() => setALer(null)} />}
    </>
  );
}
