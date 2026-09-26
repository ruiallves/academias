import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CircleCheck, Send, TriangleAlert } from "@/lib/icons";
import { inviteAthletes } from "@/lib/athlete-invites";
import type { Athlete } from "@/data/types";

/**
 * Confirmar o envio do convite da app a vários atletas.
 *
 * O mesmo diálogo dos sócios (`SendInvitesDialog`), pelas mesmas razões: é
 * correio a sair em nome do clube para pessoas a sério, e o número que o botão
 * promete tem de ser o número de emails que vão mesmo sair. Quem fica de fora —
 * sem email na ficha, ou já com conta — aparece **antes**, com o motivo.
 */
export function SendAthleteInvitesDialog({
  athletes,
  onClose,
  onDone,
}: {
  /** Os atletas escolhidos na lista — todos, com estado de app e tudo. */
  athletes: Athlete[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ enviados: number; ligados: number; falhas: number } | null>(null);

  const paraEnviar = athletes.filter((a) => a.app === "none" || a.app === "invited");
  const semEmail = athletes.filter((a) => a.app === "noemail");
  const jaNaApp = athletes.filter((a) => a.app === "account");
  const reenvios = paraEnviar.filter((a) => a.app === "invited").length;

  async function enviar() {
    if (busy || paraEnviar.length === 0) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await inviteAthletes(paraEnviar.map((a) => a.id));
      setFeito({ enviados: r.enviados, ligados: r.ligados, falhas: r.falhas.length });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar os convites.");
    } finally {
      setBusy(false);
    }
  }

  const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

  return (
    <Dialog
      labelledBy="enviar-convites-atletas"
      title="Enviar convite da app"
      subtitle={plural(athletes.length, "atleta escolhido", "atletas escolhidos")}
      icon={<Send className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={470}
      footer={
        feito ? (
          <button type="button" onClick={onDone} className="ctl-primary">
            Fechar
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void enviar()}
              className="ctl-primary"
              disabled={busy || paraEnviar.length === 0}
              title={paraEnviar.length === 0 ? "Nenhum dos escolhidos pode receber o convite" : undefined}
            >
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A enviar…" : `Enviar a ${plural(paraEnviar.length, "atleta", "atletas")}`}
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 p-5">
        {feito ? (
          <>
            <p className="text-body leading-relaxed text-ink">
              {feito.enviados > 0 ? `${plural(feito.enviados, "convite saiu", "convites saíram")}.` : "Não saiu nenhum convite."}
            </p>
            {/* Quem já tinha conta no clube não precisou de convite nenhum: a
                ficha ligou-se e a área de atleta aparece na próxima abertura. */}
            {feito.ligados > 0 && (
              <p className="flex items-start gap-1.5 text-meta leading-relaxed text-ok">
                <CircleCheck className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                {plural(feito.ligados, "atleta já tinha conta", "atletas já tinham conta")} neste clube — a ficha ficou
                ligada sem convite.
              </p>
            )}
            {feito.falhas > 0 && (
              <p className="flex items-start gap-1.5 text-meta leading-relaxed text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                {plural(feito.falhas, "atleta não recebeu", "atletas não receberam")} — abre a ficha para ver porquê.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-body leading-relaxed text-ink">
              Vai sair um email para {plural(paraEnviar.length, "atleta", "atletas")}, com o convite para criar conta e
              instalar a app do clube — a área de atleta.
            </p>

            {reenvios > 0 && (
              <p className="text-meta leading-relaxed text-ink-3">
                {plural(reenvios, "já tinha sido convidado", "já tinham sido convidados")} — vai receber o convite outra
                vez, com um link novo. O anterior deixa de funcionar.
              </p>
            )}

            {(semEmail.length > 0 || jaNaApp.length > 0) && (
              <ul className="space-y-1 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-meta leading-relaxed text-ink-3">
                {semEmail.length > 0 && (
                  <li>
                    {plural(semEmail.length, "fica de fora por não ter email na ficha", "ficam de fora por não terem email na ficha")}
                    {" — "}
                    {semEmail.slice(0, 3).map((a) => a.name.split(" ")[0]).join(", ")}
                    {semEmail.length > 3 ? "…" : ""}
                  </li>
                )}
                {jaNaApp.length > 0 && <li>{plural(jaNaApp.length, "já tem conta na app", "já têm conta na app")} — não recebe outro convite.</li>}
              </ul>
            )}

            {erro && <p className="text-meta text-risk">{erro}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
