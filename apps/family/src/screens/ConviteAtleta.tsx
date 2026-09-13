import { ConsentimentoLegal } from "@/screens/ConsentimentoLegal";
import { useEffect, useState, type FormEvent } from "react";
import { Dumbbell } from "lucide-react";
import { ClubMark } from "@/ClubMark";
import { applyBrand } from "@/lib/brand";
import { chooseContext } from "@/lib/contexts";
import { saveSession } from "@/lib/session";
import { clearAthleteInvite, saveSlug } from "@/lib/invite";
import { RecuperarPalavraPasse } from "@/screens/RecuperarPalavraPasse";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type Preview = {
  academy: { slug: string; name: string; shortName: string; signalColor: string; logoUrl: string | null };
  firstName: string;
  team: string | null;
  emailHint: string;
  alreadyLinked: boolean;
};

/**
 * O resgate do convite de atleta — escolher a palavra-passe, entrar já dentro.
 *
 * O mesmo ecrã do convite de sócio, com outro chapéu: o clube pôs o email na
 * ficha do atleta, saiu o email, o link atravessou a landing e chegou aqui com
 * o token guardado (ver `lib/invite.ts`). Pergunta-se **uma** coisa — a
 * palavra-passe — porque tudo o resto já se sabe do lado de lá.
 *
 * Quem já tinha conta com esse email (um atleta adulto que também é sócio, por
 * exemplo) não cria outra: a palavra-passe que escrever tem de ser a da conta
 * que existe, e é essa que fica ligada à ficha.
 */
export default function ConviteAtleta({ token, onDone }: { token: string; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [morto, setMorto] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Os termos, aceites ao criar a conta — os das famílias cobrem os atletas.
  const [legalOk, setLegalOk] = useState(true);
  const [contaExiste, setContaExiste] = useState(false);
  const [recuperar, setRecuperar] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/convite-atleta/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Preview>) : Promise.reject(new Error("convite"))))
      .then((p) => {
        setPreview(p);
        applyBrand({ color: p.academy.signalColor, shortName: p.academy.shortName, logoUrl: p.academy.logoUrl });
        saveSlug(p.academy.slug);
      })
      .catch(() => setMorto(true));
  }, [token]);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (busy || password.length < 8 || !legalOk) return;
    setBusy(true);
    setErro(null);
    setContaExiste(false);
    try {
      const res = await fetch(`${API}/api/convite-atleta/${encodeURIComponent(token)}/registar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, acceptLegal: true }),
      });
      const body = (await res.json().catch(() => null)) as
        | { slug?: string; accessToken?: string; refreshToken?: string | null; message?: string | string[] }
        | null;

      if (!res.ok || !body?.accessToken) {
        // 403 é só um caso: o email já tinha conta e a palavra-passe não é a dela.
        if (res.status === 403) {
          setContaExiste(true);
          throw new Error("Este email já tem conta, e essa palavra-passe não é a dela.");
        }
        const msg = Array.isArray(body?.message) ? body?.message[0] : body?.message;
        throw new Error(msg ?? "Não foi possível criar a conta.");
      }

      if (body.slug) saveSlug(body.slug);
      saveSession({ accessToken: body.accessToken, refreshToken: body.refreshToken, name: preview?.firstName });
      /* Quem chegou pelo convite de atleta quer a área de atleta — sem perguntar. */
      chooseContext("ATHLETE");
      clearAthleteInvite();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  if (morto) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-[19px] font-semibold text-ink">Este convite já não está ativo</p>
        <p className="max-w-[34ch] text-[14px] leading-relaxed text-ink-3">
          Pode já ter sido usado. Se já criaste a conta, entra com o teu email e a tua palavra-passe.
        </p>
        <button
          type="button"
          onClick={() => {
            clearAthleteInvite();
            onDone();
          }}
          className="cta mt-2"
        >
          Ir para o login
        </button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="size-12 animate-pulse rounded-[16px]" style={{ background: "var(--color-signal)" }} aria-hidden />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-6 px-6 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <ClubMark
          logoUrl={preview.academy.logoUrl}
          mark={preview.academy.shortName.slice(0, 2).toUpperCase()}
          size={56}
          radius={16}
          className="shadow-[var(--shadow-soft)]"
        />
        <div>
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">Olá, {preview.firstName} 👋</h1>
          <p className="mx-auto mt-1 max-w-[32ch] text-[14px] leading-relaxed text-ink-3">
            És atleta {preview.team ? <>do <span className="font-semibold text-ink">{preview.team}</span> </> : ""}
            {preview.team ? "de" : "de"} <span className="font-semibold text-ink">{preview.academy.name}</span>. Escolhe a
            tua palavra-passe e fica com os treinos, os jogos, as convocatórias e as avaliações sempre à mão.
          </p>
        </div>
      </header>

      {recuperar ? (
        <RecuperarPalavraPasse
          slug={preview.academy.slug}
          origem="invite"
          voltarLabel="Voltar ao convite"
          onVoltar={() => setRecuperar(false)}
        />
      ) : (
        <form onSubmit={submeter} className="space-y-3">
          <div className="flex items-center gap-3 rounded-[16px] bg-surface p-4 shadow-[var(--shadow-soft)]">
            <span className="flex size-10 items-center justify-center rounded-[12px] bg-signal-soft text-signal-ink">
              <Dumbbell className="size-5" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-ink-3">A tua conta</span>
              <span className="block truncate text-[14px] font-semibold text-ink">{preview.emailHint}</span>
            </span>
          </div>

          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Palavra-passe (mínimo 8 caracteres)"
            className="w-full rounded-[16px] bg-surface px-4 py-3.5 text-[15px] text-ink shadow-[var(--shadow-soft)] outline-none placeholder:text-ink-4"
          />

          {preview.alreadyLinked && (
            <p className="px-1 text-[12px] leading-relaxed text-ink-3">
              Esta ficha já tem conta. Se és tu, entra pelo login normal — este convite já cumpriu.
            </p>
          )}
          <div className="rounded-[16px] bg-surface px-4 py-1 shadow-[var(--shadow-soft)]">
            <ConsentimentoLegal audience="FAMILY" onChange={setLegalOk} />
          </div>

          {erro && <p className="px-1 text-[13px] font-medium text-risk">{erro}</p>}
          {contaExiste && (
            <button type="button" onClick={() => setRecuperar(true)} className="block w-full py-1 text-[13px] font-semibold text-signal-ink">
              Esqueci-me da palavra-passe dessa conta
            </button>
          )}

          <button type="submit" disabled={busy || password.length < 8 || !legalOk} className="cta w-full disabled:opacity-40">
            {busy ? "A criar a conta…" : "Criar a minha conta"}
          </button>

          <p className="px-1 text-center text-[12px] leading-relaxed text-ink-4">
            A conta fica ligada ao email para onde o convite foi enviado.
          </p>
        </form>
      )}
    </div>
  );
}
