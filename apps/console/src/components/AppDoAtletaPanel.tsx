import { useState } from "react";
import { Panel, PanelHead, Pill } from "./primitives";
import { CircleCheck, Mail } from "@/lib/icons";
import { inviteAthlete, unlinkAthleteAccount } from "@/lib/athlete-invites";
import { reloadAcademy } from "@/lib/store";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";
import type { Athlete } from "@/data/types";

/**
 * A conta do próprio atleta na app do clube — o painel da ficha.
 *
 * O par do `AppDoClubePanel` da ficha de sócio: quatro estados possíveis, e o
 * painel diz sempre em qual se está — conta ligada, convite à espera, tem email
 * mas ninguém convidou, ou sem email (e aí o que falta é o email, não o botão).
 *
 * O convite sai sozinho na inscrição e na importação quando a ficha tem email;
 * este botão é para os atletas que já existiam antes da área de atleta, para
 * reenviar quando o email se perdeu, e para quem ganhou email depois.
 *
 * Quem convida é quem gere o acesso das famílias (`family:write`): a conta de
 * um atleta — muitas vezes menor — é um acto administrativo. O email tem de
 * ser **do próprio**, e continua a ser essa a instrução no formulário; com o do
 * encarregado não acontece nada, porque o servidor recusa ligar uma ficha à
 * conta de quem é encarregado dela (ver `athlete-account-link.ts`), mas o
 * convite sai para o endereço errado e a ficha fica à espera.
 *
 * Carregar no botão pode não mandar email nenhum: se aquele email já tem conta
 * neste clube, a ficha liga-se na hora e o painel di-lo. Foi pedido assim —
 * quem já entrou uma vez na app não volta a ser convidado.
 */
export function AppDoAtletaPanel({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const mayWrite = can(session, "family:write");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  /* Um invólucro só, para as acções darem a resposta no mesmo sítio. */
  async function agir(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setResultado(null);
    try {
      setResultado(await fn());
      await reloadAcademy();
    } catch (e) {
      setResultado(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setBusy(false);
    }
  }

  const convidar = async () => {
    const r = await inviteAthlete(athlete.id);
    return r.linked
      ? `${r.email} já tinha conta neste clube: a ficha ficou ligada e não saiu convite.`
      : `Convite enviado para ${r.email}.`;
  };
  const desligar = async () => {
    if (!confirm("Desligar a conta desta ficha? O atleta deixa de ver a área de atleta na app. Um convite novo volta a ligá-la.")) {
      return "Ficou como estava.";
    }
    await unlinkAthleteAccount(athlete.id);
    return "Conta desligada.";
  };

  return (
    <Panel>
      <PanelHead title="App do clube" hint="a conta do próprio atleta">
        {athlete.app === "account" && (athlete.appInstalled ? <Pill tone="ok">Instalada</Pill> : <Pill tone="signal">Conta ligada</Pill>)}
        {athlete.app === "invited" && <Pill tone="warn">Convite enviado</Pill>}
      </PanelHead>
      <div className="space-y-2 px-5 py-3">
        {athlete.app === "account" ? (
          <>
            <p className="flex items-center gap-2 text-body text-ink-2">
              <CircleCheck className="size-4 shrink-0 text-ok" strokeWidth={1.75} />
              Conta ligada — {athlete.email ?? "o atleta"} já vê a área de atleta na app.
            </p>
            {mayWrite && (
              <button type="button" className="ctl-ghost" disabled={busy} onClick={() => void agir(desligar)}>
                Desligar a conta
              </button>
            )}
          </>
        ) : athlete.app === "noemail" ? (
          <p className="text-meta leading-relaxed text-ink-3">
            A ficha não tem email. Escreve o email <strong className="font-medium text-ink-2">do próprio atleta</strong> em
            Editar ficha e o convite para a app sai a seguir — ou por este botão, quando quiseres.
          </p>
        ) : (
          <>
            <p className="text-meta leading-relaxed text-ink-3">
              {athlete.app === "invited"
                ? `Convite enviado para ${athlete.email}, à espera que crie a conta.`
                : `Ainda sem conta na app. O convite vai para ${athlete.email}.`}
            </p>
            {mayWrite && (
              <button type="button" className="ctl-ghost" disabled={busy} onClick={() => void agir(convidar)}>
                <Mail className="size-3.5" strokeWidth={1.75} />
                {athlete.app === "invited" ? "Reenviar convite" : "Enviar convite"}
              </button>
            )}
          </>
        )}
        {resultado && <p className="text-meta text-ink-2">{resultado}</p>}
      </div>
    </Panel>
  );
}
