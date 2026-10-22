import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LugarAnual as IconeLugarAnual } from "@/lib/icons";
import { Empty, Loading } from "@/components/primitives";
import { dialogInputClass } from "@/components/Dialog";
import { useStore } from "@/lib/store";
import { listarLugaresAnuais, type LugarAnual } from "@/lib/bilheteira";
import type { Recinto } from "@/lib/website";

/**
 * Os lugares anuais de uma época, todos juntos: quem tem lugar, onde, e
 * quantos há em cada bancada. Contam na lotação de todos os jogos em casa da
 * época (saem dos lugares à venda), por isso o total por bancada vem primeiro.
 *
 * Atribuem-se na ficha de cada sócio; aqui só se consulta.
 */
export function LugaresAnuais({ recintos }: { recintos: Recinto[] }) {
  const store = useStore();
  const epocas = store.seasonList;
  const [seasonId, setSeasonId] = useState(() => (epocas.find((e) => e.isCurrent) ?? epocas[0])?.id ?? "");
  const [lugares, setLugares] = useState<LugarAnual[] | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    let vivo = true;
    setLugares(null);
    listarLugaresAnuais({ seasonId })
      .then((l) => vivo && (setLugares(l), setFalhou(null)))
      .catch((e: unknown) => vivo && setFalhou(e instanceof Error ? e.message : "Não foi possível ler os lugares anuais."));
    return () => {
      vivo = false;
    };
  }, [seasonId]);

  if (!epocas.length) return <Empty icon={IconeLugarAnual} title="O clube ainda não tem épocas" detail="Os lugares anuais são por época." />;

  const recintoDe = (id: string) => recintos.find((r) => r.id === id);
  const bancadaDe = (venueId: string, id: string) => recintoDe(venueId)?.bancadas.find((b) => b.id === id);

  // O total por bancada, pela ordem dos recintos e das bancadas no Estádio.
  const totais = new Map<string, { recinto: string; bancada: string; n: number; lotacao: number | null }>();
  for (const l of lugares ?? []) {
    const k = `${l.venueId}|${l.bancadaId}`;
    const atual = totais.get(k);
    if (atual) atual.n++;
    else
      totais.set(k, {
        recinto: recintoDe(l.venueId)?.nome ?? "Recinto apagado",
        bancada: bancadaDe(l.venueId, l.bancadaId)?.nome ?? "Bancada apagada",
        n: 1,
        lotacao: bancadaDe(l.venueId, l.bancadaId)?.lotacao ?? null,
      });
  }
  const ordenados = [...(lugares ?? [])].sort(
    (a, b) =>
      (recintoDe(a.venueId)?.nome ?? "").localeCompare(recintoDe(b.venueId)?.nome ?? "", "pt") ||
      (bancadaDe(a.venueId, a.bancadaId)?.nome ?? "").localeCompare(bancadaDe(b.venueId, b.bancadaId)?.nome ?? "", "pt") ||
      (a.lugar ?? "").localeCompare(b.lugar ?? "", "pt", { numeric: true }) ||
      a.socio.name.localeCompare(b.socio.name, "pt"),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="lugares-epoca" className="text-meta font-medium text-ink-2">
            Época
          </label>
          <select id="lugares-epoca" className={`${dialogInputClass} w-auto`} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            {epocas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-meta text-ink-3">Atribuem-se na ficha de cada sócio.</p>
      </div>

      {falhou && !lugares ? (
        <Empty icon={IconeLugarAnual} title="Não foi possível ler os lugares anuais" detail={falhou} compact />
      ) : !lugares ? (
        <Loading size="panel" />
      ) : lugares.length === 0 ? (
        <Empty
          icon={IconeLugarAnual}
          title="Nenhum lugar anual nesta época"
          detail="Um sócio com lugar anual entra em todos os jogos em casa da época com o QR do cartão. O lugar desconta da lotação da bancada."
        />
      ) : (
        <>
          <section>
            <h3 className="mb-1.5 text-meta font-medium text-ink-2">Por bancada</h3>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[...totais.values()].map((t) => (
                <li key={`${t.recinto}|${t.bancada}`} className="rounded-[10px] border border-line px-3.5 py-2.5">
                  <p className="truncate text-meta text-ink-3">{t.recinto}</p>
                  <p className="truncate text-body font-medium text-ink">{t.bancada}</p>
                  <p className="text-meta tabular-nums text-ink-2">
                    {t.n} {t.n === 1 ? "lugar anual" : "lugares anuais"}
                    {t.lotacao != null && ` de ${t.lotacao.toLocaleString("pt-PT")}`}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-meta text-ink-3">Estes lugares saem da lotação à venda em todos os jogos em casa da época.</p>
          </section>

          <div className="overflow-x-auto rounded-[10px] border border-line">
            <table className="w-full text-body">
              <thead>
                <tr className="bg-sunken/50 text-meta text-ink-2">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Sócio</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Recinto</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Bancada</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Lugar</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link to={`/socios/${l.socio.id}`} className="font-medium text-ink hover:underline">
                        {l.socio.name}
                      </Link>
                      {l.socio.number != null && <span className="ml-1.5 text-meta tabular-nums text-ink-3">n.º {l.socio.number}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{recintoDe(l.venueId)?.nome ?? "Recinto apagado"}</td>
                    <td className="px-3 py-2 text-ink-2">{bancadaDe(l.venueId, l.bancadaId)?.nome ?? "Bancada apagada"}</td>
                    <td className="px-3 py-2 text-ink-2">{l.lugar ?? <span className="text-ink-4">Sem lugar marcado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
