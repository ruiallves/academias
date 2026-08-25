import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { applyBrand } from "@/lib/brand";
import { clearInvite, readInvite, saveInvite, saveSlug, type InvitePreview } from "@/lib/invite";
import { saveSession, signIn } from "@/lib/session";
import { cx } from "@/ui";

/**
 * A porta da app da família.
 *
 * ## Os dois caminhos, e porque é que o primeiro é criar conta
 *
 * Quem chega aqui pela primeira vez chegou por um link que o clube mandou, acabou
 * de instalar a app, e não tem conta nenhuma. "Entrar" é o caso do segundo
 * telemóvel e da app reinstalada — existe, mas não é o que está a acontecer agora.
 * Por isso criar conta é o botão cheio, e entrar é o discreto por baixo.
 *
 * **Sem convite os papéis trocam.** Quem abre a app pelo ícone, sem link nenhum, já
 * a instalou antes: é alguém a voltar, e o que quer é entrar. Pedir-lhe primeiro "o
 * link do clube" era responder à pergunta errada — ninguém vai buscar um link para
 * abrir uma app que já tem. Colar o link fica como o que é, uma saída de recurso
 * para quem o perdeu entre instalar e abrir, e vive numa linha de texto.
 *
 * ## Porque é que o educando se identifica pelo NIF e pela data de nascimento
 *
 * Porque o link é partilhado. Vai para o grupo de WhatsApp dos pais e reencaminha-se
 * — é para isso que serve. Se bastasse abri-lo para escolher um filho de uma lista,
 * qualquer pessoa do grupo escolhia o filho de outra.
 *
 * O NIF mais a data de nascimento é o que uma família sabe de cor e mais ninguém
 * tem junto. Não há lista para escolher, não há pesquisa por nome, e um par errado
 * dá sempre a mesma resposta — não diz se falhou o número ou a data, porque dizê-lo
 * transformava isto num sítio para confirmar NIFs de crianças.
 *
 * ## Três passos e não um formulário só
 *
 * Confirmar o filho **antes** de pedir a palavra-passe é o que evita o pior
 * momento possível: escrever tudo, carregar em criar, e ouvir que o NIF não bate.
 * Assim, quando se chega aos dados da conta já se sabe que o clube reconheceu a
 * criança — e vê-se o nome dela no ecrã.
 */

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type Step = "escolha" | "filho" | "dados" | "login";

type Matched = { firstName: string; team: string | null };

