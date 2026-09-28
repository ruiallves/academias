import { useState } from "react";
import { Download } from "lucide-react";
import { Panel, PanelHead, Pill } from "./primitives";
import { apiGet } from "@/lib/http";
import { euros, shortDate } from "@/lib/format";
import type { OrdemDoClube } from "@/lib/types";

/**
 * As condições de subscrição de um clube, na ficha dele.
 *
 * O servidor já as mandava com a ficha e ninguém as mostrava: para saber se um
 * clube tinha assinado, e em nome de quem, era preciso ir à base de dados. Aqui
 * fica o que está por assinar, o que foi assinado, a identificação que quem
 * assinou escreveu, e a declaração em PDF para descarregar.
 */
export function CondicoesDoClubePanel({ academyId, orders }: { academyId: string; orders: { pendente: OrdemDoClube | null; assinada: OrdemDoClube | null } }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { pendente, assinada } = orders;

  async function descarregar(ordem: OrdemDoClube) {
    setBusy(true);
    setErro(null);
    try {
      // Em base64 pelo cliente autenticado: um link não leva o token do painel.
      const r = await apiGet<{ ficheiro: string; base64: string }>(`/academies/${academyId}/ordens/${ordem.id}/declaracao`);
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.ficheiro;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível descarregar.");
    } finally {
      setBusy(false);
    }
  }

  if (!pendente && !assinada) {
    return (
      <Panel>
        <PanelHead title="Condições da subscrição" />
        <p className="px-5 py-4 text-meta text-ink-3">Ainda não foram emitidas condições para este clube.</p>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead title="Condições da subscrição">
        {pendente ? <Pill tone="warn">por assinar</Pill> : <Pill tone="ok">assinadas</Pill>}
      </PanelHead>

      {erro && <p className="px-5 pt-3 text-meta text-risk">{erro}</p>}

      {pendente && (
        <div className="border-b border-line px-5 py-3 last:border-b-0">
          <p className="text-body text-ink">
            {pendente.planName} · {preco(pendente)}
          </p>
          <p className="mt-0.5 text-meta text-ink-3">
            {pendente.billingAnchorAt
              ? "Reemitidas para voltarem a ser assinadas com a identificação da instituição (as condições são as mesmas)."
              : pendente.sentAt
                ? `Enviadas a ${pendente.sentToName ?? pendente.sentToEmail ?? "quem representa o clube"} a ${shortDate(pendente.sentAt)}.`
                : "Ainda não foram enviadas por email."}
          </p>
        </div>
      )}

      {assinada && (
        <div className="px-5 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">
                {assinada.planName} · {preco(assinada)}
              </p>
              <p className="mt-0.5 text-meta text-ink-3">
                Assinadas a {assinada.signedAt ? shortDate(assinada.signedAt) : "—"}
                {assinada.signerName ? ` por ${assinada.signerName}` : ""}
                {assinada.signerTitle ? ` (${assinada.signerTitle})` : ""}
                {assinada.termsVersion ? ` · Termos v${assinada.termsVersion}` : ""}
              </p>
            </div>
            {assinada.temDeclaracao && (
              <button type="button" className="ctl-outline shrink-0" disabled={busy} onClick={() => void descarregar(assinada)}>
                <Download className="size-3.5" strokeWidth={1.75} />
                Declaração (PDF)
              </button>
            )}
          </div>

          {assinada.institutionTaxId ? (
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
              <dt className="text-ink-3">Instituição</dt>
              <dd className="text-ink-2">
                {assinada.institutionName} · NIF {assinada.institutionTaxId}
              </dd>
              <dt className="text-ink-3">Representante</dt>
              <dd className="text-ink-2">
                {assinada.signerName}
                {assinada.signerTaxId ? ` · NIF ${assinada.signerTaxId}` : ""}
                {assinada.signerBirthdate ? ` · nascido/a a ${shortDate(assinada.signerBirthdate)}` : ""}
              </dd>
              {assinada.declaracaoSha256 && (
                <>
                  <dt className="text-ink-3">SHA-256</dt>
                  <dd className="select-all break-all font-mono text-[10.5px] text-ink-4">{assinada.declaracaoSha256}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
              Assinadas antes de se pedir a identificação da instituição: não têm declaração em PDF.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function preco(o: OrdemDoClube): string {
  if (o.billingPeriod !== "ANNUAL") return `${euros(o.amountCents)}/mês`;
  return `${euros(o.amountCents)}/ano (${euros(Math.round(o.amountCents / 12))}/mês)`;
}
