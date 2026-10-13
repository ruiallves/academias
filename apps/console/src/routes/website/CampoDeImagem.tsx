import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { enviarImagem } from "@/lib/website";
import { mostrarErro, textoDoErro } from "@/lib/avisos";

/**
 * A fotografia de uma notícia ou de um produto: escolher no computador,
 * carregar, ver, trocar ou tirar.
 *
 * O botão abre um seletor de ficheiros escondido; nada tocável vive dentro
 * de um `<label>` (ver `check:toque`). A imagem é reduzida antes de carregar
 * (ver `enviarImagem`), por isso uma fotografia tirada com o telemóvel serve.
 */
export function CampoDeImagem({
  valor,
  onMudar,
  max = 1600,
  proporcao = "aspect-[16/9]",
  rotulo = "Fotografia",
}: {
  valor: string;
  onMudar: (url: string) => void;
  max?: number;
  proporcao?: string;
  rotulo?: string;
}) {
  const ficheiro = useRef<HTMLInputElement | null>(null);
  const [aCarregar, setACarregar] = useState(false);

  const escolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setACarregar(true);
    try {
      onMudar(await enviarImagem(f, max));
    } catch (err) {
      mostrarErro(textoDoErro(err, "Não foi possível carregar a imagem."));
    } finally {
      setACarregar(false);
    }
  };

  return (
    <div>
      <p className="mb-1.5 text-meta font-medium text-ink-2">{rotulo}</p>
      <input ref={ficheiro} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolher} />
      {valor ? (
        <div className={cx("relative overflow-hidden rounded-[8px] border border-line bg-sunken", proporcao)}>
          <img src={valor} alt="" className="size-full object-cover" />
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <button type="button" className="ctl-outline bg-surface" disabled={aCarregar} onClick={() => ficheiro.current?.click()}>
              {aCarregar ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} /> : <ImagePlus className="size-4" strokeWidth={1.75} />}
              Trocar
            </button>
            <button type="button" className="ctl-outline bg-surface text-risk" disabled={aCarregar} onClick={() => onMudar("")} aria-label="Tirar a fotografia">
              <Trash2 className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={aCarregar}
          onClick={() => ficheiro.current?.click()}
          className={cx(
            "flex w-full flex-col items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line-strong bg-sunken/40 text-meta text-ink-3 transition-colors hover:border-ink-3 hover:text-ink",
            proporcao,
          )}
        >
          {aCarregar ? <Loader2 className="size-5 animate-spin" strokeWidth={1.75} /> : <ImagePlus className="size-5" strokeWidth={1.75} />}
          {aCarregar ? "A carregar…" : "Escolher fotografia"}
        </button>
      )}
    </div>
  );
}
