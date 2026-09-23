import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { CalendarDays, TriangleAlert } from "@/lib/icons";
import { money } from "@/lib/format";
import { DIAS_DO_MES, MESES, setMemberAnnualYear, type MemberFeeRow } from "@/lib/members";

/**
 * Quando abre o ano de quotas de um sócio.
 *
 * ## Porque é um diálogo, e não dois selectores na ficha
 *
 * Porque isto não é um campo: é uma decisão com consequência. Estava na ficha,
 * a gravar a cada escolha, e mudar o mês antes do dia gravava um estado
 * intermédio que ninguém quis. Aqui escolhe-se, vê-se o que acontece, e só o
 * **Guardar** escreve.
 *
 * ## Um aviso, e não uma pergunta
 *
 * Mudar a data **refaz o ano**: as quotas dele desaparecem — partes de um ano
 * partido incluídas — e nasce uma anuidade na janela nova, com o valor que o
 * ano já valia. Não há intervalo por cobrir porque não fica nada de permeio.
 *
 * Chegou a haver três opções aqui (manter, redatar, tapar o intervalo com uma
 * quota curta) e foram-se: eram três respostas para uma pergunta que o clube
 * não quer que lhe façam, e a mais inocente delas deixava o sócio meses sem ser
 * cobrado. O que ficou é a lista do que vai desaparecer, linha a linha, para
 * ninguém descobrir depois que uma parte se foi sem aviso.
 */
