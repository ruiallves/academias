import { useState } from "react";
import { cx, Empty, Panel, PanelHead } from "./primitives";
import { GraduationCap } from "@/lib/icons";
import { useApi } from "@/lib/query";
import { longDate } from "@/lib/format";
import type { Athlete } from "@/data/types";

/**
 * As notas da escola — o separador "Escola" da ficha do atleta.
 *
 * ## De onde vêm
 *
 * Da família. O encarregado submete-as na app do clube, no ecrã do educando: o
 * período, a disciplina e a nota. O clube **lê** — aqui não há botão de editar,
 * e não é esquecimento: a pauta é da família, e o servidor recusa qualquer
 * outra pessoa (`SchoolGradesService`).
 *
 * ## Uma pauta, e não uma lista
 *
 * A família submete nota a nota, mas a pergunta de quem abre isto é "como vai a
 * escola?" — e essa lê-se como na pauta que a escola entrega: as disciplinas em
 * linhas, os períodos em colunas. Assim vê-se de relance se a Matemática desceu
 * do primeiro para o segundo período, que é a conversa que o treinador quer ter.
 *
 * As negativas ficam a vermelho. É a única cor da tabela, e é a única coisa que
 * um clube procura nela.
 */

type Nota = {
  id: string;
  schoolYear: string;
  period: string;
  subject: string;
  grade: number;
  scale: number;
  submittedByName: string | null;
  updatedAt: string;
};

const PERIODO: Record<string, string> = {
  "1P": "1.º período",
  "2P": "2.º período",
  "3P": "3.º período",
  "1S": "1.º semestre",
  "2S": "2.º semestre",
};
const ORDEM = ["1P", "2P", "3P", "1S", "2S"];

const negativa = (n: Nota) => (n.scale === 5 ? n.grade < 3 : n.grade < 10);
/** A mesma disciplina escrita de duas maneiras é uma linha só. */
const chave = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function SchoolGrades({ athlete }: { athlete: Athlete }) {
  const { data, loading, error } = useApi<{ notas: Nota[] }>(`/api/athletes/${athlete.id}/notas-escolares`);
  const [escolhido, setEscolhido] = useState<string | null>(null);

  const notas = data?.notas ?? [];
  const anos = [...new Set(notas.map((n) => n.schoolYear))].sort().reverse();
  const ano = escolhido && anos.includes(escolhido) ? escolhido : anos[0];
  const doAno = notas.filter((n) => n.schoolYear === ano);

  const periodos = ORDEM.filter((p) => doAno.some((n) => n.period === p));
  const disciplinas = [...new Map(doAno.map((n) => [chave(n.subject), n.subject])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], "pt"),
  );
  const nota = (disciplina: string, periodo: string) =>
    doAno.find((n) => chave(n.subject) === disciplina && n.period === periodo);

  /* A média de um período só faz sentido se as notas forem todas da mesma escala. */
  const media = (periodo: string) => {
    const l = doAno.filter((n) => n.period === periodo);
    if (l.length === 0 || new Set(l.map((n) => n.scale)).size > 1) return null;
    return { valor: l.reduce((s, n) => s + n.grade, 0) / l.length, scale: l[0].scale };
  };

  const negativas = doAno.filter(negativa).length;
  const ultima = doAno.reduce<Nota | null>((u, n) => (!u || n.updatedAt > u.updatedAt ? n : u), null);

  return (
    <Panel>
      <PanelHead
        title="Notas da escola"
        hint={ultima ? `submetidas pela família · última a ${longDate(new Date(ultima.updatedAt))}` : "submetidas pela família"}
      >
        {/* Os anos lectivos, quando há mais do que um. */}
        {anos.length > 1 && (
          <div className="flex items-center gap-1" role="tablist" aria-label="Ano lectivo">
            {anos.map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={a === ano}
                onClick={() => setEscolhido(a)}
                className={cx(
                  "h-7 rounded-full px-2.5 text-meta font-medium tabular transition-colors duration-[120ms]",
                  a === ano ? "bg-ink text-white" : "text-ink-3 hover:bg-sunken hover:text-ink",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </PanelHead>

      {error ? (
        <p className="px-5 py-8 text-center text-meta text-ink-3">{error}</p>
      ) : loading && !data ? null : notas.length === 0 ? (
        <div className="px-5 py-12">
          <Empty
            icon={GraduationCap}
            title="Ainda sem notas"
            detail="É a família que as submete, na app do clube, no ecrã do educando. Quando o fizer, a pauta aparece aqui."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-5 py-3 text-meta text-ink-3">
            <span>
              Ano lectivo <strong className="font-medium tabular text-ink">{ano}</strong>
            </span>
            <span>
              <strong className="font-medium tabular text-ink">{disciplinas.length}</strong>{" "}
              {disciplinas.length === 1 ? "disciplina" : "disciplinas"}
            </span>
            <span className={negativas > 0 ? "text-risk" : undefined}>
              <strong className={cx("font-medium tabular", negativas > 0 ? "text-risk" : "text-ink")}>{negativas}</strong>{" "}
              {negativas === 1 ? "negativa" : "negativas"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 text-left text-meta font-medium text-ink-3">Disciplina</th>
                  {periodos.map((p) => (
                    <th key={p} className="px-4 py-2.5 text-right text-meta font-medium whitespace-nowrap text-ink-3">
                      {PERIODO[p] ?? p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disciplinas.map(([k, nome]) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5 text-ink">{nome}</td>
                    {periodos.map((p) => {
                      const n = nota(k, p);
                      return (
                        <td key={p} className="px-4 py-2.5 text-right tabular">
                          {n ? (
                            <span
                              className={cx("font-semibold", negativa(n) ? "text-risk" : "text-ink")}
                              title={`${n.grade} em ${n.scale}${n.submittedByName ? ` · ${n.submittedByName}` : ""}`}
                            >
                              {n.grade}
                              <span className="ml-0.5 text-[11px] font-normal text-ink-4">/{n.scale}</span>
                            </span>
                          ) : (
                            <span className="text-ink-4">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {disciplinas.length > 1 && (
                <tfoot>
                  <tr className="border-t border-line bg-sunken/40">
                    <td className="px-5 py-2.5 text-meta font-medium text-ink-3">Média</td>
                    {periodos.map((p) => {
                      const m = media(p);
                      return (
                        <td key={p} className="px-4 py-2.5 text-right font-medium tabular text-ink-2">
                          {m ? m.valor.toFixed(1).replace(".", ",") : <span className="text-ink-4">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
