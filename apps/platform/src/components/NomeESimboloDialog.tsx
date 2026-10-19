import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImageUp, X } from "lucide-react";
import { ClubMark } from "@/components/primitives";
import { enviarSimbolo } from "@/components/NewAcademyDialog";
import { apiPatch } from "@/lib/http";

/**
 * O nome e o símbolo de um clube, mudados na ficha dele (pedido do Rui,
 * 19/10/2026).
 *
 * Até aqui escreviam-se ao criar o clube e mais nada: um clube criado com o
 * nome errado, ou sem emblema à data, ficava assim. O clube continua a poder
 * mudar o símbolo e o nome curto nas Definições da consola; daqui muda-se
 * também o nome completo.
 *
 * O símbolo grava-se logo que se escolhe o ficheiro (é o mesmo envio em duas
 * fases da criação, `enviarSimbolo`), e vê-se no círculo de cima. O nome
 * grava-se no botão. O endereço do clube (`slug`) não muda: está nos links e
 * nas apps instaladas.
 */
export function NomeESimboloDialog({
  academy,
  onClose,
  onSaved,
}: {
  academy: { id: string; name: string; shortName: string; logoUrl: string | null; signalColor: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(academy.name);
  const [shortName, setShortName] = useState(academy.shortName);
  const [logoUrl, setLogoUrl] = useState(academy.logoUrl);
  const [aEnviar, setAEnviar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ficheiro = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mudou = name.trim() !== academy.name || shortName.trim() !== academy.shortName;
  const valido = name.trim().length >= 3 && shortName.trim().length >= 2;

  async function escolherSimbolo(file: File | undefined) {
    if (!file) return;
    // Os mesmos três tipos que o servidor aceita (`club-logo.service.ts`).
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setErro("O símbolo tem de ser uma imagem PNG, JPG ou WebP.");
      return;
    }
    setAEnviar(true);
    setErro(null);
    try {
      await enviarSimbolo(academy.id, file);
      // A pré-visualização sai do ficheiro: o endereço público do novo só se lê ao recarregar a ficha.
      setLogoUrl(URL.createObjectURL(file));
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o símbolo.");
    } finally {
      setAEnviar(false);
      if (ficheiro.current) ficheiro.current.value = "";
    }
  }

  async function gravar(e: FormEvent) {
    e.preventDefault();
    if (!mudou) {
      onClose();
      return;
    }
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await apiPatch(`/academies/${academy.id}/nome`, { name: name.trim(), shortName: shortName.trim() });
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  const campo =
    "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 py-10 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="nome-e-simbolo"
        onSubmit={gravar}
        className="w-full max-w-[480px] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 id="nome-e-simbolo" className="truncate text-panel text-ink">
              Nome e símbolo
            </h2>
            <p className="truncate text-meta text-ink-3">Como o clube aparece na consola, na app e nos emails</p>
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {/* O símbolo: o que está, e o botão para outro. Grava-se logo. */}
          <div className="flex items-center gap-4">
            <ClubMark name={name || academy.name} logoUrl={logoUrl} color={academy.signalColor} size={56} />
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => ficheiro.current?.click()}
                disabled={aEnviar}
                className="ctl-outline"
              >
                <ImageUp className="size-3.5" strokeWidth={1.75} />
                {aEnviar ? "A carregar…" : logoUrl ? "Trocar símbolo" : "Carregar símbolo"}
              </button>
              <p className="mt-1.5 text-meta text-ink-3">PNG, JPG ou WebP. Fica gravado assim que se escolhe.</p>
              <input
                ref={ficheiro}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void escolherSimbolo(e.target.files?.[0])}
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-meta font-medium text-ink-2">Nome do clube</div>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={campo} />
          </div>

          <div>
            <div className="mb-1.5 text-meta font-medium text-ink-2">Nome curto</div>
            <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={120} className={campo} />
            <p className="mt-1.5 text-meta leading-relaxed text-ink-3">
              Como o clube se apresenta no topo da app e nos emails (por exemplo, "CD Academias"). O clube também o pode
              mudar nas Definições.
            </p>
          </div>

          {erro && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{erro}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="ctl-ghost">
            {mudou ? "Cancelar" : "Fechar"}
          </button>
          <button type="submit" className="ctl-primary" disabled={(mudou && !valido) || busy || aEnviar}>
            {busy ? "A guardar…" : mudou ? "Guardar nome" : "Feito"}
          </button>
        </footer>
      </form>
    </div>
  );
}
