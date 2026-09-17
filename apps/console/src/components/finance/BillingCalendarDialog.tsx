import { useMemo, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { apiPatch } from "@/lib/http";
import { CalendarDays, TriangleAlert } from "@/lib/icons";
import { reloadAcademy, useStore } from "@/lib/store";
import { listAllFees } from "@/lib/api";
import { useSession } from "@/session";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_POR_EXTENSO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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
  return `1 de ${MESES_POR_EXTENSO[Number(inicio.slice(5, 7)) - 1]} de ${inicio.slice(0, 4)}`;
}

function juntar(nomes: string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function mesmosMeses(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}

type Quando = "atual" | "proxima";

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
 * ## Esta época ou a próxima
 *
 * Um clube que decide em Março deixar de cobrar Agosto quer que isso valha na
 * época seguinte, sem mexer na que está a meio. "Só a partir da próxima" agenda
 * o calendário na academia (`billingNext`), que passa a valer no primeiro
 * período dessa época; até lá nada muda. Com um agendamento feito, escolher
 * "próxima" mostra-o para editar, e voltar a pôr o calendário de hoje anula-o.
 */
export function BillingCalendarDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { academy } = useStore();
  const { session } = useSession();

  const epocaAtual = inicioDaEpoca();
  const proximaEpoca = `${Number(epocaAtual.slice(0, 4)) + 1}-08`;
  const agendado = academy.billingNext && academy.billingNext.from === proximaEpoca ? academy.billingNext : null;

  /* O ponto de partida de cada escolha: o calendário de hoje, ou o agendado. */
  const base = (q: Quando) =>
    q === "proxima" && agendado
      ? { meses: agendado.months, dia: agendado.dueDay }
      : { meses: academy.billingMonths, dia: academy.billingDueDay };

  const [quando, setQuando] = useState<Quando>("atual");
  const [dia, setDia] = useState(String(academy.billingDueDay));
  const [meses, setMeses] = useState<number[]>(academy.billingMonths);
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const partida = base(quando);
  const diaNum = Number(dia);
  const diaValido = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 28;
  const mudouDia = diaValido && diaNum !== partida.dia;
  const mudouMeses = !mesmosMeses(meses, partida.meses);
  const mudou = mudouDia || mudouMeses;

  /* Os meses que estavam ligados e este rascunho desliga. */
  const desligados = partida.meses.filter((m) => !meses.includes(m));

  /* As mensalidades que desligar esses meses leva, pelo que a consola já tem. */
  const desde = quando === "atual" ? epocaAtual : proximaEpoca;
  const aPerder = useMemo(() => {
    if (desligados.length === 0 || !session) return 0;
    return listAllFees(session).filter((f) => {
      if (f.extra || f.period < desde) return false;
      // Com "esta época", a próxima segue o agendamento, se houver um.
      if (quando === "atual" && agendado && f.period >= agendado.from) return false;
      return desligados.includes(Number(f.period.slice(5, 7)));
    }).length;
  }, [desligados.join(","), session, desde, quando, agendado?.from]);

  function escolher(q: Quando) {
    if (q === quando) return;
    const b = base(q);
    setQuando(q);
    setMeses(b.meses);
    setDia(String(b.dia));
    setConfirmar(false);
    setErro(null);
  }

  function alternar(mes: number) {
    setConfirmar(false);
    setMeses((atual) => {
      const proximo = atual.includes(mes) ? atual.filter((m) => m !== mes) : [...atual, mes].sort((a, b) => a - b);
      // Nunca zero meses: o servidor recusa-o na mesma.
      return proximo.length === 0 ? atual : proximo;
    });
  }

  async function enviar(patch: { dueDay?: number; months?: number[] }, q: Quando) {
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

  async function gravar() {
    if (!mudou || !diaValido) return;
    if (aPerder > 0 && !confirmar) {
      setConfirmar(true);
      return;
    }
    const patch: { dueDay?: number; months?: number[] } = {};
    if (mudouDia) patch.dueDay = diaNum;
    if (mudouMeses) patch.months = meses;
    await enviar(patch, quando);
  }

  /* Anular o agendamento: agendar o calendário de hoje, que o servidor lê como "nada agendado". */
  function anularAgendamento() {
    void enviar({ dueDay: academy.billingDueDay, months: academy.billingMonths }, "proxima");
  }

  const nomesDesligados = juntar(desligados.map((m) => MESES_POR_EXTENSO[m - 1]));
  const fechado = busy || Boolean(feito);

  const opcoes: { value: Quando; label: string; hint: string }[] = [
    { value: "atual", label: `Já nesta época (${nomeDaEpoca(epocaAtual)})`, hint: "muda a partir de agora" },
    {
      value: "proxima",
      label: `Só a partir da próxima (${nomeDaEpoca(proximaEpoca)})`,
      hint: `entra em vigor a ${diaDeAbertura(proximaEpoca)}`,
    },
  ];

  return (
    <Dialog
      title="Período de cobrança"
      subtitle="O dia em que as mensalidades vencem e os meses em que o clube cobra."
      icon={<CalendarDays className="size-4" strokeWidth={1.75} />}
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
                Já há um calendário agendado para {nomeDaEpoca(agendado.from)}: dia {agendado.dueDay},{" "}
                {agendado.months.length} {agendado.months.length === 1 ? "mês" : "meses"}. Mudar esta época não o altera.
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

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-meta font-medium text-ink">Meses cobrados</span>
            <span className="text-[11px] text-ink-4">
              {meses.length} {meses.length === 1 ? "mês" : "meses"}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {MESES.map((nome, i) => {
              const mes = i + 1;
              const on = meses.includes(mes);
              return (
                <button
                  key={nome}
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
                  {nome}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            {quando === "atual"
              ? "Um mês desligado deixa de existir: não gera mensalidades, não se lança à mão, não recebe cobranças avulsas e não aparece nas Mensalidades nem na ficha do atleta. Ligar o mês corrente emite logo as que faltam. Um mês que já passou não é emitido: lança-o em Lançar mensalidade."
              : `Nada muda nesta época. A partir de ${diaDeAbertura(proximaEpoca)}, os meses desligados aqui deixam de existir e o vencimento passa a este dia.`}
          </p>
        </div>

        {confirmar && (
          <div className="flex gap-2.5 rounded-[var(--radius-control)] bg-risk-soft p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
            <p className="text-meta leading-relaxed text-ink-2">
              Desligar {nomesDesligados} apaga {aPerder} {aPerder === 1 ? "mensalidade" : "mensalidades"}{" "}
              {quando === "atual" ? "desta época" : `já lançadas para ${nomeDaEpoca(proximaEpoca)}`}, incluindo as
              marcadas como pagas à mão. Só ficam as pagas online. Não há como voltar atrás.
            </p>
          </div>
        )}

        {feito && <p className="text-meta leading-relaxed text-ink-2">{feito}</p>}
        {erro && <p className="text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}
