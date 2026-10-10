"use client";

import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { MapaDoRecinto } from "@academia/ui/estadio";
import type { Recinto, TipoBilhete } from "@/dados/tipos";
import { euro } from "@/lib/formatar";
import { Botao } from "@/componentes/Botao";

const MAX_POR_TIPO = 10;

/**
 * Onde e quantos. Com recinto, o mapa vem primeiro: toca-se numa bancada e
 * a lista mostra só os bilhetes dela. Sem bancada escolhida a lista mostra
 * todos, agrupados por bancada, e o mapa só acende: o mapa ajuda, mas nunca
 * é o único caminho para comprar.
 *
 * As quantidades guardam-se por tipo, e não por bancada: trocar de bancada
 * no mapa não deita fora o que já se escolheu noutra.
 *
 * O pagamento ainda não está ligado: o botão abre o aviso. Quando a API
 * tiver as encomendas de bilhetes, isto passa a criar a encomenda e a
 * mandar para a euPago, como as mensalidades.
 */
export function EscolherBilhetes({ tipos, recinto }: { tipos: TipoBilhete[]; recinto?: Recinto | null }) {
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [bancada, setBancada] = useState<string | null>(null);
  const [aviso, setAviso] = useState(false);

  const total = tipos.reduce((s, t) => s + (qtd[t.id] ?? 0) * t.price, 0);
  const n = Object.values(qtd).reduce((s, v) => s + v, 0);

  const mudar = (id: string, delta: number) =>
    setQtd((q) => ({ ...q, [id]: Math.max(0, Math.min(MAX_POR_TIPO, (q[id] ?? 0) + delta)) }));

  const comMapa = !!recinto && tipos.some((t) => t.bancadaId);
  const nomeDaBancada = (id?: string) => recinto?.bancadas.find((b) => b.id === id)?.nome;
  const desde = (id: string) => {
    const ps = tipos.filter((t) => t.bancadaId === id).map((t) => t.price);
    return ps.length ? Math.min(...ps) : null;
  };

  // A lista: só a bancada escolhida, ou todas agrupadas pela ordem do mapa.
  const visiveis = bancada ? tipos.filter((t) => t.bancadaId === bancada) : tipos;
  const grupos: { id: string | null; nome: string | null; tipos: TipoBilhete[] }[] = [];
  if (comMapa && !bancada) {
    for (const b of recinto!.bancadas) {
      const ts = tipos.filter((t) => t.bancadaId === b.id);
      if (ts.length) grupos.push({ id: b.id, nome: b.nome, tipos: ts });
    }
    const soltos = tipos.filter((t) => !t.bancadaId || !recinto!.bancadas.some((b) => b.id === t.bancadaId));
    if (soltos.length) grupos.push({ id: null, nome: "Qualquer lugar", tipos: soltos });
  } else {
    grupos.push({ id: bancada, nome: null, tipos: visiveis });
  }

  return (
    <div className="mt-6">
      {comMapa && (
        <div className="mb-6">
          <div className="rounded-card border border-line bg-surface p-2 sm:p-4">
            <MapaDoRecinto
              recinto={recinto!}
              className="mx-auto w-full max-w-2xl"
              titulo={`Mapa de ${recinto!.nome}: escolhe a bancada`}
              selecionada={bancada}
              onEscolher={(id) => setBancada(id === bancada ? null : id)}
              estado={(b) => (tipos.some((t) => t.bancadaId === b.id) ? "ativa" : "inativa")}
              rotulo={(b) => {
                const d = desde(b.id);
                const escolhidos = tipos.filter((t) => t.bancadaId === b.id).reduce((s, t) => s + (qtd[t.id] ?? 0), 0);
                if (escolhidos) return `${escolhidos} ${escolhidos === 1 ? "bilhete" : "bilhetes"}`;
                return d != null ? `desde ${euro(d)}` : "esgotada";
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-ink-3" aria-live="polite">
              {bancada ? (
                <>
                  A ver <strong className="font-semibold text-ink">{nomeDaBancada(bancada)}</strong>
                </>
              ) : (
                "Toca numa bancada para ver os bilhetes dela."
              )}
            </p>
            {bancada && (
              <button type="button" onClick={() => setBancada(null)} className="inline-flex h-11 items-center gap-1 font-semibold text-ink hover:text-signal-ink">
                <X size={16} aria-hidden />
                Ver todas as bancadas
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-5">
        {grupos.map((g) => (
          <div key={g.id ?? "todos"}>
            {g.nome && (
              <button
                type="button"
                onClick={() => g.id && setBancada(g.id)}
                disabled={!g.id}
                className="mb-2 flex h-9 items-center gap-2 text-sm font-bold uppercase tracking-wider text-ink disabled:cursor-default"
              >
                <span className="size-2.5 rounded-full bg-signal" aria-hidden />
                {g.nome}
              </button>
            )}
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {g.tipos.map((t) => {
                const v = qtd[t.id] ?? 0;
                return (
                  <li key={t.id} className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{t.name}</p>
                      {t.description && <p className="text-sm text-ink-3">{t.description}</p>}
                    </div>
                    <p className="display w-16 text-right text-xl tabular text-ink">{euro(t.price)}</p>
                    <div className="flex items-center rounded-control border border-line-strong" role="group" aria-label={`Quantidade de ${t.name}`}>
                      <button
                        type="button"
                        onClick={() => mudar(t.id, -1)}
                        disabled={v === 0}
                        aria-label={`Menos um ${t.name}`}
                        className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30"
                      >
                        <Minus size={16} />
                      </button>
                      <output className="w-8 text-center font-semibold tabular text-ink" aria-live="polite">
                        {v}
                      </output>
                      <button
                        type="button"
                        onClick={() => mudar(t.id, 1)}
                        disabled={v >= MAX_POR_TIPO}
                        aria-label={`Mais um ${t.name}`}
                        className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 flex flex-col gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <p className="text-ink-2" aria-live="polite">
          {n === 0 ? (
            "Escolhe os bilhetes."
          ) : (
            <>
              {n} {n === 1 ? "bilhete" : "bilhetes"} · <span className="display text-2xl tabular text-ink">{euro(total)}</span>
            </>
          )}
        </p>
        <Botao disabled={n === 0} onClick={() => setAviso(true)}>
          Continuar para o pagamento
        </Botao>
      </div>

      {aviso && (
        <p role="status" className="mt-4 rounded-card bg-sunken p-4 text-sm text-ink-2">
          O pagamento online liga-se à plataforma do clube e ainda não está ativo nesta pré-visualização.
        </p>
      )}
    </div>
  );
}
