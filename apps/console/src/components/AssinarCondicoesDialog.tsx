import { useId, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { ReadDialog } from "./LegalGate";
import { FileText, PenLine } from "@/lib/icons";
import { money } from "@/lib/format";
import { dataPT } from "@/lib/legal";
import { nifValido, signSubscriptionOrder, type SubscriptionOrder, type SubscriptionOrders } from "@/lib/subscricao";

/**
 * Assinar as condições de subscrição, com a identificação de quem se vincula.
 *
 * ## Porque é que deixou de ser um botão
 *
 * Era um clique: ficava registado quem, quando e de onde, mas não **em nome de
 * que instituição** nem com que identificação de quem a representa. Um contrato
 * com um clube tem de dizer as duas coisas. Agora pede-se:
 *
 * - a **instituição** — o nome e o NIF da pessoa colectiva que fica vinculada;
 * - quem a **representa** — nome completo, NIF e data de nascimento;
 * - a **declaração** de que aceita, em nome dela, as condições e os Termos.
 *
 * Com isso o servidor gera uma declaração em PDF, que fica anexada às condições
 * e se descarrega aqui e na plataforma.
 *
 * ## O que vem já escrito
 *
 * A instituição da última assinatura, ou o nome do clube. Os dados pessoais do
 * representante não: quem assina pode ser outra pessoa, e pré-preencher o NIF
 * de alguém era mostrá-lo a quem abrisse o diálogo.
 */
export function AssinarCondicoesDialog({
  ordem,
  sugestao,
  onClose,
  onSigned,
}: {
  ordem: SubscriptionOrder;
  sugestao: SubscriptionOrders["sugestao"];
  onClose: () => void;
  onSigned: () => void;
}) {
  const [institutionName, setInstitutionName] = useState(sugestao?.institutionName ?? "");
  const [institutionTaxId, setInstitutionTaxId] = useState(sugestao?.institutionTaxId ?? "");
  const [signerName, setSignerName] = useState(sugestao?.signerName ?? "");
  const [signerTaxId, setSignerTaxId] = useState("");
  const [signerBirthdate, setSignerBirthdate] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [aLer, setALer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idAceito = useId();

  const nifInst = institutionTaxId.replace(/[\s.]/g, "");
  const nifRep = signerTaxId.replace(/[\s.]/g, "");

  /*
   * Os avisos aparecem só quando o campo já tem nove algarismos: dizer "NIF
   * inválido" ao terceiro algarismo é gritar com quem ainda está a escrever.
   */
  const erroNifInst = nifInst.length >= 9 && !nifValido(nifInst) ? "Este NIF não é válido." : null;
  const erroNifRep =
    nifRep.length >= 9 && !nifValido(nifRep)
      ? "Este NIF não é válido."
      : nifRep.length === 9 && nifRep === nifInst
        ? "Tem de ser o NIF do representante, e não o da instituição."
        : null;

  const pronto =
    institutionName.trim().length >= 3 &&
    nifValido(nifInst) &&
    signerName.trim().split(/\s+/).length >= 2 &&
    nifValido(nifRep) &&
    nifRep !== nifInst &&
    /^\d{4}-\d{2}-\d{2}$/.test(signerBirthdate) &&
    accepted &&
    !busy;

  async function assinar() {
    if (!pronto) return;
    setBusy(true);
    setErro(null);
    try {
      await signSubscriptionOrder({
        institutionName: institutionName.trim(),
        institutionTaxId: nifInst,
        signerName: signerName.trim(),
        signerTaxId: nifRep,
        signerBirthdate,
        accepted,
      });
      onSigned();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível assinar.");
      setBusy(false);
    }
  }

  const nomeDaInstituicao = institutionName.trim() || "a instituição";
  const preco =
    ordem.billingPeriod === "ANNUAL"
      ? `${money(ordem.amountCents)} por ano (${money(Math.round(ordem.amountCents / 12))}/mês)`
      : `${money(ordem.amountCents)} por mês`;

  return (
    <>
      <Dialog
        labelledBy="assinar-condicoes"
        title="Assinar as condições"
        subtitle={`Plano ${ordem.planName} · ${preco} · início a ${dataPT(ordem.startsOn)}`}
        icon={<PenLine className="size-4" strokeWidth={1.75} />}
        onClose={onClose}
        width={520}
        footer={
          <>
            {erro && <span className="mr-auto text-meta text-risk">{erro}</span>}
            <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="ctl-primary" disabled={!pronto} onClick={() => void assinar()}>
              {busy ? "A assinar…" : "Assinar"}
            </button>
          </>
        }
      >
        <div className="space-y-5 p-5">
          <section className="space-y-3">
            <h3 className="text-meta font-semibold uppercase tracking-wide text-ink-3">A instituição</h3>
            <DialogField label="Nome da instituição" hint="como consta no registo">
              <input
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                maxLength={160}
                placeholder="Associação Desportiva de…"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="NIF da instituição" hint={erroNifInst ?? "pessoa colectiva"}>
              <input
                value={institutionTaxId}
                onChange={(e) => setInstitutionTaxId(e.target.value)}
                inputMode="numeric"
                maxLength={11}
                placeholder="5xx xxx xxx"
                className={dialogInputClass + " tabular" + (erroNifInst ? " border-risk" : "")}
              />
            </DialogField>
          </section>

          <section className="space-y-3">
            <h3 className="text-meta font-semibold uppercase tracking-wide text-ink-3">Quem a representa</h3>
            <DialogField label="Nome completo">
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                maxLength={160}
                autoComplete="name"
                className={dialogInputClass}
              />
            </DialogField>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
              <DialogField label="NIF" hint={erroNifRep ?? undefined}>
                <input
                  value={signerTaxId}
                  onChange={(e) => setSignerTaxId(e.target.value)}
                  inputMode="numeric"
                  maxLength={11}
                  className={dialogInputClass + " tabular" + (erroNifRep ? " border-risk" : "")}
                />
              </DialogField>
              <DialogField label="Data de nascimento">
                <input
                  type="date"
                  value={signerBirthdate}
                  onChange={(e) => setSignerBirthdate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className={dialogInputClass}
                />
              </DialogField>
            </div>
          </section>

          {/*
            A declaração.

            O `<label>` cobre só a frase e liga-se à caixa pelo `id`; o botão de
            ler os Termos fica fora dele. Dentro, um toque no botão marcava a
            caixa — que é aceitar sem ler, e é o que este ecrã não pode deixar
            acontecer. Ver `check:toque`.
          */}
          <div className="rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
            <div className="flex items-start gap-2.5">
              <input
                id={idAceito}
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-signal)]"
              />
              <label htmlFor={idAceito} className="min-w-0 cursor-pointer text-meta leading-relaxed text-ink-2">
                Declaro que tenho poderes para representar <strong className="font-medium text-ink">{nomeDaInstituicao}</strong>{" "}
                e que aceito, em nome dela, estas condições de subscrição e os Termos de Serviço
                {ordem.termsVersion ? ` (versão ${ordem.termsVersion})` : ""}, de que fazem parte o Acordo de Tratamento de
                Dados e a Política de Utilização Aceitável. Os dados acima são verdadeiros.
              </label>
            </div>
            <button type="button" className="ctl-ghost mt-2 h-7 text-meta" onClick={() => setALer(true)}>
              <FileText className="size-3.5" strokeWidth={1.75} />
              Ler os Termos de Serviço
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-4">
            Fica registado com a data, a hora e o endereço de onde assinas, e é gerada uma declaração em PDF que podes
            descarregar a seguir.
          </p>
        </div>
      </Dialog>

      {aLer && (
        <ReadDialog
          doc={{ slug: "termos-de-servico", title: "Termos de Serviço", version: ordem.termsVersion ?? "" }}
          onClose={() => setALer(false)}
        />
      )}
    </>
  );
}
