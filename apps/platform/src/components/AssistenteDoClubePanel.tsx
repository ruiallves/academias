import { useState } from "react";
import { Panel, PanelHead } from "@/components/primitives";
import { apiPatch } from "@/lib/http";
import type { AssistenteDoClube } from "@/lib/types";

/**
 * O Assistente IA de um clube, na ficha dele: ligado ou desligado.
 *
 * ## Porque é que se liga aqui
 *
 * O assistente é um extra pago, e cada pedido custa dinheiro à Academias (o
 * fornecedor cobra por uso). Por isso nasce desligado em todos os clubes
 * (12/11/2026) e só a Academias o liga, clube a clube. `OWNER` e `ADMIN`
 * mudam, como o espaço e o plano; `SUPPORT` vê.
 *
 * Mesmo ligado, sem a chave da OpenAI na API não aparece a ninguém: o painel
 * diz isso, para não se ligar um clube e ficar à espera de algo que não vem.
 */
export function AssistenteDoClubePanel({ academyId, assistente: inicial, mayEdit }: { academyId: string; assistente: AssistenteDoClube; mayEdit: boolean }) {
  const [estado, setEstado] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(ligado: boolean) {
    setBusy(true);
    setErro(null);
    try {
      setEstado(await apiPatch<AssistenteDoClube>(`/academies/${academyId}/assistente`, { ligado }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Assistente IA" hint={estado.ligado ? "Ligado" : "Desligado"} />
      <div className="px-5 py-4">
        <p className="text-meta text-ink-3">
          {estado.ligado
            ? "O botão do assistente e a entrada no menu aparecem a quem usa a consola deste clube. Cada pessoa só faz pelo assistente o que já pode fazer na consola."
            : "O clube não vê o assistente. Liga-se quando o clube contratar o extra."}
        </p>
        {estado.ligado && !estado.chaveNaApi && (
          <p className="mt-2 text-meta text-warn">A API não tem a chave da OpenAI (OPENAI_API_KEY): mesmo ligado, o assistente não aparece até a chave estar definida.</p>
        )}
        {mayEdit && (
          <div className="mt-3 flex items-center gap-2">
            {estado.ligado ? (
              <button type="button" className="ctl-outline" disabled={busy} onClick={() => void mudar(false)}>
                Desligar o assistente
              </button>
            ) : (
              <button type="button" className="ctl-primary" disabled={busy} onClick={() => void mudar(true)}>
                Ligar o assistente
              </button>
            )}
          </div>
        )}
        {erro && <p className="mt-2 text-meta text-risk">{erro}</p>}
      </div>
    </Panel>
  );
}
