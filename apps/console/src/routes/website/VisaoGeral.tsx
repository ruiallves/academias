import { ArrowRight, CircleCheck, CircleDashed, Sparkle } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { useStore } from "@/lib/store";
import { comExemplos, gravarSite, useSite } from "@/lib/website";
import { mostrarOk } from "@/lib/avisos";

/**
 * O estado do site numa olhadela: contagens, e a lista do que falta para
 * ficar completo, cada linha a levar à secção onde se resolve.
 */
export function VisaoGeral({ onIr }: { onIr: (secao: string) => void }) {
  const store = useStore();
  const slug = store.academy.slug;
  const site = useSite(slug);

  const publicadas = site.noticias.filter((n) => n.estado === "publicada").length;
  const jogosComBilhetes = Object.values(site.bilheteira).filter((b) => b.aberta).length;

  const passos = [
    { feito: !!site.identidade.sobre.trim(), texto: "Escrever o texto de apresentação do clube", secao: "identidade" },
    { feito: !!site.identidade.morada.trim(), texto: "Pôr a morada e os contactos", secao: "identidade" },
    { feito: publicadas > 0, texto: "Publicar a primeira notícia", secao: "noticias" },
    { feito: site.patrocinadores.length > 0, texto: "Juntar os patrocinadores", secao: "patrocinadores" },
    { feito: !!site.dominio.trim(), texto: "Indicar o domínio do clube", secao: "dominio" },
  ];
  const feitos = passos.filter((p) => p.feito).length;

  const numeros = [
    { valor: publicadas, rotulo: publicadas === 1 ? "notícia publicada" : "notícias publicadas", secao: "noticias" },
    { valor: site.produtos.filter((p) => p.visivel).length, rotulo: "produtos na loja", secao: "loja" },
    { valor: jogosComBilhetes, rotulo: jogosComBilhetes === 1 ? "jogo com bilhetes" : "jogos com bilhetes", secao: "bilheteira" },
    { valor: site.patrocinadores.length, rotulo: "patrocinadores", secao: "patrocinadores" },
  ];

  return (
    <div className="space-y-6">
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-dashed border-line-strong px-4 py-3">
        <p className="text-meta text-ink-3">Para experimentar: acrescenta notícias, produtos e patrocinadores de exemplo. O que já escreveste fica.</p>
        <button
          type="button"
          className="ctl-outline"
          onClick={() => {
            gravarSite(slug, (s) => comExemplos(s, store.academy.shortName));
            mostrarOk("Exemplos acrescentados.");
          }}
        >
          <Sparkle className="size-4" strokeWidth={1.75} />
          Acrescentar exemplos
        </button>
      </div>
    </div>
  );
}
