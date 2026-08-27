import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
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

/* -------------------------------------------------------------------------- */

/**
 * A marca, no tamanho que a página pedir.
 *
 * O mesmo quadrado índigo da barra lateral (ver `Shell.tsx`) — quem entra vê já o
 * sítio onde vai estar, e não um ecrã de login que podia ser de qualquer produto.
 */
function Mark({ size = 44 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[12px] font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: "var(--color-signal)",
        boxShadow: "0 10px 24px -12px color-mix(in oklab, var(--color-signal) 70%, black)",
      }}
      aria-hidden
    >
      A
    </span>
  );
}

/**
 * O ecrã de espera enquanto se confirma a sessão guardada.
 *
 * Era um anel a girar sozinho no vazio. Agora é a mesma composição do login com o
 * conteúdo por baixo — quem recarrega a página não vê o layout saltar de um ecrã
 * para o outro.
 */
function Splash() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-4 py-10">
        <Mark />
        <span className="flex items-center gap-2 text-meta text-ink-3">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          A confirmar a sessão…
        </span>
      </div>
    </Frame>
  );
}

/**
 * A composição: marca à esquerda, formulário à direita.
 *
 * ## Porquê duas colunas
 *
 * Um cartão de 320px ao meio de um ecrã de 27 polegadas é um formulário à deriva.
 * Este painel abre-se quase sempre num monitor grande, e a coluna da esquerda dá-
 * lhe chão: diz onde se está antes de se escrever a primeira letra, e no telemóvel
 * desaparece — aí o formulário sozinho já é a página inteira.
 *
 * ## Os estilhaços
 *
 * A mesma linguagem gráfica da landing e da página de sócios: formas angulares na
 * cor da marca, sem uma única imagem. Aqui em índigo, que é a cor desta
 * plataforma e de nenhuma academia — quem trabalha nos dois produtos ao mesmo
 * tempo sabe onde está pelo canto do olho.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 120% at 80% -10%, color-mix(in oklab, var(--color-signal) 78%, white) 0%, transparent 55%)," +
              "linear-gradient(155deg, var(--color-signal) 0%, color-mix(in oklab, var(--color-signal) 72%, black) 100%)",
          }}
        />
        {/* Estilhaços: profundidade sem um ficheiro de imagem. */}
        <span
          aria-hidden
          className="absolute top-[-8%] right-[-10%] h-[62%] w-[52%] opacity-25"
          style={{ background: "#fff", clipPath: "polygon(0 0, 100% 42%, 30% 100%)" }}
        />
        <span
          aria-hidden
          className="absolute bottom-[-14%] left-[-6%] h-[48%] w-[46%] opacity-15"
          style={{ background: "#fff", clipPath: "polygon(0 22%, 100% 0, 62% 100%)" }}
        />

        <div className="relative flex items-center gap-3">
          <Mark size={36} />
          <div>
            <div className="text-body font-semibold text-white">Academias</div>
            <div className="text-[11px] text-white/70">Plataforma</div>
          </div>
        </div>

        <div className="relative max-w-[34ch]">
          <h2 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-white">
            O painel de quem é dono do produto.
          </h2>
          <p className="mt-3 text-body leading-relaxed text-white/70">
            Clientes, receita, utilização e o que precisa de atenção hoje — de todas as academias, num sítio só.
          </p>
        </div>

        <p className="relative flex items-center gap-2 text-[11px] text-white/60">
          <ShieldCheck className="size-3.5" strokeWidth={1.75} />
          Acesso restrito a administradores da plataforma
        </p>
      </aside>

      <main className="flex min-h-dvh items-center justify-center px-6 py-10">
        <div className="w-full max-w-[360px]">{children}</div>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visivel, setVisivel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preenchido = email.trim().length > 0 && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!preenchido || busy) return;
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
    <Frame>
      {/* A marca repete-se aqui para o telemóvel, onde a coluna da esquerda não existe. */}
      <div className="mb-7 lg:hidden">
        <Mark />
      </div>

      <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">Entrar</h1>
      <p className="mt-1.5 text-meta text-ink-3">Painel de gestão do SaaS.</p>

      <form onSubmit={submit} className="mt-7 space-y-3.5">
        <label className="block">
          <span className="mb-1.5 block text-meta font-medium text-ink">E-mail</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@academias.pt"
            autoFocus
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-meta font-medium text-ink">Palavra-passe</span>
          <span className="relative block">
            <input
              type={visivel ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${field} pr-10`}
            />
            {/*
              Ver o que se escreveu.
              Não há "esqueci-me da palavra-passe" neste painel — quem entra aqui
              são duas ou três pessoas —, por isso o erro mais provável é um dedo
              trocado numa password longa, e não uma conta esquecida.
            */}
            <button
              type="button"
              onClick={() => setVisivel((v) => !v)}
              aria-label={visivel ? "Esconder a palavra-passe" : "Mostrar a palavra-passe"}
              className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] text-ink-4 transition-colors hover:text-ink-2"
            >
              {visivel ? <EyeOff className="size-4" strokeWidth={1.75} /> : <Eye className="size-4" strokeWidth={1.75} />}
            </button>
          </span>
        </label>

        {/*
          O erro vive por cima do botão e com espaço reservado — sem isto, a
          mensagem empurrava o botão para baixo no instante em que alguém ia
          carregar nele outra vez.
        */}
        <div aria-live="polite" className="min-h-[1.25rem]">
          {error && <p className="text-meta leading-relaxed text-risk">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={busy || !preenchido}
          className="ctl-primary h-11 w-full justify-center text-body"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              A entrar…
            </>
          ) : (
            "Entrar"
          )}
        </button>
      </form>

      <p className="mt-6 text-[11px] leading-relaxed text-ink-4">
        Este painel é da plataforma. Se és de uma academia, entra pela página do teu clube.
      </p>
    </Frame>
  );
}

/** O campo, uma vez. Dois campos com meia diferença de padding lêem-se como um erro. */
const field =
  "h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-body text-ink " +
  "placeholder:text-ink-4 focus:border-signal focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-signal)_18%,transparent)] focus:outline-none";
