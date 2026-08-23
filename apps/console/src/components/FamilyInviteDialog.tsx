import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/http";
import { Check, Clock, Copy, Link2, RefreshCw, Trash2 } from "@/lib/icons";
import { Dialog } from "./Dialog";
import { cx } from "./primitives";

/**
 * O link que traz as famílias para a app.
 *
 * ## O que este diálogo é, e o que não é
 *
 * Não é um formulário de convite. É **uma porta com um interruptor**: ou está
 * aberta, e o link está aqui para copiar; ou não está, e há um botão para a abrir.
 * Por isso abre já com o link à vista quando existe um — a acção mais provável de
 * quem clica em "Convidar para a app" é copiar o que já está feito e mandá-lo a
 * mais uma família, não gerar um link novo.
 *
 * ## Porque é que gerar um novo fecha o anterior
 *
 * Porque dois links vivos é não saber quantas portas estão abertas. Está escrito
 * no ecrã e não escondido num tooltip: quem troca o link tem de saber que o antigo
 * deixa de funcionar para quem ainda não entrou.
 *
 * ## O que se diz sobre segurança, e porquê
 *
 * Que o link, sozinho, não dá acesso a nada. É a pergunta que qualquer diretor faz
 * ao perceber que isto se manda para um grupo de WhatsApp — e a resposta é boa: a
 * ligação a um educando exige o NIF e a data de nascimento dele. Dizê-lo aqui evita
 * a conversa telefónica e evita, sobretudo, que alguém invente um processo mais
 * "seguro" por fora.
 */

