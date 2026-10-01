import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pill, cx } from "@/components/primitives";
import { Bloco, Erro, Interruptor, Lista } from "@/components/definicoes/ui";
import { brutoParaLiquido, detalhePorMetodo, loadEupagoFees, useEupagoFees, type MetodoComTaxa } from "@/lib/eupago-fees";
import { apiPatch } from "@/lib/http";
import { can } from "@/lib/permissions";
import { reloadAcademy, useStore } from "@/lib/store";
import { useSession } from "@/session";

/**
 * Pagamentos: se se paga pela app, quem suporta a comissão, quando o clube
 * cobra e como as famílias e os sócios pagam.
 *
 * Chamava-se "Mensalidades", e o nome ficou curto: o que aqui se decide vale
 * também para as quotas dos sócios. A chave da secção continua a ser
 * `mensalidades`, para as ligações que já existem não se partirem.
 *
 * ## Os dois interruptores
 *
 * **Pagamentos pela app** — desligado, nem famílias nem sócios pagam pela app:
 * as apps dizem que os pagamentos estão desativados, e o servidor recusa quem
 * tentar na mesma. O resto continua igual: preços, mensalidades, quotas e
 * marcar como pago à mão.
 *
 * **Taxa por conta de quem paga** — desligado (como nasce), a comissão da
 * euPago sai do que o clube recebe. Ligado, quem paga suporta a comissão do
 * método que escolher, e **os valores da plataforma passam a ser o que o clube
 * recebe**. É uma mudança de sentido de todos os números do clube, e por isso
 * o bloco mostra o exemplo com as contas feitas antes de se ligar.
 *
 * ## Porque deixou de ser três caixas de texto
 *
 * Esta secção dizia "euPago ligado", "Débito directo por activar" e "3 dias
 * antes do prazo, e no próprio dia" — três frases escritas no código, iguais
 * para todos os clubes e nenhuma lida de lado nenhum. Uma página de definições
 * que não mostra as definições do clube é um folheto.
 *
 * Agora mostra o que o clube tem mesmo: o **calendário de cobrança** (os doze
 * meses, com os que se cobram acesos), o **dia do prazo**, a mudança que está
 * agendada, se houver, e os **métodos** que a app oferece às famílias com o que
 * a euPago leva em cada um — a tabela que o servidor serve em `/billing/fees`.
 *
 * O calendário continua a editar-se nas Mensalidades, ao lado do que afecta
 * (gravar o calendário apaga os meses desligados, e isso confirma-se lá, com os
 * números à frente). Aqui lê-se.
 */

/** A época lê-se de Setembro a Agosto: é a ordem em que o clube pensa nos meses. */
const ORDEM = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
const CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EXTENSO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "2027-09" → "Setembro de 2027". */
const mesDe = (periodo: string) => `${EXTENSO[Number(periodo.slice(5, 7)) - 1]} de ${periodo.slice(0, 4)}`;

/** "0,07 € + 0,7 %", só com as parcelas que existem. */
function taxaDe(m: MetodoComTaxa): string {
  const partes: string[] = [];
  if (m.fixedCents > 0) partes.push(`${(m.fixedCents / 100).toFixed(2).replace(".", ",")} €`);
  if (m.percent > 0) partes.push(`${String(m.percent).replace(".", ",")} %`);
  return partes.length ? partes.join(" + ") : "sem comissão";
}

