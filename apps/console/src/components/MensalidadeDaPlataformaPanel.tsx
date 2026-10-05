import { useCallback, useEffect, useRef, useState } from "react";
import { Pill } from "./primitives";
import { Bloco, Erro, Lista, Linha, campoClass } from "./definicoes/ui";
import { Spinner } from "./Busy";
import { money } from "@/lib/format";
import { Download } from "@/lib/icons";
import {
  estadoDaMensalidade,
  faturaDaMensalidade,
  guardarFicheiro,
  pedirMbway,
  pedirMultibanco,
  type EstadoDaMensalidade,
  type MensalidadeDaPlataforma,
} from "@/lib/subscricao";

/**
 * A mensalidade da plataforma, nas Definições: o que está em falta, como se
 * paga, e o que já foi pago.
 *
 * ## Dois métodos, pela euPago da plataforma
 *
 * MB WAY (um pedido para o telemóvel de quem paga) ou uma referência
 * Multibanco. Os dois confirmam-se pelo webhook da euPago, e é por isso que a
 * secção **relê o estado** depois de um pedido MB WAY: o pagamento aceita-se
 * no telemóvel, e o ecrã tem de dar por ele sem ninguém carregar em nada.
 *
 * ## Quem vê o botão
 *
 * Quem representa o clube ou gere as definições; vem do servidor
 * (`podePagar`), não se recalcula aqui. Os outros veem o estado: é a conta do
 * clube onde trabalham, e saber que está em falta não é segredo.
 *
 * ## O mesmo painel no ecrã de clube suspenso
 *
 * `bloqueio` é o modo do `ClubeSuspenso` (`AcademyBoot`): a consola está
 * fechada e isto é a única coisa que se vê, por isso o texto diz-o e o botão
 * de reabrir aparece quando o pagamento chega.
 */
