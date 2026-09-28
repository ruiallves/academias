import { useEffect, useState } from "react";
import { Panel, PanelHead, Pill } from "./primitives";
import { Spinner } from "./Busy";
import { money } from "@/lib/format";
import { dataPT } from "@/lib/legal";
import {
  declaracaoDaOrdem,
  guardarFicheiro,
  subscriptionOrders,
  type SubscriptionNotice,
  type SubscriptionOrders,
} from "@/lib/subscricao";
import { AssinarCondicoesDialog } from "./AssinarCondicoesDialog";
import { Download } from "@/lib/icons";

/**
 * As condições comerciais do clube, nas Definições.
 *
 * ## Porque é que isto vive aqui e não num email
 *
 * O email leva as condições e um botão; assinar acontece aqui, com sessão
 * iniciada. Um link que assinasse ao ser aberto punha um contrato à mercê de um
 * reencaminhamento de correio — e a assinatura vale precisamente por se saber
 * quem a fez.
 *
 * ## Quem assina
 *
 * Quem representa o clube. Não é este ecrã que o decide: o servidor manda
 * `podeAssinar`, com a mesma permissão que já decide quem aceita os Termos de
 * Serviço em nome do clube. Quem não a tem vê as condições — são o contrato do
 * clube onde trabalha — e não vê o botão.
 */
export function ContratoPanel() {
  const [dados, setDados] = useState<SubscriptionOrders | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = () =>
    subscriptionOrders()
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível carregar."));

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [aAssinar, setAAssinar] = useState(false);

  /* A declaração em PDF: vem em base64 pelo cliente autenticado, e guarda-se. */
  async function descarregar(id: string) {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await declaracaoDaOrdem(id);
      guardarFicheiro(r.ficheiro, r.base64);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível descarregar a declaração.");
    } finally {
      setBusy(false);
    }
  }

  /* Sem condições emitidas não há nada a mostrar — e um painel vazio nas
     Definições é uma pergunta sem resposta para quem o lê. */
  if (!erro && dados && !dados.pendente && !dados.assinada) return null;

  const ordem = dados?.pendente ?? dados?.assinada ?? null;
  const porAssinar = Boolean(dados?.pendente);

  return (
    <Panel>
      <PanelHead title="Condições da subscrição">
        {porAssinar ? <Pill tone="warn">por assinar</Pill> : ordem?.signedAt ? <Pill tone="ok">assinadas</Pill> : null}
      </PanelHead>

      {erro && <p className="px-5 py-4 text-meta text-risk">{erro}</p>}
      {!erro && !dados && <Spinner />}

      {ordem && (
        <>
          <dl className="divide-y divide-line">
            <Linha rotulo="Plano" valor={ordem.planName} />
            <Linha
              rotulo="Preço"
              valor={
                <>
                  <span className="tabular">{money(ordem.amountCents)}</span>{" "}
                  {ordem.billingPeriod === "ANNUAL" ? "por ano" : "por mês"}
                  {/*
                    No anual, a mensalidade que o clube fica a pagar, e a de tabela
                    ao lado para se ver o desconto.

                    Dizia só "(19,99 €/mês de tabela, menos 10%)": o clube via o
                    preço que não paga e tinha de fazer a conta para saber o que
                    paga. A mensalidade é o ano a dividir por doze — o mesmo número
                    que o site anuncia no plano anual.
                  */}
                  {ordem.discountPct > 0 && (
                    <span className="text-ink-3">
                      {" "}
                      ({money(ordem.billingPeriod === "ANNUAL" ? Math.round(ordem.amountCents / 12) : ordem.amountCents)}
                      /mês em vez de {money(ordem.listMonthlyCents)}, menos {ordem.discountPct}%)
                    </span>
                  )}
                </>
              }
            />
            <Linha rotulo="Periodicidade" valor={ordem.billingPeriod === "ANNUAL" ? "Anual" : "Mensal"} />
            <Linha rotulo="Data de início" valor={dataPT(ordem.startsOn)} />
            <Linha rotulo="Período contratual mínimo" valor={periodoMinimo(ordem.minimumMonths)} />
            {ordem.renewalNote && <Linha rotulo="Renovação" valor={ordem.renewalNote} />}
            {ordem.notes && <Linha rotulo="Observações" valor={ordem.notes} />}
            {!porAssinar && ordem.institutionName && (
              <Linha
                rotulo="Instituição"
                valor={`${ordem.institutionName}${ordem.institutionTaxId ? ` · NIF ${ordem.institutionTaxId}` : ""}`}
              />
            )}
          </dl>

          <div className="border-t border-line px-5 py-3">
            {ordem.signedAt && !porAssinar ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-meta leading-relaxed text-ink-3">
                  Assinadas em {dataPT(ordem.signedAt)}
                  {ordem.signerName ? ` por ${ordem.signerName}` : ""}
                  {ordem.signerTitle ? ` (${ordem.signerTitle})` : ""}.
                  {ordem.termsVersion ? ` Aplicam-se os Termos de Serviço v${ordem.termsVersion}.` : ""}
                </p>
                {/* Só a quem pode assinar: a declaração leva o NIF e a data de
                    nascimento de quem assinou. */}
                {ordem.temDeclaracao && dados?.podeAssinar && (
                  <button type="button" className="ctl-outline shrink-0" disabled={busy} onClick={() => void descarregar(ordem.id)}>
                    <Download className="size-3.5" strokeWidth={1.75} />
                    Declaração (PDF)
                  </button>
                )}
              </div>
            ) : dados?.podeAssinar ? (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="ctl-primary" disabled={busy} onClick={() => setAAssinar(true)}>
                  Assinar as condições
                </button>
                <p className="min-w-0 flex-1 text-meta leading-relaxed text-ink-3">
                  {/*
                    Numa ordem reemitida só para voltar a assinar, diz-se porquê:
                    as condições são as mesmas, e um clube que já tinha assinado
                    pergunta com razão o que é que mudou.
                  */}
                  {ordem.billingAnchorAt
                    ? "As condições são as mesmas que já tinham assinado. Voltam a ser assinadas com a identificação da instituição e de quem a representa, e passam a ter uma declaração em PDF."
                    : "Pede-se a identificação da instituição e de quem a representa, e fica uma declaração em PDF."}
                  {ordem.termsVersion ? ` Aplicam-se os Termos de Serviço v${ordem.termsVersion}.` : ""}
                </p>
              </div>
            ) : (
              /*
                Quem não representa o clube lê as condições e não as assina. Dizer
                de quem é a assinatura evita a pergunta seguinte — e evita que
                alguém espere por um botão que não vai aparecer.
              */
              <p className="text-meta leading-relaxed text-ink-3">
                Estas condições são assinadas por quem representa o clube
                {ordem.sentToName ? ` — foram enviadas a ${ordem.sentToName}` : ""}.
              </p>
            )}
          </div>
        </>
      )}

      <Avisos avisos={dados?.avisos ?? []} />

      {aAssinar && dados?.pendente && (
        <AssinarCondicoesDialog
          ordem={dados.pendente}
          sugestao={dados.sugestao}
          onClose={() => setAAssinar(false)}
          onSigned={() => {
            setAAssinar(false);
            void carregar();
          }}
        />
      )}
    </Panel>
  );
}

