import { useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Panel, PanelHead, cx } from "@/components/primitives";
import { Trash2, TriangleAlert } from "@/lib/icons";
import { apiDelete } from "@/lib/http";
import { academy } from "@/lib/store";
import { clearSession } from "@/lib/session";

/**
 * Apagar o clube.
 *
 * ## Porque é que isto vive ao fundo e sozinho
 *
 * É a única acção do produto que não tem volta. Fica no fim das Definições,
 * separada por um painel próprio com moldura de risco, longe de tudo o que se
 * usa no dia a dia — ninguém deve tropeçar nela a caminho de mudar a cor do
 * clube.
 *
 * ## As duas confirmações, e o que cada uma faz
 *
 * O diálogo diz **o que se vai perder, com números reais** — não "esta acção é
 * irreversível", que ninguém lê. E pede o **nome do clube escrito à mão**: é o
 * que separa uma decisão de um clique distraído, e é o servidor que a verifica
 * (uma confirmação só no browser não é confirmação nenhuma).
 */
export function DeleteAcademyPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Panel className="border-risk/40">
        <PanelHead title="Apagar o clube" />
        <div className="space-y-3 p-5">
          <p className="text-meta leading-relaxed text-ink-3">
            Apaga a {academy.name} e tudo o que lhe pertence — atletas, famílias, staff,
            sócios, mensalidades, boletins clínicos, treinos e fotografias. Não há como
            recuperar depois, nem por nós.
          </p>
          <button
            type="button"
            className="ctl-outline border-risk/50 text-risk hover:border-risk hover:text-risk"
            onClick={() => setOpen(true)}
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            Apagar o clube
          </button>
        </div>
      </Panel>

      {open && <DeleteDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A mesma normalização do servidor: espaços a mais e maiúsculas não são o que
  // se está a verificar — o clube certo é.
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt");
  const confere = norm(typed) === norm(academy.name);

  async function apagar() {
    if (!confere || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete("/api/academy", { confirmName: typed });
      /*
       * A seguir não há consola para onde voltar.
       *
       * A sessão limpa-se e sai-se para a página da marca: recarregar a consola
       * daria um arranque falhado contra uma academia que já não existe, e um
       * ecrã de erro é a pior forma de terminar uma decisão destas.
       */
      clearSession();
      window.location.href = "https://academias.pt";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível apagar o clube.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Apagar o clube"
      subtitle="Esta acção não tem volta"
      onClose={onClose}
      width={520}
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-outline" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="ctl-risk" onClick={() => void apagar()} disabled={!confere || busy}>
            {busy ? "A apagar…" : "Apagar definitivamente"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5 p-5">
        <div className="flex gap-2.5 rounded-[var(--radius-control)] bg-risk-soft p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
          <div className="text-meta leading-relaxed text-risk">
            Vai desaparecer <strong>tudo</strong> o que a {academy.name} tem nesta
            plataforma: atletas e as fichas deles, famílias e os acessos à app, staff,
            sócios, mensalidades e pagamentos, boletins clínicos, treinos, avaliações,
            relatórios e fotografias.
            <span className="mt-1.5 block">
              As contas de quem trabalha no clube não são apagadas — só deixam de ter
              ligação a esta academia.
            </span>
          </div>
        </div>

        <DialogField
          label="Escreve o nome do clube para confirmar"
          hint={academy.name}
        >
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={academy.name}
            className={cx(dialogInputClass, typed && !confere && "border-risk")}
          />
        </DialogField>
      </div>
    </Dialog>
  );
}