export function MensalidadeDaPlataformaPanel({ bloqueio = false, onPago }: { bloqueio?: boolean; onPago?: () => void }) {
  const [dados, setDados] = useState<EstadoDaMensalidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(
    () =>
      estadoDaMensalidade()
        .then((d) => {
          setDados(d);
          setErro(null);
          return d;
        })
        .catch((e) => {
          setErro(e instanceof Error ? e.message : "Não foi possível carregar.");
          return null;
        }),
    [],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /*
   * A releitura depois de um pedido MB WAY: de cinco em cinco segundos, durante
   * cinco minutos. Pára sozinha quando a mensalidade deixa de estar em falta.
   */
  const relogio = useRef<number | null>(null);
  const pararDeVigiar = () => {
    if (relogio.current) window.clearInterval(relogio.current);
    relogio.current = null;
  };
  const vigiar = () => {
    pararDeVigiar();
    const fim = Date.now() + 5 * 60_000;
    relogio.current = window.setInterval(async () => {
      const d = await carregar();
      if (Date.now() > fim || (d && d.emFalta.every((m) => !m.mbway || m.mbway.status !== "PENDING"))) pararDeVigiar();
    }, 5000);
  };
  useEffect(() => pararDeVigiar, []);

  /* Pago e sem mais nada em falta: quem está no ecrã de bloqueio pode entrar. */
  useEffect(() => {
    if (bloqueio && dados && dados.emFalta.length === 0 && dados.historico.length > 0) onPago?.();
  }, [bloqueio, dados, onPago]);

  if (erro && !dados) return <Erro>{erro}</Erro>;
  if (!dados) return <Spinner className="py-6" />;

  const anual = dados.plano?.billingPeriod === "ANNUAL";
  const nome = anual ? "anuidade" : "mensalidade";

  return (
    <>
      {erro && <Erro>{erro}</Erro>}

      <Bloco
        titulo={dados.emFalta.length > 0 ? `${anual ? "Anuidade" : "Mensalidade"} em falta` : "Mensalidade"}
        estado={
          dados.suspenso ? (
            <Pill tone="risk">acesso suspenso</Pill>
          ) : dados.emFalta.some((m) => m.vencida) ? (
            <Pill tone="risk">vencida</Pill>
          ) : dados.emFalta.length > 0 ? (
            <Pill tone="warn">por pagar</Pill>
          ) : dados.plano ? (
            <Pill tone="ok">em dia</Pill>
          ) : undefined
        }
        descricao={
          dados.plano ? (
            <>
              <p>
                O clube paga {money(dados.plano.amountCents)} {anual ? "por ano" : "por mês"} pelo plano{" "}
                <strong className="text-ink-2">{dados.plano.name}</strong>, com IVA incluído. A {nome} paga-se no
                início de cada período, por MB WAY ou com referência Multibanco.
              </p>
              <p>
                Sem pagamento até ao fim do período, o acesso do clube à consola e à app fica suspenso até o pagamento
                chegar. A factura é emitida depois do pagamento e enviada por email a quem representa o clube.
              </p>
            </>
          ) : (
            <p>O clube está em avaliação, ou ainda sem plano activo: não há nada a pagar por agora.</p>
          )
        }
      >
        {dados.emFalta.length === 0 ? (
          <p className="text-body text-ink-3">
            {dados.plano
              ? `Não há nenhuma ${nome} em falta. A próxima aparece aqui no dia em que o período começar.`
              : "Quando o clube passar a pagar, a mensalidade aparece aqui."}
          </p>
        ) : (
          <div className="space-y-4">
            {dados.emFalta.map((m) => (
              <EmFalta
                key={m.id}
                m={m}
                podePagar={dados.podePagar}
                bloqueio={bloqueio}
                onMudou={carregar}
                onMbway={vigiar}
              />
            ))}
          </div>
        )}
      </Bloco>

      {dados.historico.length > 0 && (
        <Bloco
          titulo="Pagas"
          descricao="As mensalidades já recebidas, da mais recente para trás, com a fatura de cada uma quando já foi emitida."
        >
          <Lista>
            <ul>
              {dados.historico.map((m) => (
                <Linha key={m.id} className="py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{m.periodo}</span>
                    <span className="block text-meta text-ink-4">
                      {m.paidAt ? `paga a ${dia(m.paidAt)}` : ""}
                      {m.metodo ? ` · ${m.metodo}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-body text-ink tabular">{money(m.amountCents)}</span>
                  {/* A fatura que a plataforma anexou a este pagamento. */}
                  {m.fatura && dados.podePagar ? (
                    <button
                      type="button"
                      className="ctl-ghost shrink-0"
                      onClick={() =>
                        void faturaDaMensalidade(m.id)
                          .then((r) => guardarFicheiro(r.ficheiro, r.base64))
                          .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível descarregar a fatura."))
                      }
                    >
                      <Download className="size-3.5" strokeWidth={1.75} />
                      Fatura
                    </button>
                  ) : (
                    <span className="w-[72px] shrink-0 text-right text-meta text-ink-4">{m.fatura ? "fatura" : "fatura a seguir"}</span>
                  )}
                </Linha>
              ))}
            </ul>
          </Lista>
        </Bloco>
      )}
    </>
  );
}

/** Uma mensalidade por pagar: o período, o valor, e as duas formas de pagar. */
function EmFalta({
  m,
  podePagar,
  bloqueio,
  onMudou,
  onMbway,
}: {
  m: MensalidadeDaPlataforma;
  podePagar: boolean;
  bloqueio: boolean;
  onMudou: () => Promise<unknown>;
  onMbway: () => void;
}) {
  const [busy, setBusy] = useState<"mb" | "mbway" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [telefone, setTelefone] = useState("");
  const [aPedirMbway, setAPedirMbway] = useState(false);

  async function multibanco() {
    if (busy) return;
    setBusy("mb");
    setErro(null);
    try {
      await pedirMultibanco(m.id);
      await onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível pedir a referência.");
    } finally {
      setBusy(null);
    }
  }

  async function mbway() {
    if (busy) return;
    setBusy("mbway");
    setErro(null);
    try {
      await pedirMbway(m.id, telefone);
      setAPedirMbway(false);
      await onMudou();
      onMbway();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o pedido MB WAY.");
    } finally {
      setBusy(null);
    }
  }

  const aConfirmar = m.mbway?.status === "PENDING";

  return (
    <div className="rounded-[12px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">{m.planName} · {m.periodo}</p>
          <p className="mt-0.5 text-meta text-ink-3">
            {m.vencida
              ? `O período acabou a ${dia(m.periodEnd)} sem pagamento.`
              : `Pagar até ${dia(m.periodEnd)}.`}
          </p>
        </div>
        <span className="text-[20px] font-semibold leading-none tracking-[-0.01em] text-ink tabular">{money(m.amountCents)}</span>
      </div>

      {erro && <div className="mt-3"><Erro>{erro}</Erro></div>}

      {!podePagar ? (
        <p className="mt-3 text-meta text-ink-3">
          Só quem representa o clube pode pagar. {bloqueio ? "Pede a quem o representa que entre na consola." : ""}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {aConfirmar && (
            <div className="rounded-[10px] bg-sunken px-3.5 py-3 text-meta leading-relaxed text-ink-2">
              <span className="font-medium text-ink">Pedido MB WAY enviado</span> para {m.mbway?.phone}. Confirma na app
              MB WAY nos próximos minutos: assim que o pagamento for aceite, isto actualiza-se sozinho.
            </div>
          )}
          {m.mbway?.status === "FAILED" && !aConfirmar && (
            <p className="text-meta text-risk">O último pedido MB WAY foi recusado ou cancelado. Podes tentar outra vez.</p>
          )}

          {m.multibanco ? (
            <div className="rounded-[10px] border border-line px-3.5 py-3">
              <p className="mb-2 text-meta font-medium text-ink-2">Referência Multibanco</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-body">
                <dt className="text-ink-3">Entidade</dt>
                <dd className="font-mono text-ink tabular">{m.multibanco.entity ?? "—"}</dd>
                <dt className="text-ink-3">Referência</dt>
                <dd className="font-mono text-ink tabular">{espacos(m.multibanco.reference)}</dd>
                <dt className="text-ink-3">Valor</dt>
                <dd className="text-ink tabular">{money(m.multibanco.amountCents)}</dd>
              </dl>
              {m.multibanco.expiresAt && (
                <p className="mt-2 text-meta text-ink-4">Válida até {dia(m.multibanco.expiresAt)}. Depois de paga, demora umas horas a confirmar.</p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {!m.multibanco && (
              <button type="button" className="ctl-outline" disabled={busy !== null} onClick={() => void multibanco()}>
                {busy === "mb" ? "A pedir…" : "Referência Multibanco"}
              </button>
            )}
            {!aPedirMbway && !aConfirmar && (
              <button type="button" className="ctl-primary" disabled={busy !== null} onClick={() => setAPedirMbway(true)}>
                Pagar por MB WAY
              </button>
            )}
          </div>

          {aPedirMbway && !aConfirmar && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void mbway();
              }}
            >
              <div className="min-w-[200px] flex-1">
                <div className="mb-1.5 text-meta font-medium text-ink-2">Telemóvel com MB WAY</div>
                <input
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="9xx xxx xxx"
                  className={campoClass}
                  autoFocus
                />
              </div>
              <button type="submit" className="ctl-primary" disabled={busy !== null || telefone.replace(/\D/g, "").length < 9}>
                {busy === "mbway" ? "A enviar…" : "Enviar pedido"}
              </button>
              <button type="button" className="ctl-ghost" disabled={busy !== null} onClick={() => setAPedirMbway(false)}>
                Cancelar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** "5 de outubro de 2026". */
function dia(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "123 456 789": a referência como está no multibanco. */
function espacos(ref: string | null): string {
  if (!ref) return "—";
  return ref.replace(/\D/g, "").replace(/(\d{3})(?=\d)/g, "$1 ");
}
