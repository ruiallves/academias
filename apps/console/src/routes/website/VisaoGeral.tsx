import { useState } from "react";
import { ArrowRight, CircleCheck, CircleDashed, ExternalLink, Globe } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { Interruptor } from "@/components/definicoes/ui";
import { useStore } from "@/lib/store";
import { enderecoDoSite, guardarConfig, useSite } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

/**
 * O estado do site numa olhadela: está no ar ou não, as contagens, e a lista
 * do que falta para ficar completo, cada linha a levar à secção onde se
 * resolve.
 */
export function VisaoGeral({ onIr }: { onIr: (secao: string) => void }) {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);
  const [aGravar, setAGravar] = useState(false);

  const publicadas = site.noticias.filter((n) => n.estado === "publicada").length;
  const jogosComBilhetes = Object.values(site.bilheteira).filter((b) => b.aberta).length;
  const endereco = enderecoDoSite(slug, site.dominio);

  const passos = [
    { feito: !!site.identidade.sobre.trim(), texto: "Escrever o texto de apresentação do clube", secao: "identidade" },
    { feito: !!site.identidade.morada.trim(), texto: "Pôr a morada e os contactos", secao: "identidade" },
    { feito: !!site.identidade.legal.nipc, texto: "Pôr o nome legal e o NIPC do clube", secao: "legal" },
    { feito: publicadas > 0, texto: "Publicar a primeira notícia", secao: "noticias" },
    { feito: site.patrocinadores.length > 0, texto: "Juntar os patrocinadores", secao: "patrocinadores" },
  ];
  const feitos = passos.filter((p) => p.feito).length;

  const numeros = [
    { valor: publicadas, rotulo: publicadas === 1 ? "notícia publicada" : "notícias publicadas", secao: "noticias" },
    { valor: site.produtos.filter((p) => p.visivel).length, rotulo: "produtos na loja", secao: "loja" },
    { valor: jogosComBilhetes, rotulo: jogosComBilhetes === 1 ? "jogo com bilhetes" : "jogos com bilhetes", secao: "bilheteira" },
    { valor: site.patrocinadores.length, rotulo: "patrocinadores", secao: "patrocinadores" },
  ];

  const alternarPublicado = async () => {
    setAGravar(true);
    try {
      await guardarConfig({ publicado: !site.publicado }, { imediato: true });
      mostrarOk(site.publicado ? "O site saiu do ar." : "O site está no ar.");
    } finally {
      setAGravar(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Publicar: sem isto, o endereço do site mostra "não ligado". */}
      <div className={cx("flex flex-wrap items-center gap-4 rounded-[12px] border p-4", site.publicado ? "border-ok/30 bg-ok-soft" : "border-line bg-surface")}>
        <Globe className={cx("size-5 shrink-0", site.publicado ? "text-ok" : "text-ink-3")} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-panel text-ink">{site.publicado ? "O site está no ar" : "O site não está no ar"}</p>
          <a href={endereco} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 truncate text-meta text-signal-ink hover:underline">
            {endereco.replace(/^https:\/\//, "")}
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </a>
        </div>
        <Interruptor ligado={site.publicado} disabled={aGravar} onChange={() => void alternarPublicado()} label="Site no ar" />
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {numeros.map((n) => (
          <li key={n.rotulo}>
            <button
              type="button"
              onClick={() => onIr(n.secao)}
              className="w-full rounded-[12px] border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong"
            >
              <span className="block text-metric tabular-nums text-ink">{n.valor}</span>
              <span className="mt-1 block text-meta text-ink-3">{n.rotulo}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-sunken/40 px-4 py-2.5">
          <h3 className="text-panel text-ink">Para o site ficar completo</h3>
          <span className="text-meta tabular-nums text-ink-3">
            {feitos} de {passos.length}
          </span>
        </header>
        <ul>
          {passos.map((p) => (
            <li key={p.texto} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onIr(p.secao)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/40"
              >
                {p.feito ? (
                  <CircleCheck className="size-4 shrink-0 text-ok" strokeWidth={1.75} />
                ) : (
                  <CircleDashed className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />
                )}
                <span className={cx("flex-1 text-body", p.feito ? "text-ink-3 line-through" : "text-ink")}>{p.texto}</span>
                {!p.feito && <ArrowRight className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
