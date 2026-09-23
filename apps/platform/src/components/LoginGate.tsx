import { cloneElement, type FormEvent, isValidElement, type ReactElement, useId, useState } from "react";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
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
 * A marca — o logótipo, e não um quadrado com uma letra.
 *
 * Era um "A" desenhado em CSS porque não havia ficheiro. Havendo, usa-se: um
 * logótipo a sério é a diferença entre um produto e uma maqueta, e este é o
 * primeiro ecrã que alguém vê.
 *
 * O halo por baixo é o verde da marca, muito diluído. Não é decoração vazia: é o
 * que assenta o logótipo no cartão em vez de o deixar a flutuar — um PNG
 * quadrado sobre branco lê-se como um autocolante colado à pressa.
 *
 * `alt` vazio e `aria-hidden`: o nome está escrito por baixo, em texto. Um
 * leitor de ecrã que anunciasse "Academias" duas vezes seguidas leria pior.
 */
function Mark({ size = 64 }: { size?: number }) {
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="absolute inset-[-28%] rounded-full blur-xl"
        style={{ background: "color-mix(in oklab, var(--color-signal) 20%, transparent)" }}
      />
      <img
        src="/academias-logo.png"
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        className="relative select-none"
        style={{ width: size, height: size }}
      />
    </span>
  );
}

/**
 * O fundo.
 *
 * Duas luzes verdes muito diluídas em cantos opostos e uma grelha fina que se
 * apaga para as margens. Tudo em CSS, sem um ficheiro de imagem — e tudo abaixo
 * do limiar em que se repara: o que se quer é que o cartão pareça assente
 * nalguma coisa, não que alguém olhe para o papel de parede.
 *
 * A grelha leva uma máscara radial porque uma grelha que chega às margens
 * transforma o ecrã numa folha quadriculada; apagada nas bordas, dá profundidade
 * e desaparece.
 */
function Fundo() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 0%, color-mix(in oklab, var(--color-signal) 15%, transparent) 0%, transparent 70%)," +
            "radial-gradient(55% 45% at 100% 100%, color-mix(in oklab, var(--color-pine) 12%, transparent) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--color-pine) 8%, transparent) 1px, transparent 1px)," +
            "linear-gradient(to bottom, color-mix(in oklab, var(--color-pine) 8%, transparent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 60% at 50% 40%, #000 0%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 40%, #000 0%, transparent 100%)",
        }}
      />
    </div>
  );
}

/**
 * A moldura: um cartão ao centro, sobre o fundo.
 *
 * ## O que saiu daqui, e não volta
 *
 * Uma segunda coluna com duas frases sobre o produto — "O painel de quem é dono
 * do produto", "Clientes, receita, utilização…". Quem abre este ecrã já comprou:
 * são duas ou três pessoas e entram aqui todos os dias. Vender-lhes o produto à
 * porta era ocupar meio ecrã a dizer o que elas já sabem.
 *
 * O que ficou no lugar disso não é texto — é acabamento: o fundo, o relevo do
 * cartão, o halo do logótipo, o foco dos campos. Um ecrã bonito não precisa de
 * explicar que o produto é bom.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-canvas px-6 py-12">
      <Fundo />

      <div className="login-rise relative w-full max-w-[392px]">
        <div
          className="rounded-[22px] border border-line bg-surface p-8 max-sm:p-6"
          style={{
            /*
             * Três camadas: o fio de luz em cima (a aresta que apanha a luz), a
             * sombra de contacto curta, e a sombra longa em pinheiro. É o que faz
             * o cartão pousar em vez de estar colado — uma sombra só, cinzenta,
             * lê-se como uma caixa recortada.
             */
            boxShadow:
              "inset 0 1px 0 0 rgb(255 255 255 / 0.6)," +
              "0 1px 2px 0 color-mix(in oklab, var(--color-ink) 8%, transparent)," +
              "0 24px 60px -28px color-mix(in oklab, var(--color-pine) 45%, transparent)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * O ecrã de espera enquanto se confirma a sessão guardada.
 *
 * A mesma silhueta do login — mesmo cartão, mesmo sítio, mesma marca — para que
 * recarregar a página não faça o layout saltar de um ecrã para o outro. Só o
 * conteúdo por baixo da marca é que muda.
 */
