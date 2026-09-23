import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Scissors, TriangleAlert } from "@/lib/icons";
import { money } from "@/lib/format";
import { MESES, splitMemberFee, type MemberFeeRow } from "@/lib/members";

/**
 * Cobrar uma anuidade só até um mês, e passar o resto para uma segunda.
 *
 * ## O que isto resolve
 *
 * O sócio que quer pagar meio ano de uma vez. A anuidade dele cobre o ano
 * inteiro numa linha só, e não havia como dizer "cobra-me até Dezembro e o
 * resto depois" sem apagar a quota e lançar duas à mão — com o preço feito de
 * cabeça, que é como se enganam os dois.
 *
 * ## O mês escolhido entra
 *
 * "Até Dezembro" cobra Dezembro. Com o ano a abrir dia 22, isso vai de 22 de
 * Setembro a 21 de Janeiro: quatro meses contados de dia 22 a dia 21. É por
 * isso que este ecrã mostra as datas e não só os meses — o clube tem de ver
 * onde uma parte acaba e a outra começa.
 *
 * ## O preço
 *
 * Proporcional aos meses, sobre o valor **desta** quota e não sobre o preço da
 * categoria: uma anuidade com um valor acordado à mão parte-se por esse valor.
 * A segunda fica com o que sobra ao cêntimo, para as duas somarem exactamente o
 * que a anuidade valia. A conta é a mesma aqui e no servidor; isto é a
 * pré-visualização, a verdade é a de lá.
 *
 * ## O início não se escolhe
 *
 * Só o fim. É o que impede a segunda parte de recuar para cima de um mês já
 * cobrado. Quem quiser outro início lança uma quota nova, onde o mês inicial é
 * uma escolha.
 */
