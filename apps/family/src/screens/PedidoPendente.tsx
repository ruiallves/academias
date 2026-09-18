import { useState } from "react";
import { Hourglass, Mail, RefreshCw } from "lucide-react";
import { readBrand } from "@/lib/brand";
import { chooseContext, loadContexts, useContexts } from "@/lib/contexts";
import { signOut, useSession } from "@/lib/session";
import { ClubMark } from "@/ClubMark";

const OUTRAS: Record<string, string> = {
  ATHLETE: "Abrir a área de atleta",
  MEMBER: "Abrir a área de sócio",
  STAFF: "Abrir a consola",
};

/**
 * O pai registou-se e o clube ainda não o aprovou.
 *
 * Aparece logo a seguir ao registo, e sempre que ele abrir a app até ao clube
 * responder. O servidor recusa tudo o resto com `FAMILY_APPROVAL_PENDING`,
 * por isso este ecrã não pede dados nenhuns: diz o que aconteceu, o que falta
 * e como vai saber que já pode entrar.
 *
 * "Verificar outra vez" pergunta de novo pelas áreas, sem recarregar a página:
 * se o clube aprovou entretanto, a app abre ali mesmo.
 */
export default function PedidoPendente() {
  const brand = readBrand();
  const session = useSession();
  const { contexts } = useContexts();
  const [aVer, setAVer] = useState(false);
  const [semNovidades, setSemNovidades] = useState(false);

  const outras = (contexts ?? []).filter((c) => c.type !== "FAMILY");
  const email = emailDoToken(session?.accessToken);

  async function verificar() {
    setAVer(true);
    setSemNovidades(false);
    await loadContexts();
    setAVer(false);
    setSemNovidades(true);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-6 px-6 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <ClubMark logoUrl={brand.logoUrl} mark={brand.mark} size={56} radius={16} className="shadow-[var(--shadow-soft)]" />
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">Pedido enviado ao clube</h1>
      </header>

      <div className="rise space-y-4 rounded-[20px] bg-surface p-5 shadow-[var(--shadow-soft)]">
        <div className="flex gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-signal-soft text-signal-ink">
            <Hourglass className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-ink">À espera de aprovação</p>
            <p className="mt-0.5 text-[14px] leading-relaxed text-ink-3">
              A tua conta está criada e o teu educando ficou associado. Falta{" "}
              {brand.shortName ? <strong className="font-semibold text-ink-2">{brand.shortName}</strong> : "o clube"} confirmar
              que és o encarregado de educação.
            </p>
          </div>
        </div>
        <div className="flex gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-sunken text-ink-3">
            <Mail className="size-5" strokeWidth={1.9} />
          </span>
          <p className="min-w-0 text-[14px] leading-relaxed text-ink-3">
            Quando o pedido for aprovado recebes um email
            {email ? (
              <>
                {" "}em <span className="font-semibold text-ink-2">{email}</span>
              </>
            ) : null}
            , e a app abre aqui com os treinos, os jogos e os avisos.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button type="button" onClick={() => void verificar()} disabled={aVer} className="cta">
          <RefreshCw className={aVer ? "size-[18px] animate-spin" : "size-[18px]"} strokeWidth={1.9} />
          Verificar outra vez
        </button>
        {semNovidades && !aVer && (
          <p className="text-[13px] text-ink-3" role="status">
            Ainda sem resposta do clube.
          </p>
        )}
        {outras.map((c) => (
          <button
            key={c.type}
            type="button"
            onClick={() => chooseContext(c.type)}
            className="text-[14px] font-semibold text-signal-ink underline-offset-2 active:underline"
          >
            {OUTRAS[c.type]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => signOut()}
          className="text-meta font-semibold text-ink-3 underline-offset-2 active:underline"
        >
          Entrar com outra conta
        </button>
      </div>
    </div>
  );
}

/**
 * O email da conta, lido do próprio token.
 *
 * Só para o mostrar: a sessão guardada não o tem, e pedi-lo ao servidor é
 * impossível enquanto ele recusa esta conta. Um token ilegível dá `null`, e o
 * texto passa sem o email.
 */
function emailDoToken(token: string | undefined): string | null {
  try {
    const corpo = token?.split(".")[1];
    if (!corpo) return null;
    const json = JSON.parse(atob(corpo.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: unknown };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}
