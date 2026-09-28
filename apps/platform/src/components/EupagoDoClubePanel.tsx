import { useState } from "react";
import { Panel, PanelHead } from "@/components/primitives";
import { apiPatch } from "@/lib/http";
import type { EupagoDoClube } from "@/lib/types";

/**
 * Os pagamentos euPago de um clube, na ficha dele.
 *
 * ## O que um clube com conta própria faz, e o que se faz aqui
 *
 * O clube configura no backoffice da euPago, no canal dele, o webhook com o
 * **endereço que este painel mostra** (um por clube) e uma chave escrita por
 * ele. Manda-nos essa chave e a chave de API do canal, e colam-se aqui. A
 * partir daí os pagamentos desse clube são criados no canal dele (o dinheiro
 * vai para o IBAN dele) e os avisos de pagamento verificam-se com a chave dele,
 * e só podem mexer em pagamentos deste clube.
 *
 * As chaves nunca voltam a aparecer depois de gravadas — o painel só diz se
 * estão definidas. Para trocar, escreve-se a nova por cima; "Apagar" devolve o
 * clube à conta da plataforma (chave de API) ou ao webhook global.
 *
 * `OWNER` e `ADMIN`, como o plano: é o que decide para onde vai o dinheiro.
 */
export function EupagoDoClubePanel({
  academyId,
  eupago: inicial,
  mayEdit,
}: {
  academyId: string;
  eupago: EupagoDoClube;
  mayEdit: boolean;
}) {
  const [estado, setEstado] = useState(inicial);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const pronto = estado.apiKey && estado.webhookSecret;
  const secretCurto = secret.trim() !== "" && secret.trim().length < 16;

  async function gravar(body: { apiKey?: string; webhookSecret?: string }, mensagem: string) {
    setBusy(true);
    setErro(null);
    setOk(null);
    try {
      setEstado(await apiPatch<EupagoDoClube>(`/academies/${academyId}/eupago`, body));
      setApiKey("");
      setSecret("");
      setOk(mensagem);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(estado.webhookUrl);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* Sem acesso à área de transferência, o endereço está à vista para copiar à mão. */
    }
  }

  return (
    <Panel>
      <PanelHead
        title="Pagamentos euPago"
        hint={pronto ? "canal próprio do clube" : estado.apiKey || estado.webhookSecret ? "configuração a meio" : "conta da plataforma"}
      />
      <div className="space-y-4 px-5 py-4">
        <div>
          <div className="mb-1 text-meta font-medium text-ink">Webhook Endpoint deste clube</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] bg-sunken px-2.5 py-1.5 text-meta text-ink-2">
              {estado.webhookUrl}
            </code>
            <button type="button" className="ctl-outline" onClick={() => void copiar()}>
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
            É isto que o clube escreve em "Webhook Endpoint" no backoffice da euPago, com "Encriptar Webhook: Não" e
            todos os tipos marcados (Pagamento, Cancelamento, Expiração, Erro, Reembolso).
          </p>
        </div>

        <ul className="space-y-1 text-meta">
          <li className="flex items-center justify-between gap-2">
            <span className="text-ink-2">Chave de API do canal</span>
            <span className={estado.apiKey ? "text-ok" : "text-ink-4"}>{estado.apiKey ? "definida" : "por definir"}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-ink-2">Chave do webhook (Chave Criptográfica)</span>
            <span className={estado.webhookSecret ? "text-ok" : "text-ink-4"}>
              {estado.webhookSecret ? "definida" : "por definir"}
            </span>
          </li>
        </ul>

        {!pronto && (estado.apiKey || estado.webhookSecret) && (
          <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-warn">
            {estado.apiKey
              ? "Os pagamentos já vão para o canal do clube, mas sem a chave do webhook os avisos dele são recusados e nada passa a pago sozinho."
              : "Falta a chave de API: os pagamentos ainda são criados na conta da plataforma."}
          </p>
        )}

        {mayEdit && (
          <div className="space-y-2.5 border-t border-line pt-3.5">
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-ink">
                Chave de API do canal {estado.apiKey && <span className="font-normal text-ink-4">· escreve para substituir</span>}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={estado.apiKey ? "••••••••" : "xxxx-xxxx-xxxx-xxxx-xxxx"}
                className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body focus:border-line-strong focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-ink">
                Chave do webhook {estado.webhookSecret && <span className="font-normal text-ink-4">· escreve para substituir</span>}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={estado.webhookSecret ? "••••••••" : "a Chave Criptográfica que o clube escreveu"}
                className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body focus:border-line-strong focus:outline-none"
              />
            </label>
            {secretCurto && <p className="text-meta text-risk">A chave do webhook tem de ter pelo menos 16 caracteres.</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="ctl-primary"
                disabled={busy || secretCurto || (!apiKey.trim() && !secret.trim())}
                onClick={() =>
                  void gravar(
                    { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(secret.trim() ? { webhookSecret: secret.trim() } : {}) },
                    "Guardado. Fica no registo de auditoria, sem os valores.",
                  )
                }
              >
                {busy ? "A guardar…" : "Guardar"}
              </button>
              {(estado.apiKey || estado.webhookSecret) && (
                <button
                  type="button"
                  className="ctl-ghost text-ink-3 hover:text-risk"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Apagar as duas chaves? Os pagamentos deste clube voltam à conta da plataforma e ao webhook global.")) {
                      void gravar({ apiKey: "", webhookSecret: "" }, "Chaves apagadas: o clube voltou à conta da plataforma.");
                    }
                  }}
                >
                  Apagar chaves
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
