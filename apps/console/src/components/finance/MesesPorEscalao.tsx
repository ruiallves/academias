import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/components/primitives";

/**
 * Os meses que cada escalão paga: a grelha que se edita no Período de cobrança
 * e o resumo que se lê nas Definições.
 *
 * ## A grelha
 *
 * Uma linha por escalão e uma coluna por mês, pela ordem da época (Setembro a
 * Agosto, como a régua das Definições). Cada quadrado aceso é um mês pago. É a
 * forma de ver de relance o que o clube contou por mensagem ("uns não pagam
 * Agosto, outros não pagam Julho"): a diferença salta à vista numa coluna.
 *
 * Três gestos, do mais fino ao mais largo:
 *  - tocar num quadrado liga ou desliga esse mês nesse escalão;
 *  - arrastar por cima de vários faz o mesmo a todos (com o rato);
 *  - tocar no nome do mês, no cabeçalho, muda-o em todos os escalões.
 *
 * No telemóvel a grelha não cabe: cada escalão passa a um cartão com os doze
 * meses em duas filas, e o primeiro cartão ("Todos os escalões") faz o papel do
 * cabeçalho.
 *
 * Um escalão nunca fica sem meses: o servidor recusa-o, e o último mês aceso
 * não se apaga.
 */

/** A época lê-se de Setembro a Agosto: é a ordem em que o clube pensa nos meses. */
export const ORDEM_DA_EPOCA = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
export const MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MES_EXTENSO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** A linha de quem não tem escalão (e dos escalões criados depois). */
export const SEM_ESCALAO = "__sem-escalao";

export type LinhaDeEscalao = {
  id: string;
  nome: string;
  /** A modalidade, para agrupar quando o clube tem mais de uma. */
  grupo: string;
  meses: number[];
};

