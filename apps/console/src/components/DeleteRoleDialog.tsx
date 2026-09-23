import { useState } from "react";
import { Dialog } from "./Dialog";
import { TriangleAlert } from "@/lib/icons";
import { apagarCargo, type AcademyRole } from "@/lib/roles";

/**
 * Apagar um cargo, mesmo com gente a vesti-lo.
 *
 * ## O que estava antes
 *
 * O botão só aparecia quando o cargo estava vazio, e o servidor recusava com
 * *"Ainda há 3 pessoas com este papel"*. Para apagar um cargo era preciso
 * reatribuir três pessoas primeiro, uma a uma — e um clube a reorganizar-se faz
 * isto ao contrário: desfaz a estrutura velha e arruma as pessoas depois.
 *
 * Não havia confirmação nenhuma: carregar em "Arquivar" apagava logo.
 *
 * ## O que a confirmação tem de dizer
 *
 * Duas coisas, por esta ordem. **Quantas pessoas ficam sem cargo** — que é o
 * efeito que não se vê a partir deste ecrã, porque as pessoas estão noutra
 * página. E **que ninguém perde acesso** — que é o que decide se se carrega no
 * botão, e que é contra-intuitivo ao ponto de ter de estar escrito: sem cargo,
 * a pessoa cai nos valores por omissão do papel-base.
 */
export function DeleteRoleDialog({
  role,
  onClose,
  onDeleted,
}: {
  role: AcademyRole;
  onClose: () => void;
  onDeleted: (people: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pessoas = role.people;

  async function apagar() {
    setBusy(true);
    setError(null);
    try {
      const r = await apagarCargo(role.id);
      onDeleted(r.people);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="apagar-cargo"
      title={`Apagar ${role.name}?`}
      subtitle={pessoas === 0 ? "ninguém o tem" : `${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}`}
      icon={<TriangleAlert className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={440}
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-ghost" onClick={onClose} disabled={busy}>
            Não apagar
          </button>
          <button type="button" className="ctl-risk" disabled={busy} onClick={() => void apagar()}>
            {busy ? "A apagar…" : "Apagar cargo"}
          </button>
        </>
      }
    >
      <div className="space-y-2 px-5 py-4">
        {pessoas === 0 ? (
          <p className="text-body leading-relaxed text-ink-2">Ninguém tem este cargo. Some e mais nada.</p>
        ) : (
          <>
            <p className="text-body leading-relaxed text-ink-2">
              {pessoas === 1 ? "A pessoa que o tem fica" : `As ${pessoas} pessoas que o têm ficam`}{" "}
              <strong className="font-medium text-ink">sem cargo</strong>.
            </p>
            <p className="text-meta leading-relaxed text-ink-3">
              Ninguém perde o acesso: sem cargo, cada pessoa fica com o que o papel-base lhe dá. Um presidente continua
              presidente. Podes dar-lhes outro cargo quando quiseres, na ficha de cada uma.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
