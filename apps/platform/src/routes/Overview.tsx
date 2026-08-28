import { useEffect } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { Empty, Metric, MetricRow, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ChurnChart, GrowthChart } from "@/components/Charts";
import { euros } from "@/lib/format";
import { useApi } from "@/lib/query";
import type { Alert, Overview as OverviewData, SeriesPoint } from "@/lib/types";
import { useBusy } from "@/components/Busy";

/**
 * A página de entrada.
 *
 * **Primeiro o que exige acção, depois o que descreve o estado.** É a decisão que
 * define esta página, e é o oposto do que uma dashboard costuma fazer: uma grelha
 * de cartões obriga quem entra a procurar o problema no meio dos números; uma lista
 * de alertas entrega-o.
 *
 * Se não houver nada a fazer, a lista diz isso em duas linhas e sai da frente — o
 * espaço passa a ser dos números. Um painel que grita todos os dias deixa de ser
 * lido ao fim de uma semana.
 */
export default function Overview() {
  const overview = useApi<OverviewData>("/overview");
  const series = useApi<SeriesPoint[]>("/series?months=12");

  /*
   * A página respira por causa do "Agora".
   *
   * Todo o resto daqui muda em dias, e uma leitura à entrada chegava. A presença
   * muda em segundos — um número congelado no instante em que a página abriu é
   * pior do que não o mostrar, porque parece vivo e não é. Trinta segundos é mais
   * lento do que a janela de presença do servidor (dois minutos), por isso
   * ninguém aparece e desaparece entre leituras.
   *
   * Só com o separador à vista: um painel esquecido numa segunda janela não
   * precisa de puxar a API de meio em meio minuto durante a tarde toda. As
   * séries não recarregam — são doze meses de história e não mudam hoje.
   */
  const { reload } = overview;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  /*
   * O esqueleto é da **primeira** leitura, não das seguintes: `useApi` acende
   * `loading` a cada corrida, e sem esta condição a página inteira piscava para
   * esqueleto de meio em meio minuto.
   */
  if (overview.loading && !overview.data) return <Skeleton />;
  if (overview.error && !overview.data) return <Failed message={overview.error} onRetry={overview.reload} />;

  const d = overview.data!;
  const { academies: a, people, revenue } = d;

  return (
    <>
      <PageHeader title="Visão geral" subtitle="Como vai o negócio, e o que precisa de ti hoje." />

      <div className="space-y-3">
        <Attention alerts={d.alerts} />

        {/* Guardado como o painel do email: durante um deploy a API pode ainda
            ser a antiga, e um painel que rebenta na página de entrada é pior do
            que um painel a menos. */}
        {d.online && <AgoraOnline online={d.online} />}

        <MetricRow>
          <Metric
            label="MRR"
            value={euros(revenue.mrrCents)}
            note={`${euros(revenue.arrCents)} por ano`}
          />
          <Metric
            label="Academias a pagar"
            value={String(a.active)}
            note={`${a.trial} em avaliação · ${a.setup} a montar`}
            trend={{ value: a.newThisMonth }}
          />
          <Metric
            label="Cancelaram este mês"
            value={String(a.churnThisMonth)}
            note={a.churnThisMonth === 0 ? "nenhuma — bom mês" : "vale um telefonema"}
            trend={{ value: a.churnThisMonth, good: "down" }}
          />
          <Metric
            label="Utilização"
            value={d.usage === null ? "—" : `${d.usage}%`}
            note="registaram presenças esta semana"
          />
        </MetricRow>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel>
            <PanelHead title="Crescimento" hint="academias activas, 12 meses" />
            <GrowthChart data={series.data ?? []} />
          </Panel>

          <Panel>
            <PanelHead title="Entradas e saídas" hint="por mês" />
            <ChurnChart data={series.data ?? []} />
          </Panel>
        </div>

        <MetricRow>
          <Metric label="Atletas" value={String(people.athletes)} note="em todas as academias" />
          <Metric label="Famílias" value={String(people.guardians)} note="encarregados com conta" />
          <Metric label="Staff" value={String(people.staff)} note="treinadores, direção, clínico" />
          <Metric label="Academias" value={String(a.total)} note={`${a.cancelled} canceladas`} />
        </MetricRow>

        {/* Guardado: durante um deploy a API pode ainda ser a antiga, e um painel
            que rebenta na página de entrada é pior do que um painel a menos. */}
        {d.email && <Email data={d.email} />}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/** Os tipos de email, ditos como quem os manda. */
const KIND_LABEL: Record<string, string> = {
  "staff-invite": "convites a staff",
  "family-invite": "convites a famílias",
  "platform-invite": "convites à plataforma",
  outro: "outros",
};

/**
 * Quem está a usar o produto neste momento.
 *
 * ## Porque é que está no topo e não numa métrica qualquer
 *
 * Porque é o único número desta página que se mede em segundos. Tudo o resto —
 * MRR, academias, atletas, utilização — muda em dias ou em meses, e é por isso
 * que vive todo na mesma fila de métricas cinzentas. Pôr este lá dentro fazia-o
 * parecer da mesma natureza, e a graça dele é exactamente a contrária: é a única
 * coisa aqui que responde "está alguém lá agora?".
 *
 * ## Staff e famílias separados
 *
 * São leituras diferentes e não se somam bem numa cabeça só. Trinta pais na app
 * ao domingo de manhã é adopção — a metade deste produto que costuma falhar.
 * Trinta dirigentes na consola à terça à tarde é uso. Um número só juntava as
 * duas e não respondia a nenhuma.
 *
 * ## Em quantos clubes
 *
 * Sem isso, doze pessoas espalhadas por seis academias e doze na mesma sala
 * leem-se igual — e são coisas opostas: uma é um sábado de jogos, a outra é uma
 * reunião de direcção.
 *
 * ## Zero é uma resposta, não uma avaria
 *
 * Às três da manhã não está ninguém, e isso está certo. Por isso o vazio é dito
 * com calma e sem cor de alerta: o ponto apaga-se e a frase explica-se.
 */
function AgoraOnline({ online }: { online: NonNullable<OverviewData["online"]> }) {
  const ninguem = online.total === 0;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-10 gap-y-5 px-5 py-4">
        <div className="flex items-center gap-3.5">
          <span className="relative flex size-2.5 shrink-0" aria-hidden>
            {!ninguem && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#1f7a45] opacity-60" />
            )}
            <span
              className={cx(
                "relative inline-flex size-2.5 rounded-full",
                ninguem ? "bg-ink-4/40" : "bg-[#1f7a45]",
              )}
            />
          </span>

          <div>
            <div className="text-meta font-medium tracking-wide text-ink-3 uppercase">Agora</div>
            {ninguem ? (
              <div className="mt-0.5 text-body text-ink-3">Ninguém a usar o produto neste momento.</div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-[28px] leading-none font-semibold text-ink tabular">{online.total}</span>
                <span className="text-body text-ink-2">
                  {online.total === 1 ? "pessoa" : "pessoas"} em {online.academies}{" "}
                  {online.academies === 1 ? "academia" : "academias"}
                </span>
              </div>
            )}
          </div>
        </div>

        {!ninguem && (
          <div className="flex items-center gap-8">
            <Lado n={online.staff} label="Staff" nota="na consola" />
            <Lado n={online.family} label="Famílias" nota="na app" />
          </div>
        )}
      </div>
    </Panel>
  );
}

