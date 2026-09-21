import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, ApiError } from "@/lib/http";
import { cx } from "./primitives";
import { euros } from "@/lib/format";
import type { Academy, Me, Plan } from "@/lib/types";

/** Os estados de uma subscrição, ditos como quem os lê. */
const ESTADOS: { value: SubStatus; label: string; nota: string }[] = [
  { value: "TRIALING", label: "Em avaliação", nota: "não conta para o MRR" },
  { value: "ACTIVE", label: "A pagar", nota: "entra no MRR" },
  { value: "PAST_DUE", label: "Em atraso", nota: "aparece nos alertas" },
  { value: "CANCELLED", label: "Cancelada", nota: "conta como churn deste mês" },
];

type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

/**
 * Mudar o plano de um clube, fechá-lo ou apagá-lo.
 *
 * ## O plano vem primeiro
 *
 * É a única das três que se faz mais do que uma vez por clube — quando a
 * avaliação acaba e o clube começa a pagar, quando sobe de escalão a meio do
 * ano, quando falha um pagamento. As outras duas são de fim de vida.
 *
 * Escolher o plano **não** era possível depois de criar a academia: decidia-se
 * no formulário de criação e ficava assim para sempre. Um clube criado sem plano
 * nem sequer tinha linha de subscrição para actualizar.
 *
 * ## Duas acções, e uma delas quase nunca se usa
 *
 * **Desactivar** é a normal: põe o clube em `CANCELLED`, e a partir daí nenhum
 * endereço dele responde — nem a consola, nem a página do clube, nem a de
 * sócios. Os dados ficam todos, e reactivar devolve-o onde estava.
 *
 * **Apagar** leva tudo: atletas, presenças, boletins clínicos, mensalidades,
 * famílias. É a operação mais destrutiva do produto, e por isso pede o endereço
 * do clube escrito à mão. Um "tens a certeza?" não é proporcional — quem está a
 * apagar o clube errado responde "sim" com a mesma facilidade. Escrever o
 * endereço obriga a olhar para qual.
 */