type Invite = {
  id: string;
  link: string;
  expiresAt: string | null;
  usedCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

/** As mesmas de `DURATIONS` no servidor, mais o sem-prazo. */
const OPTIONS: { days: number | null; label: string; hint: string }[] = [
  { days: 1, label: "24 horas", hint: "para mandar a uma família" },
  { days: 7, label: "7 dias", hint: "o normal" },
  { days: 30, label: "30 dias", hint: "início de época" },
  { days: null, label: "Sem prazo", hint: "fica aberto até fechares" },
];

export function FamilyInviteDialog({ onClose }: { onClose: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(7);
  const [copied, setCopied] = useState(false);
  const [trocar, setTrocar] = useState(false);

  useEffect(() => {
    apiGet<Invite | null>("/api/family-invite")
      .then((r) => setInvite(r))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível ler o link."))
      .finally(() => setLoading(false));
  }, []);

  async function gerar() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await apiPost<Invite>("/api/family-invite", { days }));
      setTrocar(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar o link.");
    } finally {
      setBusy(false);
    }
  }

  async function fechar() {
    if (!confirm("Fechar o link? As famílias que ainda não entraram deixam de conseguir.")) return;
    setBusy(true);
    try {
      await apiDelete("/api/family-invite");
      setInvite(null);
      setTrocar(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível fechar.");
    } finally {
      setBusy(false);
    }
  }

  async function copiar() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão da área de transferência: o link está à vista para copiar à mão */
    }
  }

  return (
    <Dialog
      title="Convidar para a app"
      subtitle="Um link só, para mandar às famílias"
      onClose={onClose}
      width={520}
      labelledBy="convite-familias"
      footer={
        <div className="flex items-center justify-between gap-2">
          {invite && !trocar ? (
            <button type="button" onClick={fechar} disabled={busy} className="ctl-ghost text-[#a82a20]">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Fechar link
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className="ctl-outline">
            Concluído
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {loading ? (
          <div className="h-24 animate-pulse rounded-[var(--radius-control)] bg-sunken" />
        ) : invite && !trocar ? (
          <>
            <div className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
              <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{invite.link}</code>
              <button type="button" onClick={copiar} className="ctl-primary mt-2.5 w-full justify-center">
                {copied ? (
                  <>
                    <Check className="size-3.5" strokeWidth={2} /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" strokeWidth={1.75} /> Copiar link
                  </>
                )}
              </button>
            </div>

            <dl className="grid grid-cols-3 gap-3 text-meta">
              <div>
                <dt className="text-ink-4">Validade</dt>
                <dd className={cx("mt-0.5 font-medium", expiring(invite.expiresAt) ? "text-[#8a5a12]" : "text-ink")}>
                  {validade(invite.expiresAt)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-4">Famílias entradas</dt>
                <dd className="mt-0.5 font-medium text-ink tabular">{invite.usedCount}</dd>
              </div>
              <div>
                <dt className="text-ink-4">Criado por</dt>
                <dd className="mt-0.5 truncate font-medium text-ink">{invite.createdBy ?? "—"}</dd>
              </div>
            </dl>

            <button type="button" onClick={() => setTrocar(true)} className="ctl-ghost w-full justify-center">
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
              Gerar link novo com outra duração
            </button>
          </>
        ) : (
          <>
            {invite && (
              <p className="rounded-[var(--radius-control)] bg-[#fdf1dd] px-3 py-2 text-meta leading-relaxed text-[#8a5a12]">
                Gerar um link novo fecha o actual. Quem ainda não entrou com o antigo deixa de conseguir — manda-lhes o novo.
              </p>
            )}

            <div>
              <span className="mb-1.5 block text-meta font-medium text-ink">Quanto tempo fica aberto</span>
              <div className="grid grid-cols-2 gap-1.5">
                {OPTIONS.map((o) => (
                  <label
                    key={String(o.days)}
                    className={cx(
                      "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2 transition-colors duration-[120ms]",
                      days === o.days ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                    )}
                  >
                    <input
                      type="radio"
                      name="duracao"
                      checked={days === o.days}
                      onChange={() => setDays(o.days)}
                      className="size-3.5 accent-[var(--color-signal)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-ink">{o.label}</span>
                      <span className="block text-[11px] text-ink-4">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {invite && (
                <button type="button" onClick={() => setTrocar(false)} className="ctl-ghost">
                  Cancelar
                </button>
              )}
              <button type="button" onClick={gerar} disabled={busy} className="ctl-primary">
                <Link2 className="size-3.5" strokeWidth={1.75} />
                {busy ? "A gerar…" : invite ? "Gerar e fechar o antigo" : "Gerar link"}
              </button>
            </div>
          </>
        )}

        {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

        {/*
          Como funciona, em três linhas. Não é ajuda decorativa: é o que impede a
          secretaria de mandar isto e depois ficar sem saber explicar ao pai que
          liga a perguntar "e agora o que faço?".
        */}
        <ol className="space-y-1.5 border-t border-line pt-3.5 text-meta leading-relaxed text-ink-3">
          <li>1. O pai abre o link no telemóvel e cai na página do clube, que instala a app.</li>
          <li>2. Dentro da app, cria conta — nome, telemóvel, email e palavra-passe.</li>
          <li>
            3. Identifica o filho pelo <strong className="font-medium text-ink-2">NIF e data de nascimento</strong>. Sem esses
            dois, o link não liga a criança nenhuma — por isso pode ser partilhado à vontade.
          </li>
        </ol>

        <p className="text-[11px] leading-relaxed text-ink-4">
          <Clock className="mr-1 inline size-3 align-[-2px]" strokeWidth={1.75} />
          Atletas sem NIF preenchido na ficha não podem ser reclamados. É o campo <em>NIF</em> em cada atleta.
        </p>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function validade(iso: string | null): string {
  if (!iso) return "Sem prazo";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expirado";

  const horas = Math.round(ms / 3_600_000);
  if (horas < 48) return `${horas} h`;
  return `${Math.round(horas / 24)} dias`;
}

/** Menos de um dia é o momento de avisar — não no dia seguinte, quando já fechou. */
function expiring(iso: string | null): boolean {
  return iso !== null && new Date(iso).getTime() - Date.now() < 86_400_000;
}
