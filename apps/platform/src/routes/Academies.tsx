import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/Shell";
import { ClubMark, Empty, Panel, Pill, Progress, cx } from "@/components/primitives";
import { NewAcademyDialog } from "@/components/NewAcademyDialog";
import { AcademyActions } from "@/components/AcademyActions";
import { Failed, Skeleton } from "./Overview";
import { euros, shortDate, since } from "@/lib/format";
import { useApi } from "@/lib/query";
import { STATUS_LABEL, type Academy, type AcademyStatus, type Me } from "@/lib/types";

const TONE: Record<AcademyStatus, "neutral" | "ok" | "warn" | "risk" | "signal"> = {
  SETUP: "signal",
  TRIAL: "warn",
  ACTIVE: "ok",
  PAST_DUE: "risk",
  CANCELLED: "neutral",
};

type Filter = "todas" | AcademyStatus;

/**
 * A lista de clientes.
 *
 * Uma tabela densa e não uma grelha de cartões. É a diferença entre comparar e
 * folhear: com trinta academias, a pergunta é sempre "qual delas está pior", e
 * isso lê-se numa coluna alinhada — nunca em cartões espalhados.
 *
 * A ordem por omissão é a mais recente primeiro, porque o cliente que entrou esta
 * semana é o que corre mais risco de nunca chegar a arrancar.
 */
