import { useState } from "react";
import { Panel, PanelHead } from "@/components/primitives";
import { apiPatch } from "@/lib/http";
import { tamanho } from "@/lib/format";
import type { EspacoDoClube } from "@/lib/types";

/**
 * O espaço de ficheiros de um clube, na ficha dele: o que usa, em quê, e o limite.
 *
 * ## Porque é que se muda aqui
 *
 * O limite por omissão é 5 GB, como dizem os Termos de Serviço. Aumentá-lo é uma
 * decisão comercial, normalmente com a mensalidade, e por isso só `OWNER` e
 * `ADMIN` o mudam, como o plano. Quem dá apoio (`SUPPORT`) vê os números para
 * saber porque é que um clube não consegue carregar fotografias.
 *
 * Os atalhos (5, 10, 20, 50 GB) são os valores que se usam; o campo livre fica
 * para o caso que não caiba neles. Baixar abaixo do que o clube usa não apaga
 * nada: o clube só deixa de carregar ficheiros novos.
 */
export function EspacoDoClubePanel({
  academyId,
  espaco: inicial,
  mayEdit,
}: {
  academyId: string;
  espaco: EspacoDoClube;
  mayEdit: boolean;
}) {
  const [espaco, setEspaco] = useState(inicial);
  const limiteGb = espaco.limitBytes / (1024 * 1024 * 1024);
  const [valor, setValor] = useState(String(limiteGb));
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);

  const fracao = espaco.limitBytes > 0 ? espaco.usedBytes / espaco.limitBytes : 0;
  const cor = fracao >= 1 ? "var(--color-risk)" : fracao >= 0.8 ? "var(--color-warn)" : "var(--color-ink-3)";

  async function guardar(gb: number) {
    if (!Number.isFinite(gb) || gb < 1 || gb > 1024) {
      setErro("Escreve um valor entre 1 e 1024 GB.");
      return;
    }
    setBusy(true);
    setErro(null);
    setGravado(false);
    try {
      const novo = await apiPatch<EspacoDoClube>(`/academies/${academyId}/espaco`, { limitMb: Math.round(gb * 1024) });
      setEspaco(novo);
      setValor(String(novo.limitBytes / (1024 * 1024 * 1024)));
      setGravado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="Espaço de ficheiros" hint={`${Math.min(100, Math.round(fracao * 100))}% do limite`} />
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-body font-medium text-ink tabular">
            {tamanho(espaco.usedBytes)} <span className="font-normal text-ink-3">de {tamanho(espaco.limitBytes)}</span>
          </span>
          {fracao >= 1 && <span className="text-meta text-risk">no limite: não carrega ficheiros novos</span>}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, fracao * 100)}%`, background: cor }} />
        </div>

        {espaco.categorias.length > 0 ? (
          <ul className="mt-3.5 space-y-1.5">
            {espaco.categorias.map((c) => (
              <li key={c.key} className="flex items-baseline justify-between gap-3 text-meta">
                <span className="text-ink-2">
                  {c.label} <span className="text-ink-4">· {c.ficheiros} ficheiros</span>
                </span>
                <span className="text-ink-3 tabular">{tamanho(c.bytes)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-meta text-ink-3">Ainda não carregou ficheiros.</p>
        )}

        {mayEdit && (
          <div className="mt-4 border-t border-line pt-3.5">
            <div className="mb-2 text-meta font-medium text-ink">Limite</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {[5, 10, 20, 50].map((gb) => (
                <button
                  key={gb}
                  type="button"
                  disabled={busy}
                  onClick={() => void guardar(gb)}
                  className={limiteGb === gb ? "ctl-primary" : "ctl-outline"}
                >
                  {gb} GB
                </button>
              ))}
              <span className="ml-1 inline-flex items-center gap-1.5">
                <input
                  aria-label="Limite em GB"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value.replace(",", "."))}
                  onKeyDown={(e) => e.key === "Enter" && void guardar(Number(valor))}
                  className="h-8 w-20 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-right text-body tabular focus:border-line-strong focus:outline-none"
                />
                <span className="text-meta text-ink-3">GB</span>
                <button type="button" disabled={busy} onClick={() => void guardar(Number(valor))} className="ctl-ghost">
                  {busy ? "A guardar…" : "Guardar"}
                </button>
              </span>
            </div>
            {erro && <p className="mt-2 text-meta text-risk">{erro}</p>}
            {gravado && !erro && <p className="mt-2 text-meta text-ok">Limite guardado. Fica no registo de auditoria.</p>}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
              5 GB é o que os Termos de Serviço prometem. Aumentar é normalmente acompanhado de uma mensalidade maior.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