export function MensalidadesSection() {
  const { academy } = useStore();
  const { tabela, loaded } = useEupagoFees();

  useEffect(() => {
    void loadEupagoFees();
  }, []);

  const { session } = useSession();
  const mayWrite = can(session, "settings:write");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const meses = academy.billingMonths;
  const proxima = academy.billingNext;
  const oferecidos = tabela?.methods.filter((m) => m.offered) ?? [];
  const ligados = academy.paymentsEnabled;
  /*
   * Sem o canal euPago do clube, os pagamentos pela app não se ligam: o
   * servidor recusa, e o interruptor nem se oferece. Desligar dá sempre.
   */
  const semEupago = !academy.eupagoConfigured;
  const taxaDoPagador = academy.feesOnPayer;

  /* Um interruptor de cada vez: grava, e volta a ler o clube do servidor. */
  async function gravar(patch: { paymentsEnabled?: boolean; feesOnPayer?: boolean }) {
    setBusy(true);
    setErro(null);
    try {
      await apiPatch("/api/pagamentos/regras", patch);
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * O simulador do bloco da taxa. O valor é o que o clube escreveria na
   * plataforma, e é o mesmo nos dois cartões: num é o que a família paga, no
   * outro é o que o clube recebe. Escreve-se em euros, como em todo o lado.
   */
  const [simulado, setSimulado] = useState("20,00");
  const valor = Math.round(Number(simulado.replace(",", ".").replace(/[^\d.]/g, "")) * 100);
  const valido = Number.isFinite(valor) && valor > 0 && valor <= 100_000;
  const brutos = tabela && valido ? oferecidos.map((m) => brutoParaLiquido(valor, m, tabela.vatPercent)) : [];
  const liquidos = tabela && valido ? detalhePorMetodo(valor, tabela) : null;
  const exemplo =
    brutos.length && liquidos
      ? { min: Math.min(...brutos), max: Math.max(...brutos), recebeMin: liquidos.minCents, recebeMax: liquidos.maxCents }
      : null;
  const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
  const intervalo = (a: number, b: number) => (a === b ? eur(a) : `${eur(a)} a ${eur(b)}`);

  return (
    <>
      {erro && (
        <div className="mb-2">
          <Erro>{erro}</Erro>
        </div>
      )}

      <Bloco
        titulo="Pagamentos pela app"
        estado={!ligados ? <Pill tone="warn">{semEupago ? "euPago por configurar" : "desativados"}</Pill> : undefined}
        descricao="Se as famílias e os sócios podem pagar mensalidades e quotas pela app do clube."
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">{ligados ? "Ligados" : "Desligados"}</p>
            <p className="mt-1 max-w-[52ch] text-meta leading-relaxed text-ink-3">
              {ligados
                ? "As famílias e os sócios pagam pela app, por MB Way ou referência Multibanco."
                : "Na app aparece o que está por pagar, com o aviso de que os pagamentos estão desativados. Os preços, as mensalidades e as quotas continuam a configurar-se aqui, e marcam-se como pagos à mão."}
            </p>
          </div>
          <Interruptor
            ligado={ligados}
            disabled={busy || !mayWrite || (semEupago && !ligados)}
            onChange={() => void gravar({ paymentsEnabled: !ligados })}
            label="Pagamentos pela app"
          />
        </div>
        {semEupago && (
          <p className="mt-3 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-meta leading-relaxed text-ink-2">
            {ligados
              ? "O clube ainda não tem o euPago configurado. Se desligares os pagamentos pela app, só os voltas a ligar depois de o euPago estar configurado."
              : "Para ligar os pagamentos pela app, o clube precisa de ter o seu euPago configurado, para o dinheiro cair na conta do clube. Fala connosco e tratamos disso."}
          </p>
        )}
      </Bloco>

      <Bloco
        titulo="Taxa por conta de quem paga"
        estado={taxaDoPagador ? <Pill tone="signal">ligada</Pill> : undefined}
        descricao={
          <>
            <p>A euPago cobra uma comissão por cada pagamento, diferente de método para método.</p>
            <p>
              Desligado, a comissão sai do que o clube recebe. Ligado, é somada ao valor e paga por quem paga.
            </p>
          </>
        }
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">
              {taxaDoPagador ? "Quem paga suporta a taxa" : "O clube suporta a taxa"}
            </p>
            <p className="mt-1 max-w-[52ch] text-meta leading-relaxed text-ink-3">
              {taxaDoPagador ? (
                <>
                  Todos os valores escritos na plataforma são{" "}
                  <strong className="font-medium text-ink-2">o que o clube recebe</strong>. Na app, quem paga vê o valor
                  e a taxa do método em separado, antes de pagar.
                </>
              ) : (
                <>
                  Os valores escritos na plataforma são{" "}
                  <strong className="font-medium text-ink-2">o que a família paga</strong>. O clube recebe esse valor
                  menos a comissão.
                </>
              )}
            </p>
          </div>
          <Interruptor
            ligado={taxaDoPagador}
            disabled={busy || !mayWrite}
            onChange={() => void gravar({ feesOnPayer: !taxaDoPagador })}
            label="Taxa por conta de quem paga"
          />
        </div>

        {/*
          O simulador, com as contas nos dois sentidos. Ligar isto muda o que
          todos os números do clube querem dizer, e uma frase não chega para se
          perceber a diferença: dois cartões lado a lado, com o que está em
          vigor marcado. O clube escreve um valor dele e vê o resultado — num
          cartão escreve o que a família paga, no outro o que quer receber.
        */}
        {tabela && oferecidos.length > 0 && (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            <Simulador
              on={!taxaDoPagador}
              titulo="O clube suporta"
              entrada="A família paga"
              valor={simulado}
              onChange={setSimulado}
              saida="O clube recebe"
              resultado={exemplo ? intervalo(exemplo.recebeMin, exemplo.recebeMax) : "—"}
            />
            <Simulador
              on={taxaDoPagador}
              titulo="Quem paga suporta"
              entrada="O clube recebe"
              valor={simulado}
              onChange={setSimulado}
              saida="A família paga"
              resultado={exemplo ? intervalo(exemplo.min, exemplo.max) : "—"}
            />
          </div>
        )}
        {tabela && oferecidos.length > 0 && (
          <p className="mt-2 text-meta text-ink-4">
            Escreve um valor para simular. O intervalo vai do método mais barato ao mais caro.
          </p>
        )}
        {!ligados && (
          <p className="mt-3 text-meta text-ink-3">Com os pagamentos pela app desligados, ninguém paga taxa nenhuma.</p>
        )}
      </Bloco>

      <Bloco
        titulo="Calendário de cobrança"
        descricao="Os meses em que o clube cobra a mensalidade, e o dia até ao qual a família paga sem atraso."
      >
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-px overflow-hidden rounded-[12px] border border-line bg-line">
          <Numero valor={String(meses.length)} rotulo={meses.length === 1 ? "mês cobrado por época" : "meses cobrados por época"} />
          <Numero valor={`Dia ${academy.billingDueDay}`} rotulo="prazo de pagamento, todos os meses" />
        </div>

        <Meses ligados={meses} />

        {/*
          A mudança agendada só aparece quando existe. Dita por extenso e com a
          sua própria régua de meses: "a partir de Setembro muda" sem dizer para
          o quê obrigava a ir às Mensalidades confirmar.
        */}
        {proxima && (
          <div className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-3.5">
            <p className="text-body text-ink">
              <span className="font-medium">A partir de {mesDe(proxima.from)}</span>{" "}
              <span className="text-ink-3">
                passa a {proxima.months.length} {proxima.months.length === 1 ? "mês" : "meses"}, com prazo no dia{" "}
                {proxima.dueDay}.
              </span>
            </p>
            <Meses ligados={proxima.months} pequeno />
          </div>
        )}

        <div className="mt-4">
          <Link to="/mensalidades" className="ctl-outline">
            Alterar nas Mensalidades
          </Link>
        </div>
      </Bloco>

      <Bloco
        titulo="Métodos e comissões"
        descricao={
          <>
            <p>
              Pela app do clube, com a euPago. Quem escolhe o método é quem paga, e a comissão{" "}
              {taxaDoPagador ? "é somada ao valor e paga por quem paga." : "sai do valor que o clube recebe."}
            </p>
            <p>Um pagamento só fica pago quando a euPago o confirma ao servidor.</p>
          </>
        }
      >
        {oferecidos.length > 0 ? (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5">
              {oferecidos.map((m) => (
                <li key={m.method} className="rounded-[12px] border border-line bg-surface px-3.5 py-3">
                  <div className="text-body font-medium text-ink">{m.label}</div>
                  <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-4">comissão</div>
                  <div className="mt-0.5 text-body tabular text-ink-2">{taxaDe(m)}</div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Lista>
            <p className="px-4 py-4 text-meta text-ink-3">
              {loaded ? "Não foi possível ler os métodos de pagamento agora." : "a carregar…"}
            </p>
          </Lista>
        )}
      </Bloco>

      <Bloco
        titulo="Lembretes"
        descricao="Avisos às famílias com mensalidades vencidas, pela app do clube."
      >
        <p className="max-w-[56ch] text-body leading-relaxed text-ink-2">
          Enviam-se nas Mensalidades, no botão «Enviar lembretes», quando o clube decide. Cada mensalidade leva no máximo um lembrete por dia, mesmo
          que o botão seja carregado mais do que uma vez.
        </p>
      </Bloco>
    </>
  );
}

/**
 * Um dos dois sentidos da conta: escreve-se um valor, lê-se o resultado.
 *
 * O que está em vigor fica marcado. O campo é o mesmo nos dois cartões, e mexer
 * num mexe no outro: é o mesmo número a querer dizer duas coisas, que é
 * exactamente o que este interruptor muda.
 */
function Simulador({
  on,
  titulo,
  entrada,
  valor,
  onChange,
  saida,
  resultado,
}: {
  on: boolean;
  titulo: string;
  entrada: string;
  valor: string;
  onChange: (v: string) => void;
  saida: string;
  resultado: string;
}) {
  return (
    <div
      className={cx(
        "rounded-[12px] border px-3.5 py-3 transition-colors duration-[120ms]",
        on ? "border-ink-3 bg-surface" : "border-dashed border-line-strong",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cx("text-meta font-semibold", on ? "text-ink" : "text-ink-3")}>{titulo}</span>
        {on && <span className="text-[11px] font-medium text-signal-ink">em vigor</span>}
      </div>

      {/*
        As duas linhas de sempre, lado a lado: o nome e o valor. A de cima
        escreve-se — o valor é um campo, mas desenhado como o texto que lá
        estava, só com um traço por baixo a dizer que se pode mexer.
      */}
      <dl className="mt-2 space-y-1">
        <div className="flex items-baseline justify-between gap-3 text-meta">
          <dt className={on ? "text-ink-3" : "text-ink-4"}>{entrada}</dt>
          <dd className={cx("flex items-baseline gap-1 tabular", on ? "font-medium text-ink" : "text-ink-3")}>
            <input
              value={valor}
              onChange={(e) => onChange(e.target.value)}
              inputMode="decimal"
              size={Math.max(4, valor.length)}
              aria-label={`${titulo}: ${entrada.toLowerCase()}, em euros`}
              className="w-auto border-b border-dashed border-line-strong bg-transparent p-0 text-right text-meta tabular text-inherit outline-none transition-colors duration-[120ms] hover:border-ink-3 focus:border-solid focus:border-ink-3"
            />
            <span aria-hidden>€</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-meta">
          <dt className={on ? "text-ink-3" : "text-ink-4"}>{saida}</dt>
          <dd className={cx("tabular", on ? "font-medium text-ink" : "text-ink-3")}>{resultado}</dd>
        </div>
      </dl>
    </div>
  );
}

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <div className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-ink tabular">{valor}</div>
      <div className="mt-1.5 text-meta text-ink-3">{rotulo}</div>
    </div>
  );
}

/**
 * A régua dos doze meses.
 *
 * Aceso = cobra-se. A cor é `signal-soft` com letra `signal-ink`, que se lê com
 * qualquer cor de clube; um mês desligado fica tracejado e apagado, e leva o
 * nome riscado para quem não distingue as duas cores.
 */
function Meses({ ligados, pequeno }: { ligados: number[]; pequeno?: boolean }) {
  return (
    <ol className={cx("grid grid-cols-6 gap-1.5 sm:grid-cols-12", pequeno ? "mt-3" : "mt-4")}>
      {ORDEM.map((m) => {
        const on = ligados.includes(m);
        return (
          <li
            key={m}
            title={`${EXTENSO[m - 1]}: ${on ? "cobra-se" : "não se cobra"}`}
            className={cx(
              "flex items-center justify-center rounded-[8px] text-meta",
              pequeno ? "h-7" : "h-10",
              on
                ? "bg-signal-soft font-semibold text-signal-ink"
                : "border border-dashed border-line-strong text-ink-4 line-through",
            )}
          >
            {CURTO[m - 1]}
          </li>
        );
      })}
    </ol>
  );
}
