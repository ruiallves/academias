import { useRef, useState } from "react";
import { Camera, Trash2 } from "@/lib/icons";
import { cx } from "./primitives";
import { PhotoError } from "@/lib/photos";

/**
 * A fotografia de uma pessoa, com o carregamento por trás.
 *
 * ## Porque é que as iniciais não são um estado vazio
 *
 * As academias não têm fotografia de toda a gente, e nunca vão ter. Um avatar
 * cinzento genérico é pior do que as iniciais — as iniciais identificam, o avatar
 * genérico só ocupa espaço a lembrar o que falta. Por isso a ausência de foto é uma
 * apresentação legítima, e não um convite permanente.
 *
 * O botão aparece por cima, ao passar o rato. A ficha **pede** a fotografia sem a
 * exigir para funcionar.
 *
 * ## O que se mostra enquanto carrega
 *
 * A imagem escolhida, imediatamente, a partir do ficheiro local (`URL.createObjectURL`)
 * — antes de o servidor responder. Um carregamento de dois segundos com o sítio da
 * foto vazio parece avariado; com a foto já lá e uma opacidade a dizer "ainda não
 * está firme", parece o que é.
 */
export function PhotoPicker({
  name,
  photoUrl,
  size = 64,
  editable,
  onUpload,
  onRemove,
}: {
  name: string;
  photoUrl?: string | null;
  /** Lado do quadrado, em píxeis. A ficha usa 64; uma lista, 40. */
  size?: number;
  editable: boolean;
  onUpload: (file: File) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = preview ?? photoUrl ?? null;

  /**
   * Escolher e carregar.
   *
   * ## O `blob:` só se revoga depois de deixar de estar no ecrã
   *
   * Revogá-lo assim que o carregamento acabava — que era o que isto fazia — invalida
   * o endereço enquanto o `<img>` ainda aponta para ele: a fotografia ficava um
   * quadrado cinzento, e ficava assim até alguém sair da página. O `blob:` é a única
   * imagem que existe entre o momento da escolha e a resposta do servidor.
   *
   * A ordem correcta: carregar, **esperar que o servidor confirme** (o `onUpload` de
   * quem chama recarrega os dados), só então largar a pré-visualização — a essa
   * altura o `photoUrl` verdadeiro já está por baixo, e a troca não tem intervalo.
   */
  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);

    const local = URL.createObjectURL(file);
    setPreview(local);
    setBusy(true);

    try {
      await onUpload(file);
      setPreview(null);
    } catch (err) {
      setPreview(null);
      setError(err instanceof PhotoError || err instanceof Error ? err.message : "Não foi possível carregar.");
    } finally {
      setBusy(false);
      URL.revokeObjectURL(local);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!onRemove || busy) return;
    if (!confirm("Remover a fotografia?")) return;
    setBusy(true);
    try {
      await onRemove();
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover.");
    } finally {
      setBusy(false);
    }
  }

  const box = { width: size, height: size };

  return (
    <div className="shrink-0">
      <div className="group relative" style={box}>
        {shown ? (
          <img
            src={shown}
            alt={name}
            style={box}
            className={cx("rounded-[14px] object-cover transition-opacity", busy && "opacity-40")}
          />
        ) : (
          <span
            style={box}
            className="flex items-center justify-center rounded-[14px] bg-sunken font-semibold text-ink-2"
          >
            {initials(name)}
          </span>
        )}

        {/*
          A carregar.

          Um disco a rodar por cima e não só a imagem a esbater: uma fotografia mais
          clara pode ser a fotografia, e quem carrega um ficheiro de 4 MB numa ligação
          fraca fica cinco segundos sem saber se aquilo está a acontecer. O disco diz
          que está — e o `aria-busy` di-lo a quem não o vê.
        */}
        {busy && (
          <span
            style={box}
            role="status"
            aria-busy="true"
            aria-label="A carregar a fotografia"
            className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-surface/50"
          >
            <span className="size-5 animate-spin rounded-full border-2 border-line border-t-ink-2" />
          </span>
        )}

        {editable && (
          <>
            {/* Escondido enquanto carrega: senão tapava o disco a rodar ao passar o rato. */}
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              hidden={busy}
              title={shown ? "Trocar fotografia" : "Carregar fotografia"}
              aria-label={shown ? "Trocar fotografia" : "Carregar fotografia"}
              style={box}
              className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-ink/40 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Camera className="size-5 text-white" strokeWidth={1.75} />
            </button>

            {shown && onRemove && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                title="Remover fotografia"
                aria-label="Remover fotografia"
                className="absolute -right-1.5 -bottom-1.5 hidden size-6 items-center justify-center rounded-full border border-line bg-surface text-ink-3 shadow-[var(--shadow-pop)] group-hover:flex hover:text-[#a82a20]"
              >
                <Trash2 className="size-3" strokeWidth={1.75} />
              </button>
            )}

            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void pick(e.target.files?.[0])}
              className="hidden"
            />
          </>
        )}
      </div>

      {/*
        A falha em caixa e não em texto solto por baixo do avatar.

        Onze píxeis cinzentos-avermelhados ao lado de uma fotografia são a definição
        de aviso que ninguém lê — e o que se lê em vez dele é "carreguei e não
        aconteceu nada".
      */}
      {error && (
        <p
          role="alert"
          className="mt-1.5 max-w-[220px] rounded-[var(--radius-control)] bg-[#fae9e7] px-2 py-1.5 text-[11px] leading-snug text-[#a82a20]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Primeira e última — as mesmas do `Monogram`, para a mesma pessoa não mudar de sigla. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
