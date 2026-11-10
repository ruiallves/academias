import { useId, useState, type FormEvent } from "react";
import { ChevronDown, PhoneCall, ShieldCheck } from "lucide-react";
import { apiPatch } from "@/lib/http";
import { readBrand } from "@/lib/brand";
import { telefoneGravado } from "@/lib/contexts";
import { signOut } from "@/lib/session";
import { ClubMark } from "@/ClubMark";

/**
 * O telemóvel, a quem ainda não o tem.
 *
 * Obrigatório no registo da família desde 09/11/2026. Quem entrou antes (ou
 * foi criado pelo clube só com o email) vê isto uma vez, antes da área de
 * família, e não passa sem ele. O servidor diz quem é (`telefoneEmFalta` nos
 * contextos) e grava-o em `PATCH /api/app/telefone`.
 *
 * Desenhado como o `PedidoPendente`: o emblema do clube, um cartão, o botão.
 */
export function PedirTelefone({ nome }: { nome?: string | null }) {
  const brand = readBrand();
  const id = useId();
  const [telefone, setTelefone] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Os portugueses levam o +351 à frente, já escrito, e o número corta nos 9
   * algarismos. Um número de outro país escreve-se inteiro, com o indicativo:
   * entra-se nesse modo tocando no "+351" ou escrevendo/colando +, 00 ou * (há
   * teclados onde o + está na tecla do *). Sem isto, um pai de fora não tinha
   * como gravar o número e ficava preso neste ecrã.
   */
  const [deFora, setDeFora] = useState(false);
  const digitos = telefone.replace(/\D/g, "").replace(/^(00351|351)(?=\d{9}$)/, "");
  const valido = deFora ? digitos.length >= 9 && digitos.length <= 15 : digitos.length === 9;

  function escrever(v: string) {
    const comIndicativo = /^\s*(\+|00|\*|＋)/.test(v);
    if (deFora || comIndicativo) {
      if (!deFora) setDeFora(true);
      // Só algarismos, espaços e um + à frente; o * e o + largo valem +.
      const limpo = v.replace(/^\s*[*＋]/, "+").replace(/(?!^\+)[^\d\s]/g, "");
      return setTelefone(limpo);
    }
    // 912345678 → 912 345 678, à medida que se escreve.
    const d = v.replace(/\D/g, "").slice(0, 9);
    setTelefone([d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(" "));
  }

  function trocarPais() {
    setErro(null);
    if (deFora) {
      setDeFora(false);
      setTelefone("");
    } else {
      setDeFora(true);
      setTelefone("+");
    }
    document.getElementById(id)?.focus();
  }

  async function gravar(e: FormEvent) {
    e.preventDefault();
    if (!valido || aGravar) return;
    setAGravar(true);
    setErro(null);
    // De fora, sem + nem 00 escritos: o indicativo veio nos algarismos, falta o +.
    const t = telefone.trim();
    const enviar = deFora && !/^(\+|00)/.test(t) ? `+${t}` : t;
    try {
      await apiPatch("/api/app/telefone", { telefone: enviar });
      telefoneGravado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar o telemóvel.");
    } finally {
      setAGravar(false);
    }
  }

  const primeiro = (nome ?? "").trim().split(/\s+/)[0];
  const clube = brand.shortName || "O clube";

  return (
    <form
      onSubmit={(e) => void gravar(e)}
      className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-6 pt-[calc(40px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <header className="flex flex-col items-center gap-3 text-center">
        <ClubMark logoUrl={brand.logoUrl} mark={brand.mark} size={56} radius={16} className="shadow-[var(--shadow-soft)]" />
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {primeiro ? `${primeiro}, só falta o teu telemóvel` : "Só falta o teu telemóvel"}
        </h1>
        <p className="max-w-[32ch] text-[15px] leading-relaxed text-ink-3">
          Pedimos uma vez. Depois a app abre como sempre.
        </p>
      </header>

      <div className="rise mt-7 rounded-[20px] bg-surface p-5 shadow-[var(--shadow-soft)]">
        <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-ink-2">
          O teu telemóvel
        </label>
        <div className="flex items-stretch overflow-hidden rounded-[14px] border border-line bg-canvas focus-within:border-ink-3">
          {!deFora && (
            <button
              type="button"
              onClick={trocarPais}
              aria-label="Número de outro país"
              className="flex items-center gap-1 border-r border-line px-3.5 text-[17px] font-medium text-ink-3 tabular-nums active:bg-sunken"
            >
              +351
              <ChevronDown className="size-4" strokeWidth={2} />
            </button>
          )}
          <input
            id={id}
            value={telefone}
            onChange={(e) => escrever(e.target.value)}
            inputMode="tel"
            autoComplete={deFora ? "tel" : "tel-national"}
            placeholder={deFora ? "+33 6 12 34 56 78" : "912 345 678"}
            autoFocus
            className="min-w-0 flex-1 bg-transparent px-3.5 py-3.5 text-[19px] font-medium tracking-[0.02em] text-ink tabular-nums placeholder:font-normal placeholder:text-ink-4 focus:outline-none"
          />
        </div>
        <button type="button" onClick={trocarPais} className="mt-2 text-meta font-semibold text-ink-3 underline-offset-2 active:underline">
          {deFora ? "É um número português" : "O teu número é de outro país?"}
        </button>
        {deFora && <p className="mt-1 text-meta text-ink-4">Escreve o número inteiro, com o indicativo do país.</p>}
        {erro && <p className="mt-2 text-meta text-risk">{erro}</p>}

        <ul className="mt-5 space-y-4 border-t border-line pt-5">
          <li className="flex gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-signal-soft text-signal-ink">
              <PhoneCall className="size-[18px]" strokeWidth={1.9} />
            </span>
            <p className="min-w-0 text-[14px] leading-relaxed text-ink-3">
              <span className="block font-semibold text-ink">Para te ligarem quando for preciso</span>
              Uma lesão no treino, uma boleia que falhou, um jogo que mudou de hora.
            </p>
          </li>
          <li className="flex gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-sunken text-ink-3">
              <ShieldCheck className="size-[18px]" strokeWidth={1.9} />
            </span>
            <p className="min-w-0 text-[14px] leading-relaxed text-ink-3">
              <span className="block font-semibold text-ink">Fica com o clube</span>
              {clube} vê-o na tua ficha. Os outros pais não o veem.
            </p>
          </li>
        </ul>
      </div>

      <div className="mt-auto flex flex-col items-center gap-4 pt-8">
        <button type="submit" className="cta w-full disabled:opacity-40" disabled={!valido || aGravar}>
          {aGravar ? "A gravar…" : "Guardar e continuar"}
        </button>
        <button type="button" onClick={() => signOut()} className="text-meta font-semibold text-ink-3 underline-offset-2 active:underline">
          Entrar com outra conta
        </button>
      </div>
    </form>
  );
}