export function AcademyActions({
  academy,
  me,
  onDone,
  onClose,
}: {
  academy: Academy;
  me: Me;
  onDone: () => void;
  onClose: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apagar, setApagar] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState(academy.planId ?? "");
  const [subStatus, setSubStatus] = useState<SubStatus>((academy.subscriptionStatus as SubStatus) ?? "TRIALING");
  const [planoGravado, setPlanoGravado] = useState(false);

  /*
   * As condições comerciais — o que o clube vai assinar.
   *
   * Mudar o plano passou a ser contratar: o responsável do clube recebe as
   * condições por email e assina-as na consola. Por isso estão aqui, ao lado da
   * escolha do plano, e não num ecrã à parte — são a mesma decisão.
   */
  const [anual, setAnual] = useState(false);
  /*
   * A mensalidade que vai no contrato.
   *
   * Texto e em euros, porque é um campo que se escreve: guardar cêntimos
   * obrigava a converter a cada tecla e a inventar um número para estados
   * intermédios ("29," não é nada). Segue o plano enquanto ninguém lhe tocar —
   * a partir daí manda quem escreveu, e o preço de tabela fica ao lado para se
   * ver a diferença.
   */
  const [preco, setPreco] = useState("");
  const [precoMexido, setPrecoMexido] = useState(false);
  const [inicio, setInicio] = useState(() => new Date().toISOString().slice(0, 10));
  /*
   * A fidelização, em anos, e só no anual.
   *
   * Era um campo de meses, com 12 escrito por omissão em qualquer
   * periodicidade: um contrato mensal saía com um ano de fidelização por
   * distracção, o que é o contrário do que se vende ("mensal, cancela quando
   * quiser"). Agora a periodicidade decide: mensal não tem, anual tem os anos
   * que aqui se escolherem. O servidor aplica a mesma regra
   * (`minimoDaPeriodicidade`).
   */
  const [anos, setAnos] = useState(1);
  const [renovacao, setRenovacao] = useState("");
  const [notas, setNotas] = useState("");
  const [emitir, setEmitir] = useState(true);
  const [ordem, setOrdem] = useState<{ enviado: boolean; motivo: string | null } | null>(null);

  useEffect(() => {
    apiGet<Plan[]>("/plans")
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const planoEscolhido = plans.find((p) => p.id === planId) ?? null;

  /*
   * O valor de partida.
   *
   * O acordado deste clube quando o plano é o que ele já tem — reabrir a janela
   * tem de propor o que está em vigor, senão a gravação seguinte desfazia o
   * acordo sem ninguém pedir. Se se escolher **outro** plano, a partida é o
   * preço de tabela desse: mudar de plano é começar conversa nova.
   */
  const partida =
    planId === academy.planId && academy.priceCents != null ? academy.priceCents : planoEscolhido?.amountCents;

  useEffect(() => {
    if (precoMexido) return;
    setPreco(partida === undefined ? "" : (partida / 100).toFixed(2).replace(".", ","));
  }, [partida, precoMexido]);

  /** O que está escrito, em cêntimos. `null` enquanto não for um valor válido. */
  const precoCents = (() => {
    const n = Number(preco.replace(/[€\s]/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  })();
  const tabela = planoEscolhido?.amountCents ?? null;
  const negociado = precoCents !== null && tabela !== null && precoCents !== tabela;

  const cancelada = academy.status === "CANCELLED";
  const mayDelete = me.role === "OWNER";

  /*
   * O plano e o estado gravam juntos — é uma decisão só.
   *
   * O MRR conta subscrições `ACTIVE` e mais nada: escolher o plano e deixar a
   * subscrição em avaliação era mexer num número que não aparece em lado nenhum.
   */
  async function gravarPlano() {
    if (!planId) return;
    setBusy(true);
    setError(null);
    setPlanoGravado(false);
    try {
      /*
       * As condições só vão quando se quer emitir contrato.
       *
       * Corrigir um estado — pôr em atraso, cancelar — não é uma renegociação, e
       * não devia pôr um email de assinatura no telemóvel do presidente. Sem
       * `billingPeriod`, o servidor grava o plano e não emite nada.
       */
      const r = await apiPatch<{ ordem: { enviado: boolean; motivo: string | null } | null }>(
        `/academies/${academy.id}/plano`,
        {
          planId,
          status: subStatus,
          ...(emitir
            ? {
                billingPeriod: anual ? "ANNUAL" : "MONTHLY",
                startsOn: inicio,
                minimumMonths: anual ? anos * 12 : 1,
                /*
                 * O valor vai sempre, igual à tabela ou não. É o servidor que
                 * decide se isto é um acordo (e o guarda) ou a confirmação do
                 * preço do plano (e não guarda nada) — ver `setAcademyPlan`.
                 */
                ...(precoCents !== null ? { monthlyCents: precoCents } : {}),
                ...(renovacao.trim() ? { renewalNote: renovacao.trim() } : {}),
                ...(notas.trim() ? { notes: notas.trim() } : {}),
              }
            : {}),
        },
      );
      setOrdem(r?.ordem ?? null);
      setPlanoGravado(true);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível gravar o plano.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/academies/${academy.id}/estado`, { active: cancelada });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível mudar o estado.");
      setBusy(false);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/academies/${academy.id}`, { slug: slug.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        /*
          Tecto e coluna.

          Sem altura máxima, um diálogo mais alto do que o ecrã cresce para fora
          dele nos dois sentidos — e o fundo é `fixed`, por isso não há nada que
          role. Foi o que aconteceu quando as condições comerciais se juntaram ao
          plano. Agora o cabeçalho fica, e o corpo rola por dentro.

          `dvh` e não `vh`: no telemóvel a barra do browser entra e sai, e `vh`
          conta com ela sempre escondida — o rodapé ficava por baixo dela.
        */
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[440px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)] max-md:max-h-[90dvh]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-panel text-ink">{academy.name}</h2>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* --- Plano e subscrição --------------------------------------- */}
          <div className="rounded-[var(--radius-control)] border border-line p-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-body font-medium text-ink">Plano</p>
              <p className="text-meta text-ink-3">
                {academy.plan ? `Actual: ${academy.plan}` : "Sem plano atribuído"}
              </p>
            </div>

            {plans.length === 0 ? (
              <p className="mt-2 text-meta text-ink-3">A carregar os planos…</p>
            ) : (
              <>
                <div className="mt-2.5 space-y-1.5">
                  {plans.map((p) => (
                    <label
                      key={p.id}
                      className={cx(
                        "flex cursor-pointer items-baseline gap-2.5 rounded-[var(--radius-control)] border px-2.5 py-2 transition-colors duration-[120ms]",
                        planId === p.id ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                      )}
                    >
                      <input
                        type="radio"
                        name="plano-academia"
                        checked={planId === p.id}
                        onChange={() => setPlanId(p.id)}
                        className="size-3.5 shrink-0 accent-[var(--color-signal)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-body text-ink">{p.name}</span>
                      <span className="shrink-0 text-meta font-medium text-ink tabular">{euros(p.amountCents)}</span>
                      <span className="shrink-0 text-[11px] text-ink-4">/mês</span>
                    </label>
                  ))}
                </div>

                {/*
                  O plano deste clube já não está à venda.

                  `GET /plans` só devolve os activos — é o que se quer no
                  formulário de criação. Aqui, um clube que ficou num preço antigo
                  não aparecia em lado nenhum e o ecrã parecia dizer que não tinha
                  plano. Diz-se o que se passa: continua no que tem, e só sai de
                  lá se alguém escolher outro de propósito.
                */}
                {academy.planId && !plans.some((p) => p.id === academy.planId) && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                    Este clube está num plano que já não se vende
                    {academy.plan ? ` (${academy.plan})` : ""} — mantém-no enquanto não escolheres outro acima.
                  </p>
                )}

                {/* --- As condições comerciais ---------------------------- */}
                <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-sunken/40 p-3">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={emitir}
                      onChange={(e) => setEmitir(e.target.checked)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-signal)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-ink">Emitir condições e pedir assinatura</span>
                      <span className="block text-[11px] leading-relaxed text-ink-3">
                        O responsável do clube recebe as condições por email e assina-as na consola. Desliga para
                        corrigir só o estado da subscrição.
                      </span>
                    </span>
                  </label>

                  {emitir && (
                    <>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {[
                          { v: false, label: "Mensal", hint: "preço de tabela" },
                          { v: true, label: "Anual", hint: "menos 10%" },
                        ].map((o) => (
                          <button
                            key={o.label}
                            type="button"
                            onClick={() => setAnual(o.v)}
                            className={cx(
                              "rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left transition-colors duration-[120ms]",
                              anual === o.v ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                            )}
                          >
                            <span className="block text-body text-ink">{o.label}</span>
                            <span className="block text-[11px] text-ink-3">{o.hint}</span>
                          </button>
                        ))}
                      </div>

                      {/*
                        O preço que vai no contrato, à vista antes de gravar.

                        O desconto anual é uma regra do servidor; isto é a mesma
                        conta feita aqui para se ver o número — e é por isso que
                        o rótulo diz de onde vem.
                      */}
                      {/*
                        A mensalidade, escrita e não herdada.

                        Abre com o preço do plano, que é o caso normal e não
                        devia dar trabalho nenhum. Mas há clubes que negoceiam,
                        e até aqui a única saída era criar um plano só para
                        aquele cliente — um catálogo com planos de um clube cada,
                        que ninguém consegue ler um ano depois.
                      */}
                      <label className="mt-3 block">
                        <span className="mb-1 block text-meta font-medium text-ink">Mensalidade</span>
                        <div className="relative">
                          <input
                            value={preco}
                            onChange={(e) => {
                              setPreco(e.target.value);
                              setPrecoMexido(true);
                            }}
                            inputMode="decimal"
                            placeholder="0,00"
                            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-7 pl-2 text-body text-ink tabular outline-none focus:border-line-strong"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-ink-3">
                            €
                          </span>
                        </div>
                      </label>

                      {precoCents === null ? (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-[#a82a20]">
                          Escreve a mensalidade para poder emitir as condições.
                        </p>
                      ) : (
                        <p className="mt-2 text-meta text-ink-2">
                          O clube paga{" "}
                          <strong className="font-semibold text-ink tabular">
                            {euros(anual ? Math.round(precoCents * 12 * 0.9) : precoCents)}
                          </strong>{" "}
                          {anual ? "por ano" : "por mês"}
                          {anual && <span className="text-ink-3"> ({euros(precoCents)}/mês)</span>}
                        </p>
                      )}

                      {/* O preço de tabela fica à vista quando o acordo se afasta dele. */}
                      {negociado && tabela !== null && (
                        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                          Preço à medida. O plano {planoEscolhido?.name} está a {euros(tabela)}/mês.{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setPreco((tabela / 100).toFixed(2).replace(".", ","));
                              setPrecoMexido(true);
                            }}
                            className="font-medium text-ink underline underline-offset-2"
                          >
                            Usar o de tabela
                          </button>
                        </p>
                      )}

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-meta font-medium text-ink">Data de início</span>
                          <input
                            type="date"
                            value={inicio}
                            onChange={(e) => setInicio(e.target.value)}
                            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none focus:border-line-strong"
                          />
                        </label>
                        {anual ? (
                          <label className="block">
                            <span className="mb-1 block text-meta font-medium text-ink">Fidelização</span>
                            <select
                              value={anos}
                              onChange={(e) => setAnos(Number(e.target.value))}
                              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none focus:border-line-strong"
                            >
                              {[1, 2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  {n} {n === 1 ? "ano" : "anos"}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div className="block">
                            <span className="mb-1 block text-meta font-medium text-ink">Fidelização</span>
                            <p className="flex h-9 items-center text-meta text-ink-3">
                              Sem período mínimo
                            </p>
                          </div>
                        )}
                      </div>

                      {/*
                        O que a fidelização implica, dito antes de emitir.

                        É o que os Termos de Serviço passaram a dizer (v1.2,
                        secções 8 e 11): com fidelização o clube só sobe de
                        plano, e cancelar não o desobriga do que falta pagar.
                      */}
                      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                        {anual
                          ? `Com fidelização de ${anos} ${anos === 1 ? "ano" : "anos"}, o clube só pode subir de plano e, se cancelar, paga as mensalidades que faltam até ao fim.`
                          : "Sem fidelização: o clube pode descer de plano ou cancelar, com efeito no fim do período pago."}
                      </p>

                      <label className="mt-2 block">
                        <span className="mb-1 block text-meta font-medium text-ink">
                          Renovação <span className="font-normal text-ink-4">— vazio escreve a frase por omissão</span>
                        </span>
                        <input
                          value={renovacao}
                          onChange={(e) => setRenovacao(e.target.value)}
                          placeholder={`Renova ${anual ? "anualmente" : "mensalmente"} após o período mínimo.`}
                          className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none placeholder:text-ink-4 focus:border-line-strong"
                        />
                      </label>

                      <label className="mt-2 block">
                        <span className="mb-1 block text-meta font-medium text-ink">
                          Observações <span className="font-normal text-ink-4">— opcional</span>
                        </span>
                        <input
                          value={notas}
                          onChange={(e) => setNotas(e.target.value)}
                          placeholder="Desconto de lançamento acordado com a direcção."
                          className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink outline-none placeholder:text-ink-4 focus:border-line-strong"
                        />
                      </label>
                    </>
                  )}
                </div>

                <div className="mt-3">
                  <span className="mb-1.5 block text-meta font-medium text-ink">Estado da subscrição</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ESTADOS.map((e) => (
                      <button
                        key={e.value}
                        type="button"
                        aria-pressed={subStatus === e.value}
                        onClick={() => setSubStatus(e.value)}
                        title={e.nota}
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                          subStatus === e.value
                            ? "border-signal bg-signal-soft text-signal-ink"
                            : "border-line text-ink-2 hover:border-line-strong hover:bg-sunken",
                        )}
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                    {ESTADOS.find((e) => e.value === subStatus)?.nota}
                  </p>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void gravarPlano()}
                    /*
                     * Com condições por emitir há sempre o que fazer — nem que
                     * o plano e o estado fiquem iguais: mudar só a mensalidade
                     * é uma renegociação, e antes disto o botão ficava apagado
                     * precisamente nesse caso. Sem emitir, volta a regra antiga:
                     * gravar o que já lá está não é gravar nada.
                     */
                    disabled={
                      busy ||
                      !planId ||
                      (emitir && precoCents === null) ||
                      (!emitir && planId === academy.planId && subStatus === academy.subscriptionStatus)
                    }
                    className="ctl-primary"
                  >
                    {busy ? "A gravar…" : "Guardar plano"}
                  </button>
                  {planoGravado && (
                    <span
                      className={
                        ordem && !ordem.enviado ? "text-meta text-[#a3521a]" : "text-meta text-[#1f7a45]"
                      }
                    >
                      {/*
                        Gravar o plano e enviar as condições são duas coisas, e o
                        aviso diz as duas. Um "Gravado." sozinho deixava quem
                        carregou sem saber se o presidente foi notificado — e a
                        pergunta seguinte era um telefonema.
                      */}
                      {!ordem
                        ? "Gravado."
                        : ordem.enviado
                          ? "Gravado. Condições enviadas para assinatura."
                          : `Gravado. Condições emitidas, mas por enviar${ordem.motivo ? ` — ${ordem.motivo}` : ""}`}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* --- Desactivar / reactivar ---------------------------------- */}
          <div className="rounded-[var(--radius-control)] border border-line p-3.5">
            <p className="text-body font-medium text-ink">{cancelada ? "Reactivar" : "Desactivar"}</p>
            <p className="mt-1 text-meta leading-relaxed text-ink-3">
              {cancelada
                ? "O clube volta a abrir, exactamente onde estava. Ninguém perdeu nada."
                : "Ninguém entra e nenhum endereço do clube responde — nem a consola, nem a app das famílias. Os dados ficam todos, e podes reactivar quando quiseres."}
            </p>
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={busy}
              className={cx("mt-3", cancelada ? "ctl-primary" : "ctl-outline text-[#8a5a12]")}
            >
              {busy ? "…" : cancelada ? "Reactivar clube" : "Desactivar clube"}
            </button>
          </div>

          {/* --- Apagar --------------------------------------------------- */}
          {mayDelete && (
            <div className="rounded-[var(--radius-control)] border border-[#f0c9c2] bg-[#fdf6f5] p-3.5">
              <p className="text-body font-medium text-[#a82a20]">Apagar de vez</p>
              <p className="mt-1 text-meta leading-relaxed text-ink-2">
                Leva tudo: atletas, equipas, presenças, avaliações, boletins clínicos, mensalidades e as contas das
                famílias. Não há como voltar atrás.
              </p>

              {!apagar ? (
                <button type="button" onClick={() => setApagar(true)} className="ctl-ghost mt-3 text-[#a82a20]">
                  Quero apagar este clube
                </button>
              ) : (
                <form onSubmit={remove} className="mt-3 space-y-2">
                  <label className="block">
                    <span className="mb-1.5 block text-meta text-ink-2">
                      Escreve <strong className="font-mono font-medium text-ink">{academy.slug}</strong> para confirmar
                    </span>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      autoFocus
                      placeholder={academy.slug}
                      className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 font-mono text-[13px] text-ink focus:border-line-strong focus:outline-none"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy || slug.trim().toLowerCase() !== academy.slug.toLowerCase()}
                      className="ctl-primary bg-[#a82a20] hover:bg-[#8f231a] disabled:bg-ink-4"
                    >
                      {busy ? "A apagar…" : "Apagar para sempre"}
                    </button>
                    <button type="button" onClick={() => setApagar(false)} className="ctl-ghost">
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta leading-relaxed text-[#a82a20]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