function Splash() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-5 py-4">
        <Mark />
        <Loader2 className="size-4 animate-spin text-ink-4" strokeWidth={2} />
      </div>
    </Frame>
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
      <div className="flex flex-col items-center text-center">
        <Mark />
        <h1 className="mt-4 text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">Academias</h1>
        {/*
          "Plataforma" em maiúsculas espaçadas, e não numa segunda frase: é uma
          etiqueta, não uma explicação — diz em que dos dois produtos se está, que
          é a única coisa que alguém precisa de confirmar antes de escrever.
        */}
        <p
          className="mt-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: "var(--color-signal)" }}
        >
          Plataforma
        </p>
      </div>

      <form onSubmit={submit} className="mt-7 space-y-3">
        <Campo icone={Mail} rotulo="E-mail">
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@academias.pt"
            autoFocus
            className={campo}
          />
        </Campo>

        <Campo icone={Lock} rotulo="Palavra-passe">
          <input
            type={visivel ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${campo} pr-11`}
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
            className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-[10px] text-ink-4 transition-colors hover:bg-sunken hover:text-ink-2"
          >
            {visivel ? <EyeOff className="size-4" strokeWidth={1.75} /> : <Eye className="size-4" strokeWidth={1.75} />}
          </button>
        </Campo>

        {/*
          O erro vive por cima do botão e com espaço reservado — sem isto, a
          mensagem empurrava o botão para baixo no instante em que alguém ia
          carregar nele outra vez.
        */}
        <div aria-live="polite" className="min-h-[1.25rem] pt-0.5">
          {error && <p className="text-meta leading-relaxed text-risk">{error}</p>}
        </div>

        {/*
          O botão é o pinheiro do logótipo, e não o preto do resto do painel.
          Lá dentro, o preto é o que não distrai de uma tabela; aqui é o único
          gesto do ecrã, e o ecrã é a porta da marca.
        */}
        <button
          type="submit"
          disabled={busy || !preenchido}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-body font-semibold text-white transition-[transform,box-shadow,opacity] duration-150 enabled:hover:-translate-y-px enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
          style={{
            background: "linear-gradient(180deg, var(--color-pine-2) 0%, var(--color-pine) 100%)",
            boxShadow:
              "inset 0 1px 0 0 rgb(255 255 255 / 0.18), 0 8px 20px -10px color-mix(in oklab, var(--color-pine) 70%, transparent)",
          }}
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

      {/*
        A única linha de texto que sobrou, e sobrou por servir: quem se engana de
        porta engana-se por saber que ela existe. Dizer-lhe onde é poupa um
        telefonema.
      */}
      <p className="mt-6 text-center text-[11px] text-ink-4">És de um clube? Entra pela página do clube.</p>
    </Frame>
  );
}

/**
 * Um campo: rótulo, ícone e a caixa.
 *
 * Existe para os dois campos serem exactamente o mesmo — dois campos com meia
 * diferença de espaçamento lêem-se como um erro, e é o género de coisa que se
 * instala quando cada um é escrito à mão.
 */
function Campo({
  icone: Icone,
  rotulo,
  children,
}: {
  icone: typeof Mail;
  rotulo: string;
  children: React.ReactNode;
}) {
  const id = useId();
  /*
   * A ligação ao campo, quando é um só e não traz `id` seu. É o que mantém o
   * rótulo a focar o campo sem o pôr à volta dele — ver `DialogField`.
   */
  const soUmCampo =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !(children.props as { id?: string }).id;

  return (
    <div className="block">
      <label {...(soUmCampo ? { htmlFor: id } : {})} className="mb-1.5 block text-meta font-medium text-ink-2">{rotulo}</label>
      <span className="relative block">
        <Icone
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4"
          strokeWidth={1.75}
        />
        {soUmCampo ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
      </span>
    </div>
  );
}

/**
 * A caixa, uma vez só. O ícone à esquerda paga o `pl-10`.
 *
 * O foco é verde-campo — a mesma cor do botão, que é como o olho percebe que o
 * campo e a acção são da mesma família. O anel é um `color-mix` sobre a variável
 * da marca: escrito à mão, ficava um verde parecido mas não igual.
 */
const campo =
  "h-11 w-full rounded-[12px] border border-line bg-canvas pl-10 pr-3 text-body text-ink transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-ink-4 hover:border-line-strong focus:border-[var(--color-signal)] focus:bg-surface " +
  "focus:ring-[3px] focus:ring-[color-mix(in_oklab,var(--color-signal)_18%,transparent)] focus:outline-none";