function Lado({ n, label, nota }: { n: number; label: string; nota: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className={cx("text-[20px] leading-none font-semibold tabular", n === 0 ? "text-ink-4" : "text-ink")}>
          {n}
        </span>
        <span className="text-body text-ink-2">{label}</span>
      </div>
      <div className="mt-1 text-meta text-ink-4">{nota}</div>
    </div>
  );
}

/**
 * O correio que saiu hoje.
 *
 * ## Porque é que isto está aqui e não escondido nas definições
 *
 * É a única peça do produto com um **tecto diário**: o plano de envio é gratuito
 * e acaba a meio do dia sem avisar ninguém. Um convite que não sai não dá erro a
 * quem o mandou — a academia fica à espera, e a primeira notícia costuma ser um
 * telefonema a dizer que o treinador nunca recebeu nada.
 *
 * Três números e uma frase. **Hoje** é o que se veio ver; **falhados** é o único
 * que exige uma acção, e por isso é o único que ganha cor; **ontem** existe só
 * para dar escala — "31" pode ser um dia normal ou o triplo do costume, e sem o
 * lado a lado não há como saber.
 */
function Email({ data }: { data: OverviewData["email"] }) {
  const nada = data.today === 0 && data.yesterday === 0;

  return (
    <Panel>
      <PanelHead title="Email" hint="convites e avisos enviados pelo servidor" />
      <div className="flex flex-wrap">
        <Metric
          label="Enviados hoje"
          value={String(data.today)}
          note={
            nada
              ? "ainda nenhum — e nenhum ontem"
              : data.byKind.length > 0
                ? data.byKind.map((k) => `${k.count} ${KIND_LABEL[k.kind] ?? k.kind}`).join(" · ")
                : "nenhum hoje"
          }
        />
        <Metric
          label="Falharam hoje"
          value={String(data.failedToday)}
          note={data.failedToday === 0 ? "todos entregues ao serviço" : "o motivo fica no registo do servidor"}
        />
        <Metric label="Ontem" value={String(data.yesterday)} note="para dar escala" />
      </div>
      {data.failedToday > 0 && (
        /*
          A cor só aparece quando há mesmo alguma coisa. Um painel que está sempre
          vermelho deixa de ser lido — a mesma regra dos alertas aqui em cima.
        */
        <p className="border-t border-line px-5 py-2.5 text-meta text-[#a82a20]">
          {data.failedToday === 1 ? "Um email não saiu" : `${data.failedToday} emails não saíram`} — quase sempre é
          o domínio por verificar ou o tecto diário do plano.
        </p>
      )}
    </Panel>
  );
}

