import { useState, type FormEvent } from "react";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/**
 * Pedir o link para repor a palavra-passe.
 *
 * ## A mesma resposta, haja conta ou não
 *
 * O servidor responde igual exista a conta ou não, e o ecrã também: "se houver
 * conta com este email, vai lá ter um link". Dizer "não há conta" era responder a
 * qualquer pessoa que emails estão registados.
 *
 * ## `origem`
 *
 * Diz à página do link para onde levar a pessoa depois de escolher a nova (ver
 * `password-reset.template.ts` na API). Quem pede no login volta a entrar já com
 * sessão. Quem pede a meio de um convite **volta ao convite**: é lá que a conta
 * fica ligada ao educando ou à ficha de sócio, e entrar directamente saltava isso.
 */
export function RecuperarPalavraPasse({
  slug,
  origem,
  emailInicial = "",
  voltarLabel = "Voltar",
  onVoltar,
}: {
  slug: string;
  origem: "family" | "invite";
  emailInicial?: string;
  voltarLabel?: string;
  onVoltar: () => void;
}) {
  const [email, setEmail] = useState(emailInicial);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);

  const valido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function pedir(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);

    try {
      const res = await fetch(`${API}/api/palavra-passe/recuperar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), slug, from: origem }),
      });
      if (res.status === 429) throw new Error("Demasiados pedidos seguidos. Espera um minuto e tenta outra vez.");
      if (!res.ok) throw new Error("Não foi possível enviar o link. Confirma o email e tenta outra vez.");
      setEnviadoPara(email.trim());
    } catch (err) {
      // `TypeError` é o `fetch` sem rede — a mensagem dele vem em inglês e não ajuda.
      setErro(
        err instanceof TypeError
          ? "Sem ligação à internet. Tenta outra vez."
          : err instanceof Error
            ? err.message
            : "Não foi possível enviar o link.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (enviadoPara) {
    return (
      <div className="space-y-4">
        <div className="surface p-4">
          <p className="text-[15px] font-semibold text-ink">Vê o teu email</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
            Se houver uma conta com <span className="font-semibold break-all text-ink">{enviadoPara}</span>, vai lá
            ter um link para escolheres uma palavra-passe nova. Pode demorar um minuto — vê também o spam.
          </p>
          {origem === "invite" && (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
              Depois de a mudares, volta aqui e usa a palavra-passe nova.
            </p>
          )}
        </div>
        <button type="button" onClick={onVoltar} className="cta w-full">
          {voltarLabel}
        </button>
        <button type="button" onClick={() => setEnviadoPara(null)} className="cta-quiet w-full">
          Não chegou? Enviar outra vez
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={pedir} className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-ink-2">
        Escreve o email da tua conta. Enviamos-te um link para escolheres uma palavra-passe nova.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          className={INPUT}
        />
      </label>

      {erro && (
        <p className="rounded-[var(--radius-sm)] bg-[#fae9e7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#a82a20]">
          {erro}
        </p>
      )}

      <button type="submit" disabled={!valido || busy} className="cta w-full">
        {busy ? "A enviar…" : "Enviar link"}
      </button>
      <button type="button" onClick={onVoltar} className="cta-quiet w-full">
        {voltarLabel}
      </button>
    </form>
  );
}

/** O mesmo campo do ecrã de entrada — 16px para o Safari do iPhone não dar zoom. */
const INPUT =
  "w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3.5 py-3 text-[16px] text-ink placeholder:text-ink-4 focus:border-ink-3 focus:outline-none";
