import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Send, TriangleAlert } from "@/lib/icons";
import { inviteMembers, type MemberRow } from "@/lib/members";

/**
 * Confirmar o envio do convite da app a vários sócios.
 *
 * ## Porque é que isto pergunta antes
 *
 * Porque é correio a sair em nome do clube, para pessoas a sério, e não se
 * desfaz. Quem escolhe trinta linhas numa lista não tem obrigação de saber que
 * quinze não têm email na ficha e que três já entraram na app — e descobri-lo
 * *depois* de mandar, num resumo, é tarde para a decisão que interessa: mandar
 * ou não.
 *
 * Por isso o número que o botão promete é o número de emails que vão mesmo
 * sair, e a conta de quem fica de fora aparece **antes**, com o motivo. Um
 * "enviar a 30" que manda 12 ensina a não confiar no que o produto diz.
 *
 * ## O que faz com quem já está na app
 *
 * Deixa-os de fora sem drama: reenviar um convite a quem já tem conta não faz
 * nada de útil (o servidor recusa-o ficha a ficha) e faria a pessoa receber um
 * email a convidá-la para onde já está.
 */
export function SendInvitesDialog({
  members,
  onClose,
  onDone,
}: {
  /** Os sócios escolhidos na lista — todos, com estado de app e tudo. */
  members: MemberRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ enviados: number; falhas: number } | null>(null);

  /*
   * Os três grupos, contados aqui e não no servidor.
   *
   * O servidor volta a decidir ficha a ficha (é ele a fronteira), mas quem
   * carrega no botão precisa de ver a conta antes — e a lista já traz o estado
   * de cada um. Ver `app` em `MemberRow`.
   */
  const paraEnviar = members.filter((m) => m.app === "none" || m.app === "invited");
  const semEmail = members.filter((m) => m.app === "noemail");
  const jaNaApp = members.filter((m) => m.app === "account");
  const reenvios = paraEnviar.filter((m) => m.app === "invited").length;

  async function enviar() {
    if (busy || paraEnviar.length === 0) return;
    setBusy(true);
    setErro(null);
    try {
      const r = await inviteMembers(paraEnviar.map((m) => m.id));
      /*
       * O resumo fica no diálogo em vez de fechar.
       *
       * Mandar correio a trinta pessoas é uma acção com consequência — a
       * confirmação de que saiu (e de quantos falharam, se falharam) merece
       * ser lida, não um fecho silencioso que deixa a dúvida.
       */
      setFeito({ enviados: r.enviados, falhas: r.falhas.length });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar os convites.");
    } finally {
      setBusy(false);
    }
  }

  const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

  return (
    <Dialog
      labelledBy="enviar-convites"
      title="Enviar convite da app"
      subtitle={`${plural(members.length, "sócio escolhido", "sócios escolhidos")}`}
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
              onClick={enviar}
              className="ctl-primary"
              disabled={busy || paraEnviar.length === 0}
              title={paraEnviar.length === 0 ? "Nenhum dos escolhidos pode receber o convite" : undefined}
            >
              <Send className="size-3.5" strokeWidth={1.75} />
              {busy ? "A enviar…" : `Enviar a ${plural(paraEnviar.length, "sócio", "sócios")}`}
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 p-5">
        {feito ? (
          <>
            <p className="text-body leading-relaxed text-ink">
              {feito.enviados > 0
                ? `${plural(feito.enviados, "convite saiu", "convites saíram")}.`
                : "Não saiu nenhum convite."}
            </p>
            {feito.falhas > 0 && (
              <p className="flex items-start gap-1.5 text-meta leading-relaxed text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                {plural(feito.falhas, "sócio não recebeu", "sócios não receberam")} — abre a ficha para ver porquê.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-body leading-relaxed text-ink">
              Vai sair um email para {plural(paraEnviar.length, "sócio", "sócios")}, com o convite para criar
              conta e instalar a app do clube.
            </p>

            {reenvios > 0 && (
              <p className="text-meta leading-relaxed text-ink-3">
                {plural(reenvios, "já tinha sido convidado", "já tinham sido convidados")} — vai receber o convite
                outra vez, com um link novo. O anterior deixa de funcionar.
              </p>
            )}

            {/*
              Quem fica de fora, e porquê — antes de mandar, não depois.

              É a razão de este diálogo existir: a direcção escolhe o livro todo
              e tem de saber que metade não tem email na ficha **antes** de
              contar com o convite lá chegar.
            */}
            {(semEmail.length > 0 || jaNaApp.length > 0) && (
              <div className="rounded-[var(--radius-control)] border border-line bg-sunken/50 px-3 py-2.5">
                <p className="mb-1 text-meta font-medium text-ink">Ficam de fora</p>
                <ul className="space-y-0.5 text-meta text-ink-3">
                  {semEmail.length > 0 && (
                    <li>
                      {plural(semEmail.length, "sócio sem email", "sócios sem email")} na ficha — acrescenta o
                      endereço para os poderes convidar.
                    </li>
                  )}
                  {jaNaApp.length > 0 && (
                    <li>{plural(jaNaApp.length, "sócio já está", "sócios já estão")} na app.</li>
                  )}
                </ul>
              </div>
            )}

            {erro && (
              <p className="flex items-start gap-1.5 text-meta text-risk">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                {erro}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