/**
 * Os avisos de pagamento que já saíram.
 *
 * ## Porque é que isto se mostra
 *
 * Porque o aviso é um email, e um email é uma coisa que se perde. Quem trata das
 * contas do clube tem de poder confirmar sozinho o que foi pedido, quando, e
 * para onde foi — sem ligar a ninguém. É a mesma razão por que a ficha do sócio
 * mostra as quotas lançadas em vez de confiar na caixa de correio dele.
 *
 * Um aviso por enviar aparece a dizê-lo: o clube deve o mesmo dinheiro, e não é
 * o email que cria a dívida.
 */
function Avisos({ avisos }: { avisos: SubscriptionNotice[] }) {
  if (avisos.length === 0) return null;

  return (
    <div className="border-t border-line">
      <header className="flex items-baseline gap-2.5 px-5 pt-4 pb-1">
        <h3 className="text-panel text-ink">Avisos de pagamento</h3>
        <span className="text-meta text-ink-3">os mais recentes</span>
      </header>
      <ul className="divide-y divide-line">
        {avisos.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-2.5">
            <span className="min-w-0 text-body text-ink-2">
              {dataPT(a.periodStart)} a {dataPT(a.periodEnd)}
            </span>
            <span className="flex items-baseline gap-2.5">
              <span className="text-meta text-ink-3">
                {a.sentAt ? `enviado a ${dataPT(a.sentAt)}` : "por enviar"}
              </span>
              <span className="text-body text-ink tabular">{money(a.amountCents)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="px-5 pt-1 pb-3 text-meta leading-relaxed text-ink-3">
        Saem para quem representa o clube, no dia do mês em que as condições foram assinadas.
      </p>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-2.5">
      <dt className="text-meta text-ink-3">{rotulo}</dt>
      <dd className="text-body text-ink">{valor}</dd>
    </div>
  );
}

/**
 * "Sem período mínimo", "2 anos", "18 meses".
 *
 * A mesma frase do email e da plataforma (ver `condicoes.ts` na API): um mínimo
 * de um mês é o próprio mês, e escrevê-lo como "1 mês" fazia parecer fidelização
 * onde não há nenhuma.
 */
function periodoMinimo(meses: number): string {
  if (meses <= 1) return "Sem período mínimo";
  if (meses % 12 === 0) {
    const anos = meses / 12;
    return `${anos} ${anos === 1 ? "ano" : "anos"}`;
  }
  return `${meses} meses`;
}
