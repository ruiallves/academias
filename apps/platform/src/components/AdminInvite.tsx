import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/http";
import { writeSession } from "@/lib/session";
import { ADMIN_ROLE_LABEL, type PlatformRole } from "@/lib/types";

/**
 * A porta de quem foi convidado.
 *
 * Vive **fora** do `LoginGate` — ver `main.tsx`. Quem chega aqui não tem conta
 * na plataforma nenhuma ainda, e o convite é a única coisa que autentica o
 * pedido: 32 bytes aleatórios que só existem no link. Gémeo de
 * `apps/family/src/screens/Entrar.tsx` e do resgate de convites de staff, com o
 * mesmo raciocínio — confirmar o convite antes de pedir a password é o que evita
 * o pior momento possível: escrever tudo e só depois ouvir que o link já não
 * vale nada.
 */
type Preview = { name: string; email: string; role: PlatformRole };

export function AdminInvite({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    apiGet<Preview>(`/admin-invite/${encodeURIComponent(token)}`)
      .then((p) => vivo && setPreview(p))
      .catch((err) => vivo && setLoadError(err instanceof Error ? err.message : "Convite inválido."));
    return () => {
      vivo = false;
    };
  }, [token]);

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
        <p className="mb-6 text-center text-meta text-ink-3">
          {preview ? `Convite para ${preview.email}` : "A confirmar o convite…"}
        </p>

        {loadError ? (
          <div className="panel space-y-3 p-4">
            <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta leading-relaxed text-[#a82a20]">
              {loadError}
            </p>
            <a href="/" className="link block text-center text-meta font-medium">
              Ir para o início
            </a>
          </div>
        ) : preview ? (
          <Form token={token} preview={preview} />
        ) : (
          <div className="panel flex justify-center p-6">
            <div className="size-6 animate-spin rounded-full border-2 border-line" style={{ borderTopColor: "var(--color-signal)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function Form({ token, preview }: { token: string; preview: Preview }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = password.length >= 8 && password === confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await apiPost<{ accessToken: string; refreshToken: string | null }>(
        `/admin-invite/${encodeURIComponent(token)}/aceitar`,
        { password },
      );
      writeSession({ accessToken: result.accessToken, refreshToken: result.refreshToken ?? "" });
      // Recarrega para o `LoginGate` apanhar a sessão do zero — o mesmo caminho
      // que qualquer login normal segue a partir daqui.
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-3 p-4">
      <div className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta text-ink-2">
        <span className="font-medium text-ink">{preview.name}</span> · {ADMIN_ROLE_LABEL[preview.role]}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-meta font-medium text-ink">Escolhe uma palavra-passe</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className={INPUT}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-meta font-medium text-ink">Confirma-a</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
        />
      </label>

      {password.length > 0 && password.length < 8 && (
        <p className="text-meta text-ink-4">Pelo menos 8 caracteres.</p>
      )}
      {confirm.length > 0 && password !== confirm && (
        <p className="text-meta text-[#a82a20]">As duas não coincidem.</p>
      )}

      <button type="submit" disabled={!valid || busy} className="ctl-primary h-9 w-full justify-center">
        {busy ? "A criar…" : "Criar conta e entrar"}
      </button>

      {error && (
        <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta leading-relaxed text-[#a82a20]">{error}</p>
      )}
    </form>
  );
}

const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";
