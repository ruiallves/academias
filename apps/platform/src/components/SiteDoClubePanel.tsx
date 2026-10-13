import { useEffect, useState } from "react";
import { Panel, PanelHead } from "@/components/primitives";
import { apiDelete, apiGet, apiPut } from "@/lib/http";

type EstadoNoVercel =
  | { estado: "sem-token" }
  | { estado: "erro"; mensagem: string }
  | { estado: "ok"; verificado: boolean; configurado: boolean };

type SiteDominio = {
  /** O plano do clube inclui o site (Connect Pro). Sem isso não há menu, nem site, nem domínio. */
  noPlano: boolean;
  plano: string | null;
  dominio: string | null;
  renovaEm: string | null;
  publicado: boolean;
  preVisualizacao: string;
  vercel: EstadoNoVercel | null;
};

/**
 * O site do clube, na ficha dele: se está no ar, onde, e o domínio próprio.
 *
 * ## O que "Ligar" faz
 *
 * Acrescenta o domínio (e o `www`, que redireciona) ao projeto do site no
 * Vercel e grava-o no clube. O registo do domínio e os nameservers são antes
 * disto, no registador: titular o clube, nameservers `ns1/ns2.vercel-dns.com`.
 * Ver `docs/08-site-do-clube.md` e `SiteDominioService` na API.
 *
 * Só `OWNER` e `ADMIN` ligam e desligam; `SUPPORT` vê o estado, que é o que
 * precisa para responder a "o site não abre".
 */
export function SiteDoClubePanel({ academyId, mayEdit }: { academyId: string; mayEdit: boolean }) {
  const [site, setSite] = useState<SiteDominio | null>(null);
  const [dominio, setDominio] = useState("");
  const [renovaEm, setRenovaEm] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const aplicar = (s: SiteDominio) => {
    setSite(s);
    setDominio(s.dominio ?? "");
    setRenovaEm(s.renovaEm ?? "");
  };

  useEffect(() => {
    apiGet<SiteDominio>(`/academies/${academyId}/site-dominio`)
      .then(aplicar)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível ler o site do clube."));
  }, [academyId]);

  async function ligar() {
    setBusy(true);
    setErro(null);
    try {
      aplicar(await apiPut<SiteDominio>(`/academies/${academyId}/site-dominio`, { dominio, renovaEm: renovaEm || null }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ligar o domínio.");
    } finally {
      setBusy(false);
    }
  }

  async function desligar() {
    if (!window.confirm(`Desligar ${site?.dominio}? O site volta a ficar só em ${site?.preVisualizacao.replace("https://", "")}.`)) return;
    setBusy(true);
    setErro(null);
    try {
      aplicar(await apiDelete<SiteDominio>(`/academies/${academyId}/site-dominio`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível desligar o domínio.");
    } finally {
      setBusy(false);
    }
  }

  const v = site?.vercel;
  const estado =
    !site?.dominio || !v
      ? null
      : v.estado === "sem-token"
        ? { tom: "text-warn", texto: "Gravado no clube. Falta o token do Vercel na API: acrescenta o domínio ao projeto à mão." }
        : v.estado === "erro"
          ? { tom: "text-risk", texto: v.mensagem }
          : v.configurado && v.verificado
            ? { tom: "text-ok", texto: "No ar. O DNS aponta para o Vercel e o certificado é emitido sozinho." }
            : { tom: "text-warn", texto: "No projeto do Vercel, à espera do DNS. Confirma os nameservers no registador (ns1/ns2.vercel-dns.com)." };

  return (
    <Panel>
      <PanelHead title="Site do clube" hint={site ? (site.publicado ? "no ar" : "por publicar") : undefined} />
      <div className="space-y-3.5 px-5 py-4">
        {site && !site.noPlano && (
          <p className="rounded-[10px] border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-meta leading-relaxed text-warn">
            O plano {site.plano ? `${site.plano} ` : ""}não inclui o site. Passa o clube para o Connect Pro para ele ver o menu Website e o site ficar no ar.
          </p>
        )}
        {site && (
          <div className="text-meta">
            <span className="text-ink-3">Endereço: </span>
            <a href={site.dominio ? `https://${site.dominio}` : site.preVisualizacao} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline">
              {site.dominio ?? site.preVisualizacao.replace("https://", "")}
            </a>
            {!site.publicado && <span className="text-ink-4"> · o clube ainda não o publicou (menu Website)</span>}
          </div>
        )}

        {estado && <p className={`text-meta ${estado.tom}`}>{estado.texto}</p>}

        {mayEdit && site && (
          <div className="border-t border-line pt-3.5">
            <div className="mb-2 text-meta font-medium text-ink">Domínio próprio</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                aria-label="Domínio do clube"
                placeholder="oclube.pt"
                value={dominio}
                onChange={(e) => setDominio(e.target.value)}
                className="h-8 min-w-[12rem] flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body focus:border-line-strong focus:outline-none"
              />
              <input
                aria-label="Renova em"
                type="date"
                value={renovaEm}
                onChange={(e) => setRenovaEm(e.target.value)}
                className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body focus:border-line-strong focus:outline-none"
              />
              <button type="button" disabled={busy || !dominio.trim()} onClick={() => void ligar()} className="ctl-primary">
                {busy ? "A ligar…" : site.dominio ? "Guardar" : "Ligar"}
              </button>
              {site.dominio && (
                <button type="button" disabled={busy} onClick={() => void desligar()} className="ctl-ghost text-risk">
                  Desligar
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
              Antes de ligar: registar o domínio com o clube como titular e os nameservers em ns1.vercel-dns.com e ns2.vercel-dns.com. A data é a
              da renovação do registo, para nos lembrarmos dela.
            </p>
          </div>
        )}

        {erro && <p className="text-meta text-risk">{erro}</p>}
      </div>
    </Panel>
  );
}
