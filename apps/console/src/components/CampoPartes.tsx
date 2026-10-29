import { DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";
import { problemaNasPartes } from "@/lib/sports";

/** O máximo de partes (o mesmo CHECK da base em `Team.matchParts`). */
export const MAXIMO_DE_PARTES = 8;

/** O máximo de minutos de uma parte (o mesmo CHECK da base em `Team.matchPartMinutes`). */
export const MAXIMO_DA_PARTE = 120;

/**
 * As partes escritas no campo "Partes do jogo", ou `null` se o que está
 * escrito não serve. Vazio é "as da modalidade" (`porOmissao`). Ver
 * `Team.matchParts`.
 */
export function lerPartes(texto: string, porOmissao: number): number | null {
  if (texto === "") return porOmissao;
  const n = Number(texto);
  return Number.isInteger(n) && n >= 1 && n <= MAXIMO_DE_PARTES ? n : null;
}

/**
 * Os minutos de cada parte escritos um a um, ou `null` se falta algum ou algum
 * não serve (de 1 a 120). Ver `Team.matchPartMinutes`.
 */
export function lerMinutosDasPartes(valores: string[]): number[] | null {
  const lista = valores.map(Number);
  return valores.every((v) => v !== "") && lista.every((m) => Number.isInteger(m) && m >= 1 && m <= MAXIMO_DA_PARTE) ? lista : null;
}

/**
 * Por onde começa quem liga "Ajustar os minutos de cada parte": a duração
 * repartida, com o que sobra na última (70 em 3 dá 23 + 23 + 24). Sem duração,
 * em branco.
 */
export function repartir(duracao: number | null, partes: number): string[] {
  if (!duracao) return Array.from({ length: partes }, () => "");
  const base = Math.floor(duracao / partes);
  return Array.from({ length: partes }, (_, i) => String(i === partes - 1 ? duracao - base * (partes - 1) : base));
}

/** As partes que a equipa tem gravadas com minutos diferentes, em texto; vazio se são iguais. */
export function minutosGravados(minutos: number[] | undefined, partes: number): string[] {
  return minutos?.length === partes ? minutos.map(String) : [];
}

/**
 * A linha por baixo da duração e das partes, no criar e no editar equipa:
 * "3 partes de 20 minutos", "15 + 15 + 40 = 70 minutos", ou porque é que não dá.
 *
 * Com partes iguais, a duração tem de se dividir nelas (60 em 3 dá 20): o
 * relógio do "Ao vivo" e as contas de minutos partem o jogo assim. Com os
 * minutos de cada parte, a duração é a soma. Com `erro`, o diálogo não grava.
 */
export function notaDasPartes(
  partes: number | null,
  duracao: number | null,
  nomeDaParte: "parte" | "período" = "parte",
  porParte: { ligado: boolean; minutos: number[] | null } = { ligado: false, minutos: null },
): { texto: string; erro: boolean } | null {
  const plural = nomeDaParte === "parte" ? "partes" : "períodos";
  if (partes === null) return { texto: `As ${plural} vão de 1 a ${MAXIMO_DE_PARTES}.`, erro: true };
  if (porParte.ligado) {
    if (!porParte.minutos) return { texto: `Escreve os minutos de cada ${nomeDaParte}, de 1 a ${MAXIMO_DA_PARTE}.`, erro: true };
    return { texto: `${porParte.minutos.join(" + ")} = ${porParte.minutos.reduce((n, m) => n + m, 0)} minutos.`, erro: false };
  }
  const problema = problemaNasPartes(duracao, partes);
  if (problema) return { texto: `${problema} Muda a duração ou as ${plural}, ou ajusta os minutos de cada uma.`, erro: true };
  if (!duracao) return null;
  return { texto: `${partes} ${partes === 1 ? nomeDaParte : plural} de ${duracao / partes} minutos.`, erro: false };
}

/**
 * "Ajustar os minutos de cada parte": desligado, as partes são iguais; ligado,
 * aparece um campo por parte (15, 15, 40) e a duração passa a ser a soma.
 *
 * O caso que o pediu: os infantis de futebol de 2026/27 jogam 15 + 15 + 40, os
 * benjamins 15 + 15 + 35 e os traquinas 15 + 15 + 30.
 */
export function MinutosPorParte({
  partes,
  nomeDaParte,
  ligado,
  onLigar,
  valores,
  onValores,
}: {
  partes: number;
  nomeDaParte: "parte" | "período";
  ligado: boolean;
  onLigar: (ligado: boolean) => void;
  valores: string[];
  onValores: (valores: string[]) => void;
}) {
  const ordinal = nomeDaParte === "parte" ? "ª" : "º";
  const visiveis = Array.from({ length: partes }, (_, i) => valores[i] ?? "");
  return (
    <div className="-mt-1 space-y-2">
      <label className="flex w-fit cursor-pointer items-center gap-2 py-0.5 text-meta text-ink">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(e) => onLigar(e.target.checked)}
          className="size-3.5 shrink-0 accent-[var(--color-signal)]"
        />
        Ajustar os minutos de cada {nomeDaParte}
      </label>
      {ligado && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(partes, 4)}, minmax(0, 1fr))` }}>
          {visiveis.map((v, i) => {
            const n = Number(v);
            const mau = v !== "" && !(n >= 1 && n <= MAXIMO_DA_PARTE);
            return (
              <DialogField key={i} label={`${i + 1}.${ordinal} ${nomeDaParte}`} hint="min">
                <input
                  value={v}
                  onChange={(e) => {
                    const novo = [...visiveis];
                    novo[i] = e.target.value.replace(/\D/g, "").slice(0, 3);
                    onValores(novo);
                  }}
                  inputMode="numeric"
                  className={cx(dialogInputClass, mau && "border-risk")}
                />
              </DialogField>
            );
          })}
        </div>
      )}
    </div>
  );
}
