import { ConsentimentoLegal } from "@/screens/ConsentimentoLegal";
import { useEffect, useState, type FormEvent } from "react";
import { IdCard } from "lucide-react";
import { ClubMark } from "@/ClubMark";
import { applyBrand } from "@/lib/brand";
import { chooseContext } from "@/lib/contexts";
import { saveSession } from "@/lib/session";
import { clearMemberInvite, saveSlug } from "@/lib/invite";
import { RecuperarPalavraPasse } from "@/screens/RecuperarPalavraPasse";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type Preview = {
  academy: { slug: string; name: string; shortName: string; signalColor: string; logoUrl: string | null };
  firstName: string;
  emailHint: string;
  alreadyLinked: boolean;
};

/**
 * O resgate do convite de sócio — escolher a password, entrar já dentro.
 *
 * ## O caminho todo
 *
 * O clube inscreve (ou aprova) o sócio → sai o email → o link atravessa a
 * landing e chega aqui com o token guardado (ver `lib/invite.ts`, o mesmo
 * mecanismo do convite das famílias). Este ecrã pergunta **uma** coisa — a
 * palavra-passe — porque tudo o resto já se sabe: o email é o da ficha, o nome
 * é o da ficha, e é o servidor que os tem.
 *
 * Quem já tinha conta com esse email não cria outra: a password que escrever
 * tem de ser a da conta que existe, e é essa que fica ligada à ficha.
 */
export default function ConviteSocio({ token, onDone }: { token: string; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [morto, setMorto] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Os termos, aceites ao criar a conta — ver `ConsentimentoLegal`.
  const [legalOk, setLegalOk] = useState(true);
  /*
   * O email já tinha conta e a palavra-passe não bateu (403). Aí não há outra
   * saída que não seja repor a da conta que existe — por isso a oferta só aparece
   * nesse erro, e não como mais uma linha por baixo de um formulário de uma linha.
   */
  const [contaExiste, setContaExiste] = useState(false);
  const [recuperar, setRecuperar] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/convite-socio/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Preview>) : Promise.reject(new Error("convite"))))
      .then((p) => {
        setPreview(p);
        // A app veste a cor do clube já — o resgate faz parte da app, não é uma página à parte.
        applyBrand({
          color: p.academy.signalColor,
          shortName: p.academy.shortName,
          logoUrl: p.academy.logoUrl,
        });
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
      const res = await fetch(`${API}/api/convite-socio/${encodeURIComponent(token)}/registar`, {
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
      /* Quem chegou pelo convite de sócio quer a área de sócio — sem perguntar. */
      chooseContext("MEMBER");
      clearMemberInvite();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * Um convite morto não é um beco: quem já resgatou entra pelo login normal, e
   * é para lá que a única saída aponta.
   */
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
            clearMemberInvite();
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
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            Olá, {preview.firstName} 👋
          </h1>
          <p className="mx-auto mt-1 max-w-[32ch] text-[14px] leading-relaxed text-ink-3">
            És sócio de <span className="font-semibold text-ink">{preview.academy.name}</span>. Escolhe a tua
            palavra-passe e fica com o cartão, as quotas e as novidades sempre à mão.
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
              <IdCard className="size-5" strokeWidth={1.9} />
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
            <ConsentimentoLegal audience="MEMBER" onChange={setLegalOk} />
          </div>

          {erro && <p className="px-1 text-[13px] font-medium text-risk">{erro}</p>}
          {contaExiste && (
            <button
              type="button"
              onClick={() => setRecuperar(true)}
              className="w-full py-1 text-center text-[13.5px] font-semibold text-ink underline underline-offset-[3px]"
            >
              Esqueci-me da palavra-passe desta conta
            </button>
          )}

          <button type="submit" disabled={busy || password.length < 8 || !legalOk} className="cta w-full disabled:opacity-40">
            {busy ? "A criar a conta…" : "Criar a minha conta"}
          </button>
        </form>
      )}

      <p className="text-center text-[12px] leading-relaxed text-ink-4">
        Se este email já tiver conta na app, a palavra-passe tem de ser a dessa conta — é assim que provamos que és tu.
      </p>
    </div>
  );
}