export default function Academies({ me }: { me: Me }) {
  const { data, loading, error, reload } = useApi<Academy[]>("/academies");
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("todas");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [gerir, setGerir] = useState<Academy | null>(null);

  /*
   * A coluna "Online" obriga a página a respirar.
   *
   * Tudo o resto aqui muda em dias — atletas, plano, onboarding — e uma leitura
   * à entrada chegava. A presença muda em segundos, e um número congelado no
   * momento em que a página abriu é pior do que não o mostrar: parece vivo e não
   * é. Trinta segundos é mais lento do que a janela de presença do servidor (dois
   * minutos), por isso ninguém aparece e desaparece entre leituras.
   *
   * Não recarrega com o separador escondido nem com um diálogo aberto: puxar a
   * lista por baixo de quem está a gerir uma academia troca-lhe o objecto nas
   * mãos a meio do gesto.
   */
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !gerir && !creating) reload();
    }, 30_000);
    return () => clearInterval(t);
  }, [reload, gerir, creating]);

  // Vem do alerta clicado na Visão geral — a linha fica destacada.
  const highlight = params.get("destaque");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((a) => (filter === "todas" ? true : a.status === filter))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) || a.slug.includes(q) : true));
  }, [data, filter, query]);

  /*
   * O esqueleto é para a **primeira** leitura, não para as seguintes.
   *
   * `useApi` acende `loading` a cada corrida, e a lista passou a recarregar
   * sozinha de trinta em trinta segundos por causa da coluna "Online". Sem esta
   * condição, a página inteira piscava para esqueleto a cada meio minuto — e o
   * mesmo acontecia a quem carregava em "Tentar outra vez".
   */
  if (loading && !data) return <Skeleton />;
  if (error && !data) return <Failed message={error} onRetry={reload} />;

  const counts = (s: AcademyStatus) => (data ?? []).filter((a) => a.status === s).length;
  // `SUPPORT` acompanha clientes; não os cria. A diferença entre ajudar e decidir.
  const mayCreate = me.role === "OWNER" || me.role === "ADMIN";

  return (
    <>
      <PageHeader title="Academias" subtitle={`${data?.length ?? 0} clientes`}>
        {mayCreate && (
          <button type="button" onClick={() => setCreating(true)} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Nova academia
          </button>
        )}
      </PageHeader>

      {creating && (
        <NewAcademyDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {gerir && (
        <AcademyActions
          academy={gerir}
          me={me}
          onClose={() => setGerir(null)}
          onDone={() => {
            setGerir(null);
            reload();
          }}
        />
      )}

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="flex rounded-[var(--radius-control)] border border-line p-0.5">
            {([["todas", "Todas"], ["ACTIVE", "Ativas"], ["TRIAL", "Avaliação"], ["SETUP", "A montar"], ["PAST_DUE", "Em falta"], ["CANCELLED", "Canceladas"]] as const).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value as Filter)}
                  aria-pressed={filter === value}
                  className={cx(
                    "rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                    filter === value ? "bg-ink text-surface" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {label}
                  {value !== "todas" && counts(value as AcademyStatus) > 0 && (
                    <span className="ml-1.5 tabular opacity-60">{counts(value as AcademyStatus)}</span>
                  )}
                </button>
              ),
            )}
          </div>

          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Procurar academia…"
              className="h-8 w-[200px] rounded-[var(--radius-control)] bg-sunken pl-8 text-meta text-ink placeholder:text-ink-4 focus:bg-surface focus:ring-1 focus:ring-line-strong focus:outline-none"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty title="Nenhuma academia neste filtro" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line bg-sunken/60 text-meta font-medium text-ink-3">
                  <th className="px-5 py-2 text-left">Academia</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Estado</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Plano</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">MRR / avaliação</th>
                  {/*
                    A coluna de atletas saiu daqui.

                    Numa lista para comparar clientes, o número de atletas não
                    decide nada: um clube de 40 e outro de 400 pagam pelo mesmo
                    plano e renovam pelas mesmas razões. Quem quer o plantel abre
                    a ficha do clube, onde ele vem repartido por equipa e com
                    contexto. Menos uma coluna é mais espaço para as que mudam
                    uma decisão.
                  */}
                  <th className="px-3 py-2 text-right whitespace-nowrap">Staff</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Online</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Onboarding</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Atividade</th>
                  <th className="px-5 py-2 text-right whitespace-nowrap">Entrou</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    className={cx(
                      "border-b border-line last:border-b-0",
                      highlight === a.id ? "bg-signal-soft/50" : "hover:bg-sunken/40",
                    )}
                    onClick={() => highlight && setParams({})}
                  >
                    {/* O emblema à esquerda do nome. Numa lista de trinta
                        clubes, é por ele que se reconhece um — o nome
                        lê-se, o símbolo vê-se. */}
                    {/*
                      O nome é a porta para a ficha do clube.

                      Um link e não a linha inteira clicável: a linha tem dentro
                      dela um "Gerir" e um endereço, e uma linha que navega ao
                      primeiro clique tira-lhes o sítio. Quem quer o clube carrega
                      no nome, que é o que se lê primeiro.
                    */}
                    <td className="px-5 py-2.5">
                      <Link to={`/academias/${a.id}`} className="group flex items-center gap-2.5">
                        <ClubMark name={a.name} logoUrl={a.logoUrl} color={a.signalColor} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink group-hover:underline">{a.name}</div>
                          <div className="truncate font-mono text-[11px] text-ink-4">{a.slug}.academias.pt</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{a.plan ?? "—"}</td>
                    {/*
                      Uma academia em avaliação **não gera receita**, e mostrar
                      o valor do plano na coluna do MRR fazia-a parecer que sim.
                      O número continua a existir — é o que ela vai pagar — mas
                      até a subscrição ficar activa o que interessa saber é
                      quando é que o período experimental acaba.
                    */}
                    <td className="px-3 py-2.5 text-right font-medium text-ink tabular">
                      {a.status === "TRIAL" || a.status === "SETUP" ? (
                        <span className="text-meta font-normal text-[#8a5a12]">
                          {a.trialEndsAt ? `até ${shortDate(a.trialEndsAt)}` : "experimental"}
                        </span>
                      ) : a.mrrCents > 0 ? (
                        euros(a.mrrCents)
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-2 tabular">{a.staff}</td>
                    {/*
                      Quem lá está agora.

                      Um ponto verde a pulsar e o número, e mais nada quando é
                      zero — um "0" repetido por vinte linhas é ruído que faz o
                      olho parar de ler a coluna. A separação staff/famílias fica
                      no `title` em vez de ocupar largura: a pergunta de relance é
                      "há alguém?", e o detalhe só interessa a quem para naquela
                      linha.
                    */}
                    <td className="px-3 py-2.5">
                      {a.online.total === 0 ? (
                        <span className="text-meta text-ink-4">—</span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          title={`${a.online.staff} na consola · ${a.online.family} na app das famílias`}
                        >
                          <span className="relative flex size-2">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#1f7a45] opacity-60" />
                            <span className="relative inline-flex size-2 rounded-full bg-[#1f7a45]" />
                          </span>
                          <span className="font-medium text-ink tabular">{a.online.total}</span>
                          <span className="text-[11px] text-ink-4 tabular">
                            {a.online.staff}/{a.online.family}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="w-[110px]">
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                          <span className={cx("tabular", a.onboarding.percent === 100 ? "text-[#1f7a45]" : "text-ink-2")}>
                            {a.onboarding.percent}%
                          </span>
                          <span className="text-ink-4 tabular">
                            {a.onboarding.done}/{a.onboarding.total}
                          </span>
                        </div>
                        <Progress percent={a.onboarding.percent} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {/*
                        A última vez que fecharam presenças. É o sinal de vida do
                        cliente — quem deixa de registar deixa de usar, e quem
                        deixa de usar não renova, muito antes de o dizer.
                      */}
                      <span className={cx("text-meta", staleness(a.lastActivity))}>{since(a.lastActivity)}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-meta text-ink-3 whitespace-nowrap">{shortDate(a.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {mayCreate && (
                        <button type="button" onClick={() => setGerir(a)} className="ctl-ghost">
                          Gerir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function staleness(iso: string | null): string {
  if (!iso) return "text-ink-4";
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days > 14) return "text-[#a82a20] font-medium";
  if (days > 7) return "text-[#8a5a12]";
  return "text-ink-3";
}

