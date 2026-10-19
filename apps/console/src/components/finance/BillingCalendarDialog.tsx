import { useMemo, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { apiPatch } from "@/lib/http";
import { CalendarDays, LayoutGrid, Shield, TriangleAlert } from "@/lib/icons";
import { reloadAcademy, useStore } from "@/lib/store";
import { athleteById, listAllFees, listTeams, sportById } from "@/lib/api";
import { useSession } from "@/session";
import { GrelhaDeMeses, MES_CURTO, MES_EXTENSO, ORDEM_DA_EPOCA, SEM_ESCALAO, type LinhaDeEscalao } from "./MesesPorEscalao";

/** O primeiro período da época corrente (`AAAA-08`), como `inicioDaEpoca` no servidor. */
function inicioDaEpoca(agora = new Date()): string {
  const ano = agora.getMonth() + 1 >= 8 ? agora.getFullYear() : agora.getFullYear() - 1;
  return `${ano}-08`;
}

/** `2026-08` → `2026/27`. */
function nomeDaEpoca(inicio: string): string {
  const ano = Number(inicio.slice(0, 4));
  return `${ano}/${String((ano + 1) % 100).padStart(2, "0")}`;
}

/** `2027-08` → "1 de Agosto de 2027". */
function diaDeAbertura(inicio: string): string {
  return `1 de ${MES_EXTENSO[Number(inicio.slice(5, 7)) - 1]} de ${inicio.slice(0, 4)}`;
}

function juntar(nomes: string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function mesmosMeses(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}

type Quando = "atual" | "proxima";
type Modo = "clube" | "escalao";

/** O que o diálogo edita: o modo, os meses do clube, os de cada escalão e o dia. */
type Calendario = { modo: Modo; meses: number[]; equipas: Record<string, number[]>; dia: number };

/**
 * O calendário de cobrança: em que dia vence, e em que meses se cobra.
 *
 * Vivia nas Definições e gravava a cada toque. Mudou-se para as Mensalidades,
 * que é onde a pergunta aparece ("porque é que Agosto não tem mensalidades?"),
 * e passou a gravar só no **Guardar**: desligar um mês apaga as mensalidades
 * desse mês na época, e um toque por engano num botão que grava sozinho era
 * perder esse registo sem aviso. Antes de gravar um mês desligado, o diálogo
 * diz quantas mensalidades vão sair e pede confirmação.
 *
 * ## Do clube todo ou por escalão
 *
 * Um clube contou que os escalões não pagam os mesmos meses: uns não pagam
 * Agosto, outros pagam Agosto e não pagam Julho. "Por escalão" troca a régua
 * dos doze meses por uma grelha com uma linha por escalão (`GrelhaDeMeses`).
 * A última linha, "Sem escalão", é para os atletas sem equipa e para os
 * escalões criados depois; é a mesma régua do modo "clube todo", e voltar a
 * esse modo encontra-a como ficou.
 *
 * ## Esta época ou a próxima
 *
 * Um clube que decide em Março deixar de cobrar Agosto quer que isso valha na
 * época seguinte, sem mexer na que está a meio. "Só a partir da próxima" agenda
 * o calendário na academia (`billingNext`), que passa a valer no primeiro
 * período dessa época; até lá nada muda. Com um agendamento feito, escolher
 * "próxima" mostra-o para editar, e voltar a pôr o calendário de hoje anula-o.
 * Vale para o modo e para os meses de cada escalão.
 */
export function BillingCalendarDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { academy } = useStore();
  const { session } = useSession();

  const epocaAtual = inicioDaEpoca();
  const proximaEpoca = `${Number(epocaAtual.slice(0, 4)) + 1}-08`;
  const agendado = academy.billingNext && academy.billingNext.from === proximaEpoca ? academy.billingNext : null;

  /* Os escalões desta época: por modalidade, e do mais novo para o mais velho. */
  const escaloes = useMemo(() => {
    const lista = session ? listTeams(session) : [];
    return lista
      .map((t) => ({ id: t.id, nome: t.name, grupo: sportById(t.sportId)?.name ?? "", maxAge: t.maxAge }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo, "pt") || a.maxAge - b.maxAge || a.nome.localeCompare(b.nome, "pt"));
  }, [session]);

  /* O ponto de partida de cada escolha: o calendário de hoje, ou o agendado. */
  function base(q: Quando): Calendario {
    const proxima = q === "proxima" && agendado;
    const meses = proxima ? agendado.months : academy.billingMonths;
    const equipas: Record<string, number[]> = {};
    for (const e of escaloes) {
      const t = academy.billingTeams.find((x) => x.teamId === e.id);
      const proprios = proxima && t?.nextMonths.length ? t.nextMonths : t?.months;
      equipas[e.id] = proprios?.length ? proprios : meses;
    }
    return {
      modo: (proxima ? agendado.byTeam : academy.billingByTeam) ? "escalao" : "clube",
      meses,
      equipas,
      dia: proxima ? agendado.dueDay : academy.billingDueDay,
    };
  }

  const [quando, setQuando] = useState<Quando>("atual");
  const [rascunho, setRascunho] = useState<Calendario>(() => base("atual"));
  const [dia, setDia] = useState(String(academy.billingDueDay));
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const partida = base(quando);
  const porEscalao = rascunho.modo === "escalao";
  const diaNum = Number(dia);
  const diaValido = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 28;
  const mudouDia = diaValido && diaNum !== partida.dia;
  const mudouModo = rascunho.modo !== partida.modo;
  const mudouMeses = !mesmosMeses(rascunho.meses, partida.meses);
  const mudouEquipas = escaloes.some((e) => !mesmosMeses(rascunho.equipas[e.id] ?? [], partida.equipas[e.id] ?? []));
  const mudou = mudouDia || mudouModo || mudouMeses || (porEscalao && mudouEquipas);

  /** Este atleta paga este mês, com o rascunho? A mesma regra de `cobraAoAtleta` na API. */
  function pagaNoRascunho(athleteId: string, mes: number): boolean {
    if (!porEscalao) return rascunho.meses.includes(mes);
    const equipas = (athleteById(athleteId)?.equipas ?? []).map((e) => e.teamId);
    if (equipas.length === 0) return rascunho.meses.includes(mes);
    return equipas.some((t) => (rascunho.equipas[t] ?? rascunho.meses).includes(mes));
  }

  /* As mensalidades que o rascunho leva, pelo que a consola já tem. */
  const desde = quando === "atual" ? epocaAtual : proximaEpoca;
  const aPerder = useMemo(() => {
    if (!session) return 0;
    return listAllFees(session).filter((f) => {
      if (f.extra || f.period < desde) return false;
      // Com "esta época", a próxima segue o agendamento, se houver um.
      if (quando === "atual" && agendado && f.period >= agendado.from) return false;
      return !pagaNoRascunho(f.athleteId, Number(f.period.slice(5, 7)));
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho, session, desde, quando, agendado?.from]);

  /* O que deixa de se pagar, dito por extenso para a confirmação. */
  const perdas = useMemo(() => {
    if (!porEscalao) {
      const fora = partida.meses.filter((m) => !rascunho.meses.includes(m));
      return fora.length ? [juntar(fora.map((m) => MES_EXTENSO[m - 1]))] : [];
    }
    return escaloes
      .map((e) => {
        const antes = partida.modo === "escalao" ? (partida.equipas[e.id] ?? []) : partida.meses;
        const fora = antes.filter((m) => !(rascunho.equipas[e.id] ?? []).includes(m));
        return fora.length ? `${e.nome} sem ${juntar(fora.map((m) => MES_EXTENSO[m - 1]))}` : null;
      })
      .filter((x): x is string => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho, quando]);

  function escolher(q: Quando) {
    if (q === quando) return;
    const b = base(q);
    setQuando(q);
    setRascunho(b);
    setDia(String(b.dia));
    setConfirmar(false);
    setErro(null);
  }

  function mudarModo(modo: Modo) {
    setConfirmar(false);
    setRascunho((r) => ({ ...r, modo }));
  }

  function alternar(mes: number) {
    setConfirmar(false);
    setRascunho((r) => {
      const proximo = r.meses.includes(mes) ? r.meses.filter((m) => m !== mes) : [...r.meses, mes].sort((a, b) => a - b);
      // Nunca zero meses: o servidor recusa-o na mesma.
      return proximo.length === 0 ? r : { ...r, meses: proximo };
    });
  }

  function mudarGrelha(mudancas: { id: string; meses: number[] }[]) {
    setConfirmar(false);
    setRascunho((r) => {
      const equipas = { ...r.equipas };
      let meses = r.meses;
      for (const m of mudancas) {
        if (m.id === SEM_ESCALAO) meses = m.meses;
        else equipas[m.id] = m.meses;
      }
      return { ...r, meses, equipas };
    });
  }

  type Patch = { dueDay?: number; months?: number[]; byTeam?: boolean; teams?: { teamId: string; months: number[] }[] };

  async function enviar(patch: Patch, q: Quando) {
    setBusy(true);
    setErro(null);
    try {
      const r = await apiPatch<{
        apagadas?: number;
        anuladas?: number;
        comDinheiro?: number;
        agendadoDesde?: string | null;
      }>("/api/pagamentos", { ...patch, aplicarEm: q });
      await reloadAcademy();
      onSaved();

      const partes: string[] = [];
      if (r?.apagadas) partes.push(`${r.apagadas} ${r.apagadas === 1 ? "mensalidade apagada" : "mensalidades apagadas"}`);
      if (r?.anuladas) partes.push(`${r.anuladas} ${r.anuladas === 1 ? "anulada" : "anuladas"} por terem referência Multibanco por pagar`);
      if (r?.comDinheiro) partes.push(`${r.comDinheiro} ${r.comDinheiro === 1 ? "ficou" : "ficaram"} por ter pagamento online`);
      const contas = partes.length ? ` ${partes.join(", ")}.` : "";

      if (q === "proxima") {
        setFeito(
          r?.agendadoDesde
            ? `Agendado para a época ${nomeDaEpoca(r.agendadoDesde)}: entra em vigor a ${diaDeAbertura(r.agendadoDesde)}.${contas}`
            : `Agendamento anulado: a época ${nomeDaEpoca(proximaEpoca)} segue o calendário de hoje.${contas}`,
        );
      } else if (partes.length) {
        setFeito(`Guardado:${contas}`);
      } else {
        onClose();
        return;
      }
      setConfirmar(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  /** Os meses de todos os escalões, como estão no rascunho: por escalão, vão sempre todos. */
  const todasAsEquipas = () => escaloes.map((e) => ({ teamId: e.id, months: rascunho.equipas[e.id] ?? rascunho.meses }));

  async function gravar() {
    if (!mudou || !diaValido) return;
    if (aPerder > 0 && !confirmar) {
      setConfirmar(true);
      return;
    }
    const patch: Patch = {};
    if (mudouDia) patch.dueDay = diaNum;
    if (mudouMeses) patch.months = rascunho.meses;
    if (mudouModo) patch.byTeam = porEscalao;
    /*
     * Por escalão vão os meses de todos, e não só os que mudaram: um escalão
     * sem meses próprios segue a linha "Sem escalão", e mexer nela mais tarde
     * mudava-lhe os meses sem ninguém ter tocado na linha dele.
     */
    if (porEscalao) patch.teams = todasAsEquipas();
    await enviar(patch, quando);
  }

  /* Anular o agendamento: agendar o calendário de hoje, que o servidor lê como "nada agendado". */
  function anularAgendamento() {
    const hoje = base("atual");
    void enviar(
      {
        dueDay: hoje.dia,
        months: hoje.meses,
        byTeam: hoje.modo === "escalao",
        teams: escaloes.map((e) => ({ teamId: e.id, months: hoje.equipas[e.id] })),
      },
      "proxima",
    );
  }

  const fechado = busy || Boolean(feito);

  const opcoes: { value: Quando; label: string; hint: string }[] = [
    { value: "atual", label: `Já nesta época (${nomeDaEpoca(epocaAtual)})`, hint: "muda a partir de agora" },
    {
      value: "proxima",
      label: `Só a partir da próxima (${nomeDaEpoca(proximaEpoca)})`,
      hint: `entra em vigor a ${diaDeAbertura(proximaEpoca)}`,
    },
  ];

  const modos: { value: Modo; label: string; hint: string; icone: typeof Shield }[] = [
    { value: "clube", label: "Igual para o clube todo", hint: "os mesmos meses para todos", icone: Shield },
    { value: "escalao", label: "Por escalão", hint: "cada escalão paga os seus meses", icone: LayoutGrid },
  ];

  const linhas: LinhaDeEscalao[] = escaloes.map((e) => ({ id: e.id, nome: e.nome, grupo: e.grupo, meses: rascunho.equipas[e.id] ?? rascunho.meses }));

  return (
    <Dialog
      title="Período de cobrança"
      subtitle="O dia em que as mensalidades vencem e os meses em que se cobram."
      icon={<CalendarDays className="size-4" strokeWidth={1.75} />}
      width={porEscalao ? 760 : 480}
      onClose={onClose}
      footer={
        feito ? (
          <button type="button" className="ctl-primary" onClick={onClose}>
            Fechar
          </button>
        ) : confirmar ? (
          <>
            <button type="button" className="ctl-ghost" onClick={() => setConfirmar(false)} disabled={busy}>
              Voltar
            </button>
            <button type="button" className="ctl-risk" onClick={() => void gravar()} disabled={busy}>
              {busy ? "A guardar…" : "Apagar e guardar"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="ctl-primary" onClick={() => void gravar()} disabled={!mudou || !diaValido || busy}>
              {busy ? "A guardar…" : quando === "proxima" ? "Agendar" : "Guardar"}
            </button>
          </>
        )
      }
    >
      <div className="border-b border-line bg-sunken/40 px-5 py-3.5">
        <span className="mb-2 block text-meta font-medium text-ink">Quando entra em vigor</span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {opcoes.map((o) => (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 transition-colors duration-[120ms]",
                quando === o.value ? "border-signal-line bg-signal-soft/40" : "border-line bg-surface hover:bg-sunken",
                fechado && "pointer-events-none opacity-60",
              )}
            >
              <input
                type="radio"
                name="calendario-quando"
                checked={quando === o.value}
                onChange={() => escolher(o.value)}
                disabled={fechado}
                className="mt-0.5 accent-[var(--color-signal)]"
              />
              <span className="min-w-0">
                <span className="block text-body text-ink">{o.label}</span>
                <span className="block text-meta text-ink-3">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {agendado && !feito && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
            {quando === "atual" ? (
              <>
                Já há um calendário agendado para {nomeDaEpoca(agendado.from)}
                {agendado.byTeam ? ", por escalão" : `: dia ${agendado.dueDay}, ${agendado.months.length} ${agendado.months.length === 1 ? "mês" : "meses"}`}. Mudar
                esta época não o altera.
              </>
            ) : (
              <>
                A mostrar o calendário agendado para {nomeDaEpoca(agendado.from)}.{" "}
                <button
                  type="button"
                  onClick={anularAgendamento}
                  disabled={busy}
                  className="font-medium text-risk hover:underline disabled:opacity-50"
                >
                  Anular o agendamento
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <div className="space-y-5 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta font-medium text-ink">Dia de vencimento</span>
          <label className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={28}
              value={dia}
              disabled={fechado}
              onChange={(e) => {
                setDia(e.target.value);
                setConfirmar(false);
              }}
              className={cx(
                "h-9 w-16 rounded-[var(--radius-control)] border bg-surface px-2.5 text-right text-body tabular text-ink focus:outline-none",
                diaValido ? "border-line focus:border-line-strong" : "border-risk",
              )}
            />
            <span className="text-meta text-ink-3">de cada mês</span>
          </label>
        </div>

        {/* Do clube todo ou por escalão: a pergunta antes dos meses, porque muda a forma deles. */}
        <div>
          <span className="mb-2 block text-meta font-medium text-ink">Meses cobrados</span>
          <div role="radiogroup" aria-label="Como se cobram os meses" className="grid grid-cols-2 gap-1.5">
            {modos.map((o) => {
              const on = rascunho.modo === o.value;
              const Icone = o.icone;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={fechado}
                  onClick={() => mudarModo(o.value)}
                  className={cx(
                    "flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors duration-[120ms] disabled:opacity-60",
                    on ? "border-signal-line bg-signal-soft/40" : "border-line bg-surface hover:bg-sunken",
                  )}
                >
                  <span
                    className={cx(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px]",
                      on ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-3",
                    )}
                  >
                    <Icone className="size-3.5" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink">{o.label}</span>
                    <span className="block text-meta text-ink-3">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {porEscalao ? (
          <div className="mc-entra">
            {escaloes.length === 0 ? (
              <p className="rounded-[12px] bg-sunken/60 px-4 py-3 text-meta text-ink-3">
                Ainda não há escalões nesta época. Cria-os em Equipas e volta aqui.
              </p>
            ) : (
              <>
                <p className="mb-2.5 text-[11px] leading-relaxed text-ink-3">
                  Toca num quadrado para ligar ou desligar o mês nesse escalão
                  <span className="max-sm:hidden">, ou arrasta por cima de vários</span>. Tocar no nome do mês muda-o em todos.
                </p>
                <GrelhaDeMeses linhas={linhas} semEscalao={rascunho.meses} disabled={fechado} onChange={mudarGrelha} />
              </>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-baseline justify-end">
              <span className="text-[11px] text-ink-4">
                {rascunho.meses.length} {rascunho.meses.length === 1 ? "mês" : "meses"}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {ORDEM_DA_EPOCA.map((mes) => {
                const on = rascunho.meses.includes(mes);
                return (
                  <button
                    key={mes}
                    type="button"
                    disabled={fechado}
                    aria-pressed={on}
                    onClick={() => alternar(mes)}
                    className={cx(
                      "h-9 rounded-[var(--radius-control)] border text-meta font-medium transition-colors duration-[120ms] disabled:opacity-50",
                      on
                        ? "border-signal-line bg-signal-soft text-signal-ink"
                        : "border-dashed border-line text-ink-4 hover:border-line-strong hover:text-ink-3",
                    )}
                  >
                    {MES_CURTO[mes - 1]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-ink-3">
          {quando === "atual"
            ? porEscalao
              ? "Um mês desligado num escalão não existe para os atletas desse escalão: não gera mensalidades nem se lança à mão. Quem joga em dois escalões paga o mês se um deles o pagar, e só as modalidades que o pagam. Ligar o mês corrente emite logo as que faltam."
              : "Um mês desligado deixa de existir: não gera mensalidades, não se lança à mão, não recebe cobranças avulsas e não aparece nas Mensalidades nem na ficha do atleta. Ligar o mês corrente emite logo as que faltam. Um mês que já passou não é emitido: lança-o em Lançar mensalidade."
            : `Nada muda nesta época. A partir de ${diaDeAbertura(proximaEpoca)}, os meses desligados aqui deixam de existir e o vencimento passa a este dia.`}
        </p>

        {confirmar && (
          <div className="flex gap-2.5 rounded-[var(--radius-control)] bg-risk-soft p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
            <div className="text-meta leading-relaxed text-ink-2">
              <p>
                {perdas.length === 1 && !porEscalao ? `Desligar ${perdas[0]} apaga` : "Os meses desligados apagam"} {aPerder}{" "}
                {aPerder === 1 ? "mensalidade" : "mensalidades"}{" "}
                {quando === "atual" ? "desta época" : `já lançadas para ${nomeDaEpoca(proximaEpoca)}`}, incluindo as marcadas como
                pagas à mão. Só ficam as pagas online. Não há como voltar atrás.
              </p>
              {porEscalao && perdas.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-ink-3">
                  {perdas.slice(0, 6).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                  {perdas.length > 6 && <li>e mais {perdas.length - 6} escalões</li>}
                </ul>
              )}
            </div>
          </div>
        )}

        {feito && <p className="text-meta leading-relaxed text-ink-2">{feito}</p>}
        {erro && <p className="text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}