export function AnoDeQuotasDialog({
  memberId,
  memberName,
  annual,
  fees,
  onClose,
  onDone,
}: {
  memberId: string;
  memberName: string;
  annual: { month: number; day: number; own: boolean; clubMonth: number; clubDay: number };
  /** Para dizer, antes de gravar, que quotas vão ser refeitas. */
  fees: MemberFeeRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mes, setMes] = useState(annual.month);
  const [dia, setDia] = useState(annual.day);
  const [herdar, setHerdar] = useState(!annual.own);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /* O que fica a valer: o do clube quando se herda, senão o escolhido. */
  const efetivo = herdar ? { mes: annual.clubMonth, dia: annual.clubDay } : { mes, dia };
  const mudou = efetivo.mes !== annual.month || efetivo.dia !== annual.day;

  const hoje = new Date();

  /* A janela nova: o ciclo que contém hoje, na data escolhida. */
  const janelaNova = useMemo(() => {
    const d = Math.min(efetivo.dia, DIAS_DO_MES[efetivo.mes - 1]);
    const abriuEsteAno =
      hoje.getMonth() + 1 > efetivo.mes || (hoje.getMonth() + 1 === efetivo.mes && hoje.getDate() >= d);
    const ano = abriuEsteAno ? hoje.getFullYear() : hoje.getFullYear() - 1;
    return {
      de: new Date(Date.UTC(ano, efetivo.mes - 1, d)),
      ate: new Date(Date.UTC(ano + 1, efetivo.mes - 1, d) - 86_400_000),
    };
  }, [efetivo.mes, efetivo.dia]);

  /* O que vai ser refeito: tudo o que a janela nova pisa, e tudo o que ainda
     não acabou. A mesma regra do servidor. */
  const aApagar = useMemo(
    () =>
      mudou
        ? fees.filter(
            (f) =>
              f.coversFrom &&
              f.coversTo &&
              ((new Date(f.coversFrom) <= janelaNova.ate && janelaNova.de <= new Date(f.coversTo)) ||
                (f.status !== "VOID" && new Date(f.coversTo) >= hoje)),
          )
        : [],
    [fees, mudou, janelaNova],
  );
  const valorDoAno = aApagar.reduce((n, f) => n + f.amountCents, 0);
  const algumaOnline = aApagar.some((f) => f.status === "SETTLED" && f.method !== null && f.method !== "CASH");

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await setMemberAnnualYear(memberId, {
        annualStart: herdar ? "" : `${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      });
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="ano-de-quotas"
      title="Quando abre o ano de quotas"
      subtitle={memberName}
      icon={<CalendarDays className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">
            {mudou ? `Passa a abrir a ${efetivo.dia} de ${MESES[efetivo.mes - 1]}.` : "Sem alterações."}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-ano" className="ctl-primary" disabled={busy}>
              {busy ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-ano" onSubmit={submeter} className="space-y-4 p-5">
        {erro && (
          <p className="flex items-start gap-1.5 text-meta leading-relaxed text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}

        <p className="text-meta leading-relaxed text-ink-3">
          A anuidade deste sócio corre a partir deste dia, todos os anos. Quem adere fica com a data da adesão;
          quem já cá estava herda a do clube.
        </p>

        <DialogField label="Abre a" hint={herdar ? "a do clube" : "a deste sócio"}>
          <div className="flex items-end gap-1.5">
            <select
              aria-label="Dia"
              value={efetivo.dia}
              disabled={herdar}
              onChange={(e) => setDia(Number(e.target.value))}
              className={cx(dialogInputClass, "w-auto pr-1.5 tabular", herdar && "opacity-50")}
            >
              {Array.from({ length: DIAS_DO_MES[efetivo.mes - 1] }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              aria-label="Mês"
              value={efetivo.mes}
              disabled={herdar}
              onChange={(e) => {
                const m = Number(e.target.value);
                setMes(m);
                /* 31 de Fevereiro não é uma data: o dia encolhe com o mês. */
                setDia((d) => Math.min(d, DIAS_DO_MES[m - 1]));
              }}
              className={cx(dialogInputClass, "w-auto pr-1.5", herdar && "opacity-50")}
            >
              {MESES.map((nome, i) => (
                <option key={nome} value={i + 1}>
                  {nome}
                </option>
              ))}
            </select>
          </div>
        </DialogField>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={herdar}
            onChange={(e) => setHerdar(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-meta leading-relaxed text-ink-2">
            Usar a abertura do clube
            <span className="block text-ink-3">
              {annual.clubDay} de {MESES[annual.clubMonth - 1]}. Muda com ela se o clube a mudar.
            </span>
          </span>
        </label>

        {/*
          O que a mudança faz, dito antes de a fazer.

          Mudar a data **refaz o ano**: não há escolha a fazer, e por isso o que
          aqui vai é um aviso e não uma pergunta. Mostra-se linha a linha o que
          desaparece, para ninguém descobrir depois que uma parte de um ano
          partido se foi sem aviso.
        */}
        {mudou && aApagar.length > 0 && (
          <div className="rounded-[var(--radius-control)] border border-line p-3">
            <p className="mb-2 text-meta font-medium text-ink">
              O ano é refeito
              <span className="ml-2 font-normal text-ink-4">
                {aApagar.length === 1 ? "1 quota substituída" : `${aApagar.length} quotas substituídas`}
              </span>
            </p>
            <ul className="mb-2 space-y-1">
              {aApagar.map((f) => (
                <li key={f.id} className="flex items-baseline gap-2 text-meta text-ink-3">
                  <span className="min-w-0 flex-1 truncate line-through">
                    {f.label ?? f.period} · {data(f.coversFrom)} a {data(f.coversTo)}
                  </span>
                  <span className="tabular shrink-0">{money(f.amountCents)}</span>
                </li>
              ))}
            </ul>
            <p className="flex items-baseline gap-2 border-t border-line pt-2 text-meta text-ink-2">
              <span className="min-w-0 flex-1">
                Fica uma anuidade de <strong className="text-ink">{data(janelaNova.de)}</strong> a{" "}
                <strong className="text-ink">{data(janelaNova.ate)}</strong>
              </span>
              <span className="tabular shrink-0 font-semibold text-ink">{money(valorDoAno)}</span>
            </p>
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
              Fica com o valor que o ano já valia. Não sobra nenhum período por cobrir.
            </p>
            {algumaOnline && (
              <p className="mt-2 flex items-start gap-1.5 text-meta leading-relaxed text-risk">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                Uma destas foi paga online. O servidor vai recusar — apagá-la levava o registo do dinheiro atrás.
              </p>
            )}
          </div>
        )}

        {mudou && aApagar.length === 0 && (
          <p className="text-meta leading-relaxed text-ink-3">
            Não há nenhuma anuidade lançada para refazer. A data nova vale a partir da próxima que nascer.
          </p>
        )}
      </form>
    </Dialog>
  );
}


/** `22/09/2026`, em UTC — as datas de cobertura são datas puras. */
function data(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
