import { eurosExact } from "@/lib/format";
import { cx } from "@/components/primitives";
import { PAY_MODEL_LABEL, recebeComissao, recebeHoras, type Compensation, type SalesPayModel } from "@/lib/types";
import { Field, INPUT } from "./ui";

/**
 * Como recebe um comercial: a forma de pagar, os valores e a meta da semana.
 *
 * Os mesmos campos no convite (Administradores → Convidar, papel Comercial) e
 * em Mês → Condições, para a pessoa entrar já com o que se combinou e não haver
 * dois sítios a dizer coisas diferentes. Os valores andam em texto enquanto se
 * escrevem (aceita "7" ou "7,50"); `lerCondicoes` passa-os a cêntimos.
 */

export type CondicoesTexto = {
  payModel: SalesPayModel;
  hora: string;
  porComissao: string;
  comissao: string;
  meta: string;
};

export const CONDICOES_INICIAIS: CondicoesTexto = {
  payModel: "HOURLY",
  hora: "7",
  porComissao: "10",
  comissao: "0",
  meta: "5",
};

export function condicoesParaTexto(c: Compensation): CondicoesTexto {
  return {
    payModel: c.payModel,
    hora: centimosParaTexto(c.hourlyCents),
    porComissao: String(c.meetingsPerCommission),
    comissao: centimosParaTexto(c.commissionCents),
    meta: String(c.weeklyGoal),
  };
}

/**
 * Os valores prontos a enviar, ou `null` se algum dos que a forma usa não se lê.
 * Os da parte que a forma não usa vão como estavam: trocar de forma e voltar
 * não perde o que se tinha escrito.
 */
export function lerCondicoes(t: CondicoesTexto, antes: Compensation | null): Compensation | null {
  const hora = textoParaCentimos(t.hora);
  const comissao = textoParaCentimos(t.comissao);
  const n = Number(t.porComissao);
  const meta = Number(t.meta);
  const nValido = Number.isInteger(n) && n >= 1 && n <= 100;
  const metaValida = Number.isInteger(meta) && meta >= 1 && meta <= 100;
  if (!metaValida) return null;
  if (recebeHoras(t.payModel) && hora === null) return null;
  if (recebeComissao(t.payModel) && (comissao === null || !nValido)) return null;
  return {
    payModel: t.payModel,
    hourlyCents: hora ?? antes?.hourlyCents ?? 700,
    meetingsPerCommission: nValido ? n : (antes?.meetingsPerCommission ?? 10),
    commissionCents: comissao ?? antes?.commissionCents ?? 0,
    weeklyGoal: meta,
  };
}

const FORMAS: SalesPayModel[] = ["HOURLY", "SALARY", "COMMISSION"];

export function CondicoesCampos({
  valor,
  onChange,
  nome,
}: {
  valor: CondicoesTexto;
  onChange: (v: CondicoesTexto) => void;
  /** O primeiro nome da pessoa, para a frase de resumo. */
  nome: string;
}) {
  const set = (k: keyof CondicoesTexto) => (v: string) => onChange({ ...valor, [k]: v });
  const horas = recebeHoras(valor.payModel);
  const comissao = recebeComissao(valor.payModel);
  const lido = lerCondicoes(valor, null);
  const quem = nome || "A pessoa";

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Como recebe">
        <p className="mb-1.5 text-meta font-medium text-ink">Como recebe</p>
        <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-line bg-canvas p-1">
          {FORMAS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange({ ...valor, payModel: id })}
              aria-pressed={valor.payModel === id}
              className={cx(
                "min-h-8 cursor-pointer rounded-[calc(var(--radius-control)-2px)] px-1 text-meta font-medium leading-tight transition-colors duration-150",
                valor.payModel === id ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {PAY_MODEL_LABEL[id]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {horas && (
          <Field label="Salário por hora" hint="€">
            <input className={INPUT} inputMode="decimal" value={valor.hora} onChange={(e) => set("hora")(e.target.value)} />
          </Field>
        )}
        <Field label="Meta semanal" hint="reuniões">
          <input className={INPUT} inputMode="numeric" value={valor.meta} onChange={(e) => set("meta")(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </Field>
        {comissao && (
          <>
            <Field label="Reuniões por comissão">
              <input
                className={INPUT}
                inputMode="numeric"
                value={valor.porComissao}
                onChange={(e) => set("porComissao")(e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            </Field>
            <Field label="Valor da comissão" hint="€">
              <input className={INPUT} inputMode="decimal" value={valor.comissao} onChange={(e) => set("comissao")(e.target.value)} />
            </Field>
          </>
        )}
      </div>

      <p className="text-meta leading-relaxed text-ink-3">
        {!lido
          ? "Escreve os valores em euros (ex.: 7 ou 7,50), e as reuniões como um número entre 1 e 100."
          : [
              horas ? `${quem} marca turnos no painel e recebe ${eurosExact(lido.hourlyCents)} por hora.` : `${quem} não marca turnos.`,
              comissao
                ? `A cada ${lido.meetingsPerCommission} reuniões marcadas ganha ${eurosExact(lido.commissionCents)}; o que sobra de um mês passa para o seguinte, e uma reunião cancelada deixa de contar.`
                : "As reuniões não dão comissão.",
              `A meta é de ${lido.weeklyGoal} ${lido.weeklyGoal === 1 ? "reunião" : "reuniões"} por semana, e o contador do "Hoje" sobe a cada reunião marcada.`,
            ].join(" ")}
      </p>
    </div>
  );
}

function centimosParaTexto(c: number): string {
  return (c / 100).toLocaleString("pt-PT", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

function textoParaCentimos(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
