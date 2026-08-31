import { useRef, useState } from "react";
import { Panel, PanelHead, cx } from "@/components/primitives";
import { Camera, TriangleAlert, X } from "@/lib/icons";
import { removeItemImage, uploadItemImage } from "@/lib/inventory";

/**
 * As fotografias de um artigo.
 *
 * ## Porque é que um armazém precisa de fotografias
 *
 * Porque "T-shirt preta de treino" descreve três coisas diferentes no mesmo
 * armazém — a de 2024, a de 2026 e a do staff. Quem vai buscar material procura
 * pela imagem, não pelo nome; e quem regista um artigo novo tem-no à frente e
 * tira a foto com o telemóvel em dois segundos.
 *
 * ## O ficheiro nunca passa pela nossa API
 *
 * Autorizar → o browser carrega direto para o armazenamento → confirmar. É o
 * caminho das fotografias de atleta, pela mesma razão: oito megabytes a
 * atravessar o servidor são oito megabytes que ele não tem para mais ninguém.
 *
 * O que se vê aqui são links **assinados**, gerados na leitura e válidos por
 * horas — o que a base guarda são chaves.
 */
export function ItemPhotos({
  itemId,
  images,
  editable,
  onChange,
}: {
  itemId: string;
  images: { key: string; url: string }[];
  editable: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const cheio = images.length >= 4;

  async function escolher(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setErro(null);
    try {
      // Uma de cada vez: quatro autorizações em paralelo davam quatro pedidos
      // que o servidor teria de contar em simultâneo contra o limite de quatro.
      for (const file of Array.from(files).slice(0, 4 - images.length)) {
        await uploadItemImage(itemId, file);
      }
      onChange();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a fotografia.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function apagar(key: string) {
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await removeItemImage(itemId, key);
      onChange();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível remover.");
    } finally {
      setBusy(false);
    }
  }

  // Sem fotos e sem poder juntar, o painel não tem nada a dizer — e um painel
  // vazio numa ficha é ruído.
  if (images.length === 0 && !editable) return null;

  return (
    <Panel>
      <PanelHead title="Fotografias" hint={images.length ? `${images.length} de 4` : "para se reconhecer no armazém"}>
        {editable && !cheio && (
          <button type="button" className="ctl-ghost" onClick={() => input.current?.click()} disabled={busy}>
            <Camera className="size-3.5" strokeWidth={1.75} />
            {busy ? "A carregar…" : "Juntar"}
          </button>
        )}
      </PanelHead>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={(e) => void escolher(e.target.files)}
      />

      <div className="p-4">
        {images.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line px-4 py-8 text-center hover:border-ink-4"
          >
            <Camera className="size-5 text-ink-4" strokeWidth={1.5} />
            <span className="text-body font-medium text-ink">Sem fotografias</span>
            <span className="max-w-[38ch] text-meta leading-relaxed text-ink-3">
              Uma foto distingue duas t-shirts pretas que a descrição não distingue.
            </span>
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {images.map((img) => (
              <li key={img.key} className="group relative">
                <img
                  src={img.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-[var(--radius-control)] border border-line object-cover"
                />
                {editable && (
                  <button
                    type="button"
                    onClick={() => void apagar(img.key)}
                    disabled={busy}
                    aria-label="Remover fotografia"
                    className={cx(
                      "absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full",
                      "bg-ink/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                    )}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {erro && (
          <p className="mt-2 flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </div>
    </Panel>
  );
}