/**
 * O que precisa de atenção.
 *
 * Cada linha é clicável e leva à academia em causa. Um alerta que obriga a
 * procurar de quem se trata é meio alerta.
 */
function Attention({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <Panel className="flex items-center gap-3 px-5 py-3.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#e6f2e9] text-[#1f7a45]">✓</span>
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">Nada a precisar de atenção</div>
          <div className="text-meta text-ink-3">Sem trials a acabar, pagamentos falhados ou clientes parados.</div>
        </div>
      </Panel>
    );
  }

  const risk = alerts.filter((x) => x.severity === "risk").length;

  return (
    <Panel>
      <PanelHead title="Precisa de atenção" hint={`${alerts.length} ${alerts.length === 1 ? "item" : "itens"}`}>
        {risk > 0 && <Pill tone="risk">{risk} urgente{risk === 1 ? "" : "s"}</Pill>}
      </PanelHead>

      <ul>
        {alerts.map((x) => (
          <li key={x.id}>
            <Link
              to={`/academias?destaque=${x.academyId}`}
              className="group flex items-start gap-3 border-b border-line px-5 py-3 transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken/60"
            >
              <AlertTriangle
                className={cx("mt-0.5 size-4 shrink-0", x.severity === "risk" ? "text-[#a82a20]" : "text-[#b8860b]")}
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-body font-medium text-ink">{x.title}</span>
                  <span className="text-meta text-ink-3">{x.academyName}</span>
                </div>
                <div className="mt-0.5 text-meta leading-relaxed text-ink-3">{x.detail}</div>
              </div>
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform duration-[120ms] group-hover:translate-x-0.5" strokeWidth={1.75} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A espera, em todas as páginas do painel.
 *
 * Eram três rectângulos a pulsar — um esqueleto. Prometiam uma forma que a
 * página nem sempre tinha, e cada ecrã prometia a mesma: a Visão geral, as
 * Academias e os Contactos desenhavam todos "64, 92, 220" enquanto carregavam,
 * fosse qual fosse o conteúdo a caminho.
 *
 * Agora declaram-se à casca, que desfoca o que já está e põe um disco no meio do
 * ecrã. O menu não desfoca — é o que continua a servir para alguma coisa enquanto
 * se espera. Ver `components/Busy.tsx`.
 */
export function Skeleton() {
  useBusy(true);
  // Espaço reservado: sem ele a página colapsava a zero e voltava a crescer com
  // os dados, que é o salto de layout que se quer evitar.
  return <div className="w-full py-20" aria-hidden />;
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel>
      <Empty title="Não foi possível carregar" detail={message} />
      <div className="flex justify-center pb-8">
        <button type="button" onClick={onRetry} className="ctl-outline">
          Tentar outra vez
        </button>
      </div>
    </Panel>
  );
}
