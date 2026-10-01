import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/primitives";
import { Check, ExternalLink, Plus, Trash2 } from "@/lib/icons";
import type { MatchReport, VideoLink } from "@/lib/matches";
import { Cartao, CartaoTopo, Vazio } from "./ui";

/**
 * A análise do jogo: o que o treinador escreve depois do apito.
 *
 * ## Perguntas, e não uma folha em branco
 *
 * Um campo "Relatório" vazio adia-se. Perguntas curtas respondem-se: como
 * correu, o que correu bem, o que correu mal, o que se vai trabalhar. Nenhuma é
 * obrigatória, e uma análise com uma linha só vale mais do que nenhuma.
 *
 * ## O desenho
 *
 * A leitura geral vem primeiro e maior, porque é o que se lê quando se volta
 * ao jogo meses depois. O que correu bem e o que correu mal ficam lado a lado,
 * com a cor a dizer qual é qual; por baixo, o que se leva para o treino e o que
 * custou. Os vídeos são ligações: o vídeo vive no YouTube, no Veo ou no Drive.
 *
 * Grava-se inteira de cada vez, como a ficha.
 */

type Textos = Pick<MatchReport, "summary" | "positives" | "negatives" | "toImprove" | "difficulties">;
const VAZIO: Textos = { summary: null, positives: null, negatives: null, toImprove: null, difficulties: null };

const BLOCOS: { campo: keyof Textos; titulo: string; dica: string; cor: string }[] = [
  { campo: "positives", titulo: "O que correu bem", dica: "O que se fez bem e vale a pena repetir.", cor: "var(--color-ok)" },
  { campo: "negatives", titulo: "O que correu mal", dica: "O que falhou, sem rodeios.", cor: "var(--color-risk)" },
  { campo: "toImprove", titulo: "A trabalhar no treino", dica: "O que se leva deste jogo para a semana.", cor: "var(--color-warn)" },
  { campo: "difficulties", titulo: "Dificuldades", dica: "O que custou: o campo, o calor, a falta de banco, a arbitragem.", cor: "var(--color-ink-4)" },
];

export type CorpoDaAnalise = Textos & { videos: { url: string; label?: string | null }[] };