export function DividirQuotaDialog({
  fee,
  onClose,
  onDone,
}: {
  fee: MemberFeeRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const de = mesDe(fee.coversFrom!);
  const fimActual = mesFinalCoberto(fee.coversTo!);
  const total = distancia(de, fimActual);

  /* Metade, que é o pedido mais comum — "quero pagar meio ano". */
  const [ate, setAte] = useState(() => somarMeses(de, Math.max(0, Math.floor(total / 2) - 1)));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const primeiros = distancia(de, ate);
  const valido = primeiros >= 1 && primeiros < total;

  const conta = useMemo(() => {
    if (!valido) return null;
    const primeira = Math.round((fee.amountCents * primeiros) / total);
    return { primeira, segunda: fee.amountCents - primeira };
  }, [fee.amountCents, primeiros, total, valido]);

  /* O dia das fronteiras é o da própria quota — é ele que faz "22 a 21". */
  const dia = new Date(fee.coversFrom!).getUTCDate();
  const fimDaPrimeira = fimDaCobertura(ate, dia);
  const inicioDaSegunda = new Date(fimDaPrimeira.getTime() + 86_400_000);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await splitMemberFee(fee.id, periodo(ate));
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível dividir.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="dividir-quota"
      title="Cobrar até um mês"
      subtitle={fee.label ?? fee.period}
      icon={<Scissors className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-meta text-ink-3">
            {conta ? (
              <span className="tabular">
                {money(conta.primeira)} + {money(conta.segunda)} = {money(fee.amountCents)}
              </span>
            ) : (
              "Escolhe o último mês a cobrar."
            )}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-dividir" className="ctl-primary" disabled={!valido || busy}>
              <Scissors className="size-3.5" strokeWidth={1.75} />
              {busy ? "A dividir…" : "Dividir"}
            </button>
          </div>
        </div>
      }
    >
      <form id="form-dividir" onSubmit={submeter} className="space-y-4 p-5">
        {erro && (
          <p className="flex items-start gap-1.5 text-meta leading-relaxed text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}

        <p className="text-meta leading-relaxed text-ink-3">
          Esta quota cobre {total} {total === 1 ? "mês" : "meses"}, de{" "}
          <strong className="text-ink-2">{dataCurta(new Date(fee.coversFrom!))}</strong> a{" "}
          <strong className="text-ink-2">{dataCurta(new Date(fee.coversTo!))}</strong>. Escolhe o último mês a
          cobrar nela — o resto passa para uma quota nova.
        </p>

        <DialogField label="Cobrar até (inclusive)" hint="o mês escolhido entra">
          <div className="flex items-end gap-1.5">
            <select
              aria-label="Mês"
              value={ate.mes}
              onChange={(e) => setAte({ ...ate, mes: Number(e.target.value) })}
              className={cx(dialogInputClass, "w-auto pr-1.5")}
            >
              {MESES.map((nome, i) => (
                <option key={nome} value={i + 1}>
                  {nome}
                </option>
              ))}
            </select>
            <select
              aria-label="Ano"
              value={ate.ano}
              onChange={(e) => setAte({ ...ate, ano: Number(e.target.value) })}
              className={cx(dialogInputClass, "w-auto pr-1.5 tabular")}
            >
              {anosPossiveis(de, fimActual).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </DialogField>

        {!valido ? (
          <p className="text-meta text-risk">
            {primeiros < 1
              ? "O mês final não pode ser anterior ao início da quota."
              : "Essa é a data em que esta quota já acaba — escolhe um mês mais cedo."}
          </p>
        ) : (
          conta && (
            <div className="space-y-1.5 rounded-[var(--radius-control)] border border-line p-3">
              <Linha
                titulo="Esta quota passa a cobrir"
                intervalo={`${dataCurta(new Date(fee.coversFrom!))} a ${dataCurta(fimDaPrimeira)}`}
                meses={primeiros}
                valor={conta.primeira}
              />
              <Linha
                titulo="Nasce uma quota nova"
                intervalo={`${dataCurta(inicioDaSegunda)} a ${dataCurta(new Date(fee.coversTo!))}`}
                meses={total - primeiros}
                valor={conta.segunda}
              />
            </div>
          )
        )}

        <p className="text-meta leading-relaxed text-ink-3">
          A quota nova fica <strong className="text-ink-2">por pagar</strong>, com prazo no mês em que começa: o
          sócio só é avisado, e só fica em atraso, quando esse período chegar.
        </p>
      </form>
    </Dialog>
  );
}

function Linha({
  titulo,
  intervalo,
  meses,
  valor,
}: {
  titulo: string;
  intervalo: string;
  meses: number;
  valor: number;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-meta text-ink-3">{titulo}</span>
        <span className="block truncate text-body text-ink">
          {intervalo} <span className="text-ink-3">· {meses} {meses === 1 ? "mês" : "meses"}</span>
        </span>
      </span>
      <span className="tabular shrink-0 text-body font-semibold text-ink">{money(valor)}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type Extremo = { mes: number; ano: number };

const periodo = (e: Extremo) => `${e.ano}-${String(e.mes).padStart(2, "0")}`;

function mesDe(iso: string): Extremo {
  const d = new Date(iso);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

function somarMeses(e: Extremo, n: number): Extremo {
  const i = e.ano * 12 + (e.mes - 1) + n;
  return { ano: Math.floor(i / 12), mes: (i % 12) + 1 };
}

function distancia(de: Extremo, ate: Extremo): number {
  return ate.ano * 12 + (ate.mes - 1) - (de.ano * 12 + (de.mes - 1)) + 1;
}

/** O último mês **incluído** por uma cobertura que acaba nesta data. */
function mesFinalCoberto(iso: string): Extremo {
  const seguinte = new Date(new Date(iso).getTime() + 86_400_000);
  const mes = seguinte.getUTCMonth(); // 0-based: já é o mês anterior, em base 1
  return mes === 0
    ? { ano: seguinte.getUTCFullYear() - 1, mes: 12 }
    : { ano: seguinte.getUTCFullYear(), mes };
}

/** O último dia coberto por quem cobra até ao fim de `ate`, inclusive. */
function fimDaCobertura(ate: Extremo, dia: number): Date {
  const seguinte = somarMeses(ate, 1);
  const ultimo = new Date(Date.UTC(seguinte.ano, seguinte.mes, 0)).getUTCDate();
  return new Date(Date.UTC(seguinte.ano, seguinte.mes - 1, Math.min(dia, ultimo)) - 86_400_000);
}

function anosPossiveis(de: Extremo, ate: Extremo): number[] {
  const anos: number[] = [];
  for (let a = de.ano; a <= ate.ano; a++) anos.push(a);
  return anos;
}

function dataCurta(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