function juntar(nomes: string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * Os meses ditos como uma pessoa os diria: "o ano todo", "sem Agosto",
 * "de Setembro a Junho", ou só quantos são.
 */
export function descreverMeses(meses: number[]): string {
  if (meses.length === 12) return "o ano todo";
  const faltam = ORDEM_DA_EPOCA.filter((m) => !meses.includes(m));
  if (faltam.length <= 2) return `sem ${juntar(faltam.map((m) => MES_EXTENSO[m - 1]))}`;
  const posicoes = ORDEM_DA_EPOCA.map((m, i) => (meses.includes(m) ? i : -1)).filter((i) => i >= 0);
  const seguidos = posicoes.every((p, i) => i === 0 || p === posicoes[i - 1] + 1);
  if (seguidos && posicoes.length > 1) {
    return `de ${MES_EXTENSO[ORDEM_DA_EPOCA[posicoes[0]] - 1]} a ${MES_EXTENSO[ORDEM_DA_EPOCA[posicoes[posicoes.length - 1]] - 1]}`;
  }
  return `${meses.length} ${meses.length === 1 ? "mês" : "meses"}`;
}

const contar = (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`;

/* -------------------------------------------------------------------------- */
/* A grelha, para editar                                                       */
/* -------------------------------------------------------------------------- */

export function GrelhaDeMeses({
  linhas,
  semEscalao,
  disabled,
  onChange,
}: {
  linhas: LinhaDeEscalao[];
  /** Os meses de quem não tem escalão. */
  semEscalao: number[];
  disabled?: boolean;
  /** `id` é o do escalão, ou `SEM_ESCALAO`. */
  onChange: (mudancas: { id: string; meses: number[] }[]) => void;
}) {
  const todas = [...linhas, { id: SEM_ESCALAO, nome: "Sem escalão", grupo: "", meses: semEscalao }];
  const grupos = [...new Set(linhas.map((l) => l.grupo))];
  const comGrupos = grupos.length > 1;

  /* O arrasto: o primeiro quadrado decide se se liga ou desliga, os outros seguem. */
  const pintura = useRef<{ ligar: boolean } | null>(null);
  useEffect(() => {
    const fim = () => (pintura.current = null);
    window.addEventListener("pointerup", fim);
    window.addEventListener("pointercancel", fim);
    return () => {
      window.removeEventListener("pointerup", fim);
      window.removeEventListener("pointercancel", fim);
    };
  }, []);

  const meses = (id: string) => todas.find((l) => l.id === id)?.meses ?? [];

  function por(id: string, mes: number, ligar: boolean) {
    const atuais = meses(id);
    if (atuais.includes(mes) === ligar) return;
    const proximo = ligar ? [...atuais, mes].sort((a, b) => a - b) : atuais.filter((m) => m !== mes);
    if (proximo.length === 0) return; // nunca zero meses
    onChange([{ id, meses: proximo }]);
  }

  /** O mês em todos: se todos o pagam, sai de todos (menos de quem ficava sem nenhum); senão entra em todos. */
  function coluna(mes: number) {
    const ligar = !todas.every((l) => l.meses.includes(mes));
    onChange(
      todas
        .map((l) => ({ id: l.id, meses: ligar ? [...new Set([...l.meses, mes])].sort((a, b) => a - b) : l.meses.filter((m) => m !== mes) }))
        .filter((l, i) => l.meses.length > 0 && l.meses.length !== todas[i].meses.length),
    );
  }

  function inicio(e: PointerEvent<HTMLButtonElement>, id: string, mes: number) {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    // O toque prende o ponteiro ao primeiro quadrado; soltá-lo deixa os outros saberem que se passou por eles.
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const ligar = !meses(id).includes(mes);
    pintura.current = { ligar };
    por(id, mes, ligar);
  }

  const estadoDaColuna = (mes: number) => {
    const n = todas.filter((l) => l.meses.includes(mes)).length;
    return n === todas.length ? "todos" : n === 0 ? "nenhum" : "alguns";
  };

  const celula = (l: { id: string; nome: string; meses: number[] }, mes: number, grande?: boolean) => {
    const on = l.meses.includes(mes);
    return (
      <button
        key={mes}
        type="button"
        disabled={disabled}
        aria-pressed={on}
        aria-label={`${l.nome}, ${MES_EXTENSO[mes - 1]}: ${on ? "paga" : "não paga"}`}
        title={`${l.nome} · ${MES_EXTENSO[mes - 1]}`}
        /*
         * No computador liga-se ao carregar, para o arrasto poder seguir. No
         * telemóvel (os cartões) é um toque normal: ligar ao pousar o dedo
         * mudava o mês a quem só queria deslizar a página.
         */
        {...(grande
          ? { onClick: () => por(l.id, mes, !on) }
          : {
              onPointerDown: (e: PointerEvent<HTMLButtonElement>) => inicio(e, l.id, mes),
              onPointerEnter: () => pintura.current && por(l.id, mes, pintura.current.ligar),
              // O teclado (Enter, espaço) chega como clique sem ponteiro.
              onClick: (e: { detail: number }) => e.detail === 0 && por(l.id, mes, !on),
            })}
        className={cx(
          "flex select-none items-center justify-center rounded-[7px] border text-[11px] font-semibold transition-[background-color,border-color,transform] duration-[120ms] disabled:opacity-50",
          grande ? "h-9" : "size-7 [touch-action:none]",
          on
            ? "border-signal-line bg-signal-soft text-signal-ink hover:brightness-[0.97]"
            : "border-dashed border-line-strong bg-surface text-transparent hover:border-ink-4 hover:bg-sunken",
          !disabled && "active:scale-[0.92]",
        )}
      >
        {grande ? MES_CURTO[mes - 1] : <span aria-hidden className={cx("size-1.5 rounded-full", on ? "bg-signal" : "bg-transparent")} />}
      </button>
    );
  };

  return (
    <div>
      {/* ----------------------------------------------- Computador: a grelha */}
      <div className="hidden overflow-hidden rounded-[12px] border border-line sm:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-sunken/50">
              <th scope="col" className="px-3 py-2 text-left text-[11px] font-medium text-ink-3">
                Escalão
              </th>
              {ORDEM_DA_EPOCA.map((m) => {
                const estado = estadoDaColuna(m);
                return (
                  <th key={m} scope="col" className="px-0.5 py-1.5">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => coluna(m)}
                      title={estado === "todos" ? `Tirar ${MES_EXTENSO[m - 1]} a todos os escalões` : `Pôr ${MES_EXTENSO[m - 1]} em todos os escalões`}
                      aria-label={`${MES_EXTENSO[m - 1]} em todos os escalões`}
                      className={cx(
                        "relative mx-auto flex h-7 w-8 items-center justify-center rounded-[7px] text-[11px] font-semibold transition-colors duration-[120ms] hover:bg-surface disabled:opacity-50",
                        estado === "todos" ? "text-ink" : estado === "alguns" ? "text-ink-2" : "text-ink-4",
                      )}
                    >
                      {MES_CURTO[m - 1]}
                      {/* Um mês que só alguns pagam leva um ponto: é a coluna a olhar. */}
                      {estado === "alguns" && <span aria-hidden className="absolute -bottom-0.5 size-1 rounded-full bg-warn" />}
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="w-[70px] px-3 text-right text-[11px] font-medium text-ink-3">
                Meses
              </th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <Grupo key={g} titulo={comGrupos ? g : null}>
                {linhas
                  .filter((l) => l.grupo === g)
                  .map((l) => (
                    <tr key={l.id} className="border-b border-line/70 transition-colors hover:bg-sunken/30">
                      <th scope="row" className="max-w-[170px] truncate px-3 py-1.5 text-left text-body font-medium text-ink">
                        {l.nome}
                      </th>
                      {ORDEM_DA_EPOCA.map((m) => (
                        <td key={m} className="px-0.5 py-1.5">
                          <div className="flex justify-center">{celula(l, m)}</div>
                        </td>
                      ))}
                      <td className="px-3 text-right text-meta tabular text-ink-3">{l.meses.length}</td>
                    </tr>
                  ))}
              </Grupo>
            ))}
            {/* Quem não tem escalão: em último, apagado, com a explicação ao lado. */}
            <tr className="bg-sunken/40">
              <th scope="row" className="px-3 py-2 text-left">
                <span className="block text-meta font-medium text-ink-2">Sem escalão</span>
                <span className="block text-[11px] leading-snug text-ink-4">e escalões novos</span>
              </th>
              {ORDEM_DA_EPOCA.map((m) => (
                <td key={m} className="px-0.5 py-1.5">
                  <div className="flex justify-center">{celula({ id: SEM_ESCALAO, nome: "Sem escalão", meses: semEscalao }, m)}</div>
                </td>
              ))}
              <td className="px-3 text-right text-meta tabular text-ink-3">{semEscalao.length}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ----------------------------------------------- Telemóvel: cartões */}
      <ul className="space-y-2 sm:hidden">
        <li className="rounded-[12px] border border-dashed border-line-strong px-3 py-2.5">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-meta font-medium text-ink">Todos os escalões</span>
            <span className="text-[11px] text-ink-4">muda o mês em todos</span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {ORDEM_DA_EPOCA.map((m) => {
              const estado = estadoDaColuna(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => coluna(m)}
                  aria-label={`${MES_EXTENSO[m - 1]} em todos os escalões`}
                  className={cx(
                    "relative h-9 rounded-[7px] border text-[11px] font-semibold disabled:opacity-50",
                    estado === "todos" ? "border-ink/20 bg-ink/[0.06] text-ink" : estado === "alguns" ? "border-line bg-surface text-ink-2" : "border-dashed border-line-strong text-ink-4",
                  )}
                >
                  {MES_CURTO[m - 1]}
                  {estado === "alguns" && <span aria-hidden className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-warn" />}
                </button>
              );
            })}
          </div>
        </li>
        {[...linhas, { id: SEM_ESCALAO, nome: "Sem escalão e escalões novos", grupo: "", meses: semEscalao }].map((l) => (
          <li key={l.id} className={cx("rounded-[12px] border border-line px-3 py-2.5", l.id === SEM_ESCALAO && "bg-sunken/40")}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className={cx("truncate text-meta font-medium", l.id === SEM_ESCALAO ? "text-ink-2" : "text-ink")}>
                {l.nome}
                {comGrupos && l.grupo && <span className="font-normal text-ink-4"> · {l.grupo}</span>}
              </span>
              <span className="shrink-0 text-[11px] tabular text-ink-4">{contar(l.meses.length)}</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">{ORDEM_DA_EPOCA.map((m) => celula(l, m, true))}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string | null; children: ReactNode }) {
  return (
    <>
      {titulo && (
        <tr className="border-b border-line/70">
          <th colSpan={14} scope="colgroup" className="px-3 pb-1 pt-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-4">
            {titulo}
          </th>
        </tr>
      )}
      {children}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* O resumo, para ler                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Os escalões juntos pelos meses que pagam.
 *
 * Quinze escalões numa grelha de leitura é uma parede de quadrados. O que a
 * direção quer saber nas Definições é "quantos calendários temos, e quem segue
 * cada um": um cartão por conjunto de meses, com a régua e os escalões ao lado.
 * O conjunto que mais escalões seguem vem primeiro.
 */
export function ResumoPorEscalao({ linhas, semEscalao }: { linhas: LinhaDeEscalao[]; semEscalao: number[] }) {
  const chave = (m: number[]) => [...m].sort((a, b) => a - b).join(",");
  const conjuntos = new Map<string, { meses: number[]; nomes: string[]; semEscalao: boolean }>();
  for (const l of linhas) {
    const k = chave(l.meses);
    const c = conjuntos.get(k) ?? { meses: l.meses, nomes: [], semEscalao: false };
    c.nomes.push(l.nome);
    conjuntos.set(k, c);
  }
  const k = chave(semEscalao);
  conjuntos.set(k, { ...(conjuntos.get(k) ?? { meses: semEscalao, nomes: [] }), semEscalao: true });
  const lista = [...conjuntos.values()].sort((a, b) => b.nomes.length - a.nomes.length);

  return (
    <ul className="mt-4 space-y-2.5">
      {lista.map((c) => (
        <li key={chave(c.meses)} className="rounded-[12px] border border-line px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-body font-medium text-ink first-letter:uppercase">{descreverMeses(c.meses)}</span>
            <span className="text-meta tabular text-ink-3">{contar(c.meses.length)}</span>
          </div>
          <ol className="mt-2.5 grid grid-cols-12 gap-1">
            {ORDEM_DA_EPOCA.map((m) => {
              const on = c.meses.includes(m);
              return (
                <li
                  key={m}
                  title={`${MES_EXTENSO[m - 1]}: ${on ? "paga" : "não paga"}`}
                  className={cx(
                    "flex h-6 items-center justify-center rounded-[6px] text-[10.5px]",
                    on ? "bg-signal-soft font-semibold text-signal-ink" : "border border-dashed border-line-strong text-ink-4 line-through",
                  )}
                >
                  <span className="max-sm:hidden">{MES_CURTO[m - 1]}</span>
                  <span className="sm:hidden">{MES_CURTO[m - 1][0]}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {c.nomes.map((n) => (
              <span key={n} className="rounded-full bg-sunken px-2.5 py-0.5 text-meta text-ink-2">
                {n}
              </span>
            ))}
            {c.semEscalao && (
              <span className="rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-meta text-ink-3">
                Sem escalão e escalões novos
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