export function Analise({
  relatorio,
  podeEditar,
  contexto,
  onGuardar,
}: {
  relatorio: MatchReport | null;
  podeEditar: boolean;
  /** O resultado, para a análise se ler com ele à vista. */
  contexto?: ReactNode;
  onGuardar: (corpo: CorpoDaAnalise) => Promise<void>;
}) {
  const deRelatorio = (): Textos =>
    relatorio ? { summary: relatorio.summary, positives: relatorio.positives, negatives: relatorio.negatives, toImprove: relatorio.toImprove, difficulties: relatorio.difficulties } : VAZIO;
  const [texto, setTexto] = useState<Textos>(deRelatorio);
  const [videos, setVideos] = useState<VideoLink[]>(() => relatorio?.videos ?? []);
  const [aGuardar, setAGuardar] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setTexto(deRelatorio());
    setVideos(relatorio?.videos ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatorio?.updatedAt]);

  const limpo = (v: string | null) => (v ?? "").trim();
  const videosLimpos = videos.filter((v) => v.url.trim()).map((v) => ({ url: v.url.trim(), label: limpo(v.label) || null }));
  const mudou =
    (Object.keys(VAZIO) as (keyof Textos)[]).some((k) => limpo(texto[k]) !== limpo(relatorio?.[k] ?? null)) ||
    JSON.stringify(videosLimpos) !== JSON.stringify((relatorio?.videos ?? []).map((v) => ({ url: v.url, label: v.label ?? null })));
  const temAlgo = (Object.keys(VAZIO) as (keyof Textos)[]).some((k) => limpo(texto[k])) || videosLimpos.length > 0;

  const set = (campo: keyof Textos, valor: string) => {
    setTexto((t) => ({ ...t, [campo]: valor }));
    setGuardado(false);
  };

  async function guardar() {
    if (aGuardar) return;
    setAGuardar(true);
    setErro(null);
    try {
      await onGuardar({ ...texto, videos: videosLimpos });
      setGuardado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar a análise.");
    } finally {
      setAGuardar(false);
    }
  }

  const area = "w-full resize-y rounded-[14px] border border-transparent bg-sunken/60 px-3.5 py-3 text-body leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-line-strong focus:bg-surface";

  /* ---- só leitura ---- */
  if (!podeEditar) {
    if (!relatorio) {
      return (
        <Cartao>
          <Vazio titulo="Ainda sem análise" texto="Quando o treinador escrever a análise deste jogo, aparece aqui." />
        </Cartao>
      );
    }
    return (
      <div className="space-y-4">
        <Cartao>
          <CartaoTopo titulo="Como correu" apoio={assinatura(relatorio)}>
            {contexto}
          </CartaoTopo>
          <p className="px-5 pb-5 text-[15px] leading-relaxed whitespace-pre-line text-ink">{relatorio.summary || "Sem leitura geral."}</p>
        </Cartao>
        <div className="grid gap-4 md:grid-cols-2">
          {BLOCOS.filter((b) => limpo(relatorio[b.campo])).map((b) => (
            <Cartao key={b.campo}>
              <Titulo cor={b.cor}>{b.titulo}</Titulo>
              <p className="px-5 pb-5 text-body leading-relaxed whitespace-pre-line text-ink">{relatorio[b.campo]}</p>
            </Cartao>
          ))}
        </div>
        {relatorio.videos.length > 0 && (
          <Cartao>
            <CartaoTopo titulo="Vídeos" />
            <ul className="space-y-1.5 px-5 pb-5">
              {relatorio.videos.map((v) => (
                <li key={v.url}>
                  <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-body font-medium text-ink underline-offset-2 hover:underline">
                    {v.label || v.url}
                    <ExternalLink className="size-3.5 text-ink-4" strokeWidth={1.75} />
                  </a>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </div>
    );
  }

  /* ---- a escrever ---- */
  return (
    <div className="space-y-4">
      <Cartao>
        <CartaoTopo titulo="Como correu" apoio={relatorio ? assinatura(relatorio) : "A leitura geral do jogo, em duas ou três frases."}>
          {contexto}
        </CartaoTopo>
        <div className="px-5 pb-5">
          <textarea
            value={texto.summary ?? ""}
            onChange={(e) => set("summary", e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Entrámos bem, com bola. Depois do golo recuámos demasiado e sofremos na segunda parte."
            aria-label="Como correu o jogo"
            className={cx(area, "text-[15px]")}
          />
        </div>
      </Cartao>

      <div className="grid gap-4 md:grid-cols-2">
        {BLOCOS.map((b) => (
          <Cartao key={b.campo}>
            <Titulo cor={b.cor}>{b.titulo}</Titulo>
            <div className="px-5 pb-5">
              <textarea value={texto[b.campo] ?? ""} onChange={(e) => set(b.campo, e.target.value)} rows={4} maxLength={4000} placeholder={b.dica} aria-label={b.titulo} className={area} />
            </div>
          </Cartao>
        ))}
      </div>

      <Cartao>
        <CartaoTopo titulo="Vídeos" apoio="Ligações para o jogo ou para cortes: YouTube, Veo, Drive.">
          {videos.length < 10 && (
            <button
              type="button"
              className="ctl-outline h-9"
              onClick={() => {
                setVideos([...videos, { url: "", label: null }]);
                setGuardado(false);
              }}
            >
              <Plus className="size-3.5" strokeWidth={2} />
              Juntar vídeo
            </button>
          )}
        </CartaoTopo>
        {videos.length === 0 ? (
          <p className="px-5 pb-5 text-meta text-ink-3">Sem vídeos. Junta a ligação da gravação do jogo, se a houver.</p>
        ) : (
          <ul className="space-y-2 px-5 pb-5">
            {videos.map((v, i) => (
              <li key={i} className="mc-entra flex flex-wrap items-center gap-2 rounded-[14px] bg-sunken/60 p-2">
                <input
                  value={v.label ?? ""}
                  onChange={(e) => {
                    setVideos(videos.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)));
                    setGuardado(false);
                  }}
                  maxLength={80}
                  placeholder="1.ª parte"
                  aria-label={`Nome do vídeo ${i + 1}`}
                  className="h-9 w-[150px] rounded-[10px] border border-line bg-surface px-3 text-body text-ink outline-none placeholder:text-ink-4 focus:border-ink-3"
                />
                <input
                  value={v.url}
                  onChange={(e) => {
                    setVideos(videos.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)));
                    setGuardado(false);
                  }}
                  maxLength={600}
                  inputMode="url"
                  placeholder="https://…"
                  aria-label={`Ligação do vídeo ${i + 1}`}
                  className={cx(
                    "h-9 min-w-[200px] flex-1 rounded-[10px] border bg-surface px-3 text-body text-ink outline-none placeholder:text-ink-4 focus:border-ink-3",
                    v.url.trim() && !/^https?:\/\/\S+$/i.test(v.url.trim()) ? "border-risk" : "border-line",
                  )}
                />
                <button
                  type="button"
                  aria-label={`Tirar o vídeo ${i + 1}`}
                  onClick={() => {
                    setVideos(videos.filter((_, j) => j !== i));
                    setGuardado(false);
                  }}
                  className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-4 transition-colors hover:bg-surface hover:text-risk"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <div className="sticky bottom-3 z-10 max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface/95 px-4 py-2.5 shadow-[0_10px_30px_-14px_rgb(26_25_23/0.35)] backdrop-blur">
        <span className="min-w-0 flex-1 text-meta text-ink-3">
          {erro ? (
            <span className="text-risk" role="alert">
              {erro}
            </span>
          ) : guardado && !mudou ? (
            <span className="inline-flex items-center gap-1 text-ok">
              <Check className="size-3.5" strokeWidth={2} /> Análise guardada
            </span>
          ) : mudou ? (
            <span className="font-medium text-warn">Há alterações por guardar.</span>
          ) : relatorio ? (
            "Análise guardada."
          ) : (
            "Nenhuma pergunta é obrigatória. Escreve o que tiveres a dizer."
          )}
        </span>
        <button type="button" className="ctl-primary h-9" disabled={aGuardar || !mudou || !temAlgo} onClick={() => void guardar()}>
          {aGuardar ? "A guardar…" : "Guardar análise"}
        </button>
      </div>
    </div>
  );
}

function assinatura(r: MatchReport): string {
  const d = new Date(r.updatedAt).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
  return `Escrita${r.authorName ? ` por ${r.authorName}` : ""} a ${d}.`;
}

/** O título de um bloco, com o ponto da cor que diz de que lado ele está. */
function Titulo({ cor, children }: { cor: string; children: string }) {
  return (
    <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
      <span aria-hidden className="size-2.5 rounded-full" style={{ background: cor }} />
      <h3 className="text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">{children}</h3>
    </header>
  );
}
