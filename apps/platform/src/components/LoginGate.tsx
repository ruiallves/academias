import { useState, type FormEvent } from "react";
import { apiGet } from "@/lib/http";
import { readSession, writeSession } from "@/lib/session";
import type { Me } from "@/lib/types";

/**
 * A porta do painel.
 *
 * Login próprio, ao contrário da consola das academias — que manda entrar pela
 * página do clube. Aqui não há página de clube: em produção isto vive em
 * `admin.academias.pt`, e é a única porta que tem.
 *
 * A password vai directa ao Supabase; o nosso servidor nunca vê credenciais, só
 * tokens que consegue verificar. Ter sessão válida **não chega** — a seguir
 * pergunta-se ao `/api/platform/me`, e quem não estiver na tabela `PlatformAdmin`
 * fica de fora, por muito que seja diretor de uma academia.
 */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export function LoginGate({ children }: { children: (me: Me) => React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(() => readSession() !== null);

  // Há sessão guardada: confirma que ainda vale antes de desenhar o painel.
  if (checking) {
    apiGet<Me>("/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setChecking(false));
    return <Splash />;
  }

  if (me) return <>{children(me)}</>;
  return <Login onDone={setMe} />;
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="size-8 animate-spin rounded-full border-2 border-line" style={{ borderTopColor: "var(--color-signal)" }} />
    </div>
  );
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError("E-mail ou palavra-passe incorrectos.");
        return;
      }

      writeSession({ accessToken: body.access_token, refreshToken: body.refresh_token });

      // A verificação que importa: ter conta não é ser dono disto.
      try {
        onDone(await apiGet<Me>("/me"));
      } catch {
        sessionStorage.clear();
        setError("Esta conta não tem acesso à plataforma.");
      }
    } catch {
      setError("Não foi possível contactar o servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[320px]">
        <div
          className="mx-auto mb-5 flex size-11 items-center justify-center rounded-[12px] text-[15px] font-bold text-white"
          style={{ background: "var(--color-signal)" }}
        >
          A
        </div>
        <h1 className="mb-1 text-center text-page text-ink">Plataforma</h1>
        <p className="mb-6 text-center text-meta text-ink-3">Painel de gestão do SaaS</p>

        <form onSubmit={submit} className="panel space-y-3 p-4">
          <label className="block">
            <span className="mb-1.5 block text-meta font-medium text-ink">E-mail</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-meta font-medium text-ink">Palavra-passe</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
            />
          </label>

          <button type="submit" disabled={busy} className="ctl-primary h-9 w-full justify-center">
            {busy ? "A entrar…" : "Entrar"}
          </button>

          {error && (
            <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta leading-relaxed text-[#a82a20]">{error}</p>
          )}
        </form>
      </div>
    </div>
  );
}