export default function Entrar({ onEntered }: { onEntered: () => void }) {
  const [token, setToken] = useState<string | null>(readInvite);
  const [clube, setClube] = useState<InvitePreview | null>(null);
  const [step, setStep] = useState<Step>("escolha");
  const [erro, setErro] = useState<string | null>(null);

  // Quem é o clube deste convite. Sem isto, o primeiro ecrã dizia "a academia" —
  // e um pai que instalou a app do clube do filho quer ver o nome do clube.
  useEffect(() => {
    if (!token) return;
    let vivo = true;

    fetch(`${API}/api/convite-familia/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<InvitePreview>) : Promise.reject(new Error("convite"))))
      .then((preview) => {
        if (!vivo) return;
        setClube(preview);
        saveSlug(preview.academy.slug);
        applyBrand({
          color: preview.academy.signalColor,
          shortName: preview.academy.shortName,
          mark: preview.academy.mark,
        });
      })
      .catch(() => {
        if (!vivo) return;
        // Um convite gasto não é um beco: entrar continua a funcionar, e é o que
        // um pai que já tem conta precisa de fazer.
        setClube(null);
        setToken(null);
        setErro("Este link já não está válido. Pede outro ao clube — ou entra, se já tens conta.");
      });

    return () => {
      vivo = false;
    };
  }, [token]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center px-6 py-10">
      <header className="mb-7">
        <div
          className="mb-4 flex size-12 items-center justify-center rounded-[var(--radius-sm)] text-[15px] font-bold text-white"
          style={{ background: "var(--color-signal)" }}
          aria-hidden
        >
          {clube?.academy.mark ?? "··"}
        </div>
        <h1 className="text-[26px] leading-tight font-semibold text-ink">
          {clube ? clube.academy.name : "A app da tua academia"}
        </h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
          {step === "login"
            ? "Entra com a conta que já tens."
            : clube
              ? "Treinos, pagamentos e o progresso do teu filho, num sítio só."
              : "Entra com a conta que tens. Para criares uma, abre o link que o clube te enviou."}
        </p>
      </header>

      {erro && step === "escolha" && (
        <p className="mb-4 rounded-[var(--radius-sm)] bg-[#fae9e7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#a82a20]">{erro}</p>
      )}

      {step === "escolha" && (
        <Escolha
          temConvite={token !== null}
          onCriar={() => setStep("filho")}
          onEntrar={() => setStep("login")}
          onColar={(valor) => {
            setErro(null);
            setToken(saveInvite(valor));
          }}
        />
      )}

      {step === "filho" && token && (
        <Filho token={token} onVoltar={() => setStep("escolha")} onEncontrado={() => setStep("dados")} />
      )}

      {step === "dados" && token && (
        <Dados token={token} onVoltar={() => setStep("filho")} onPronto={onEntered} />
      )}

      {step === "login" && <Login onVoltar={() => setStep("escolha")} onPronto={onEntered} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Escolha({
  temConvite,
  onCriar,
  onEntrar,
  onColar,
}: {
  temConvite: boolean;
  onCriar: () => void;
  onEntrar: () => void;
  onColar: (valor: string) => void;
}) {
  const [colar, setColar] = useState(false);
  const [valor, setValor] = useState("");

  // Chegou por convite: criar conta é o que está a acontecer agora.
  if (temConvite) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onCriar} className="cta w-full">
          Criar conta
        </button>
        <button type="button" onClick={onEntrar} className="cta-quiet w-full">
          Já tenho conta — entrar
        </button>
      </div>
    );
  }

  // Abriu a app pelo ícone: é alguém a voltar.
  return (
    <div className="space-y-3">
      <button type="button" onClick={onEntrar} className="cta w-full">
        Entrar
      </button>

      {colar ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valor.trim()) onColar(valor);
          }}
          className="space-y-2 pt-1"
        >
          {/*
            A saída de recurso: quem instalou a app e perdeu o link pelo caminho
            — abriu-a pelo ícone em vez do botão — cola-o aqui. Aceita o link
            inteiro, que é o que a pessoa tem no WhatsApp.
          */}
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Cola aqui o link do clube"
            autoFocus
            className={INPUT}
          />
          <button type="submit" className="cta-quiet w-full">
            Continuar
          </button>
        </form>
      ) : (
        <p className="pt-1 text-center text-[13px] leading-relaxed text-ink-3">
          Ainda não tens conta? Abre o link que o clube te enviou.{" "}
          <button
            type="button"
            onClick={() => setColar(true)}
            className="font-medium text-ink underline underline-offset-2"
          >
            Tenho-o aqui
          </button>
        </p>
      )}
    </div>
  );
}

/** Passo 1: de quem és pai. */
function Filho({ token, onVoltar, onEncontrado }: { token: string; onVoltar: () => void; onEncontrado: () => void }) {
  const [taxId, setTaxId] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [match, setMatch] = useState<Matched | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido = /^\d{9}$/.test(taxId.replace(/\s/g, "")) && birthdate !== "";

  async function procurar(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);

    try {
      const res = await fetch(`${API}/api/convite-familia/${encodeURIComponent(token)}/educando`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxId: taxId.replace(/\s/g, ""), birthdate }),
      });
      const body = (await res.json().catch(() => null)) as (Matched & { message?: string }) | null;
      if (!res.ok) throw new Error(body?.message ?? "Não foi possível confirmar.");

      sessionStorage.setItem(RASCUNHO, JSON.stringify({ taxId: taxId.replace(/\s/g, ""), birthdate }));
      setMatch({ firstName: body!.firstName, team: body!.team });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível confirmar.");
    } finally {
      setBusy(false);
    }
  }

  if (match) {
    return (
      <div className="space-y-4">
        <div className="surface p-4">
          <p className="text-[13px] text-ink-3">Encontrámos</p>
          <p className="mt-0.5 text-[20px] font-semibold text-ink">{match.firstName}</p>
          {match.team && <p className="text-[13px] text-ink-2">{match.team}</p>}
        </div>
        <button type="button" onClick={onEncontrado} className="cta w-full">
          É o meu filho — continuar
        </button>
        <button type="button" onClick={() => setMatch(null)} className="cta-quiet w-full">
          Não é
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={procurar} className="space-y-4">
      <Campo label="NIF do teu filho">
        <input
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
          inputMode="numeric"
          maxLength={11}
          placeholder="123456789"
          autoFocus
          className={INPUT}
        />
      </Campo>

      <Campo label="Data de nascimento dele">
        <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className={INPUT} />
      </Campo>

      <p className="text-[12px] leading-relaxed text-ink-3">
        É assim que o clube confirma que és tu o encarregado. Se não bater certo, fala com a secretaria — pode ser
        que o NIF ainda não esteja na ficha dele.
      </p>

      {erro && <p className="rounded-[var(--radius-sm)] bg-[#fae9e7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#a82a20]">{erro}</p>}

      <button type="submit" disabled={!valido || busy} className="cta w-full">
        {busy ? "A confirmar…" : "Continuar"}
      </button>
      <button type="button" onClick={onVoltar} className="cta-quiet w-full">
        Voltar
      </button>
    </form>
  );
}

/** Passo 2: quem és tu. */
function Dados({ token, onVoltar, onPronto }: { token: string; onVoltar: () => void; onPronto: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [relation, setRelation] = useState("Mãe");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido =
    name.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    password.length >= 8 &&
    phone.trim().length >= 9;

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);

    const filho = JSON.parse(sessionStorage.getItem(RASCUNHO) ?? "{}") as { taxId?: string; birthdate?: string };

    try {
      const res = await fetch(`${API}/api/convite-familia/${encodeURIComponent(token)}/registar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
          relation,
          taxId: filho.taxId ?? "",
          birthdate: filho.birthdate ?? "",
        }),
      });

      const body = (await res.json().catch(() => null)) as
        | { accessToken: string; refreshToken: string | null; slug: string; message?: string }
        | null;
      if (!res.ok || !body?.accessToken) throw new Error(body?.message ?? "Não foi possível criar a conta.");

      // A sessão vem com a resposta — quem acabou de escrever a palavra-passe não a
      // escreve outra vez num ecrã de login. É onde se perderia metade das pessoas.
      saveSession({ accessToken: body.accessToken, refreshToken: body.refreshToken, name: name.trim() });
      saveSlug(body.slug);
      sessionStorage.removeItem(RASCUNHO);
      clearInvite();
      onPronto();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={criar} className="space-y-4">
      <Campo label="O teu nome">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={INPUT} />
      </Campo>

      <Campo label="Sou">
        <div className="flex gap-1.5">
          {["Mãe", "Pai", "Encarregado"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRelation(r)}
              aria-pressed={relation === r}
              className={cx(
                "flex-1 rounded-[12px] border px-3 py-2.5 text-[14px] font-medium transition-colors",
                relation === r ? "border-ink bg-ink text-surface" : "border-line text-ink-2",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </Campo>

      <Campo label="Telemóvel" hint="é por aqui que o clube te liga">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="912 345 678" className={INPUT} />
      </Campo>

      <Campo label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={INPUT} />
      </Campo>

      <Campo label="Palavra-passe" hint="pelo menos 8 caracteres">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className={INPUT}
        />
      </Campo>

      {erro && <p className="rounded-[var(--radius-sm)] bg-[#fae9e7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#a82a20]">{erro}</p>}

      <button type="submit" disabled={!valido || busy} className="cta w-full">
        {busy ? "A criar…" : "Criar conta"}
      </button>
      <button type="button" onClick={onVoltar} className="cta-quiet w-full">
        Voltar
      </button>
    </form>
  );
}

/** O outro caminho: já tem conta. */
function Login({ onVoltar, onPronto }: { onVoltar: () => void; onPronto: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErro(null);
    try {
      await signIn(email, password);
      onPronto();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={entrar} className="space-y-4">
      <Campo label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus className={INPUT} />
      </Campo>
      <Campo label="Palavra-passe">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className={INPUT}
        />
      </Campo>

      {erro && <p className="rounded-[var(--radius-sm)] bg-[#fae9e7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#a82a20]">{erro}</p>}

      <button type="submit" disabled={busy} className="cta w-full">
        {busy ? "A entrar…" : "Entrar"}
      </button>
      <button type="button" onClick={onVoltar} className="cta-quiet w-full">
        Voltar
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O par NIF+data entre os dois passos.
 *
 * Em `sessionStorage` e não no estado do componente porque o ecrã de dados é outro
 * componente, e não no `localStorage` porque isto são dados de uma criança que não
 * têm por que sobreviver ao registo. Some quando a conta existe.
 */
const RASCUNHO = "academia.family.registo";

const INPUT =
  // 16px no tipo de letra não é estética: abaixo disso o Safari do iPhone dá zoom
  // ao tocar no campo, e o formulário salta debaixo dos dedos de quem escreve.
  "w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3.5 py-3 text-[16px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none";

function Campo({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
