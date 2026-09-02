import { useEffect, useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Loading, cx } from "@/components/primitives";
import { TriangleAlert } from "@/lib/icons";
import { apiDelete, apiGet } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";

/** O peso da equipa, perguntado ao servidor antes de se decidir. */
type Impacto = {
  name: string;
  atletas: number;
  treinos: number;
  treinosRegistados: number;
  jogos: number;
  jogosComFicha: number;
  eventos: number;
  planos: number;
};

/**
 * Apagar uma equipa.
 *
 * ## Números, não avisos
 *
 * "Esta acção é irreversível" não informa ninguém — lê-se em todo o lado e
 * ninguém pára. O diálogo pergunta ao servidor o que a equipa tem e diz: *34
 * treinos, 12 com presenças registadas; 8 jogos, 5 com ficha preenchida*. É a
 * diferença entre avisar e informar, e é isso que faz alguém parar quando devia.
 *
 * ## E o que **não** se perde
 *
 * Dito com o mesmo destaque, porque é metade da decisão: os atletas ficam (só
 * perdem a ligação à equipa), o staff também, e as mensalidades já emitidas não
 * são tocadas. Sem isto, quem lê "vai apagar a equipa" assume o pior e não
 * apaga uma equipa de teste com medo de apagar as pessoas.
 */
export function DeleteTeamDialog({
  teamId,
  onClose,
  onDeleted,
}: {
  teamId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Impacto>(`/api/teams/${teamId}/impacto`)
      .then(setImpacto)
      .catch((e: Error) => setError(e.message));
  }, [teamId]);

  // A mesma normalização do servidor: espaços a mais e maiúsculas não são o que
  // se está a verificar — a equipa certa é.
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt");
  const confere = Boolean(impacto) && norm(typed) === norm(impacto!.name);

  async function apagar() {
    if (!confere || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/teams/${teamId}`, { confirmName: typed });

      /*
       * Sair primeiro, reler depois.
       *
       * Pela ordem contrária — `reloadAcademy()` e só então `onDeleted()` — a
       * releitura chega ao React antes da navegação: o `useSyncExternalStore`
       * do store redesenha logo, a ficha da equipa deixa de encontrar a equipa
       * que estava a mostrar e desenha "Equipa não encontrada", com este
       * diálogo já desmontado por baixo. Quem acabou de apagar via um erro no
       * lugar do sucesso, e via-o no próprio ecrã de que tinha de sair.
       *
       * Navegar primeiro põe a ordem certa: quem apaga uma equipa deixa de ter
       * assunto naquela página, e a lista para onde vai actualiza-se com a
       * releitura que vem a seguir. O "não encontrada" fica reservado para o
       * que ele diz mesmo — um id errado no URL, ou uma equipa fora do âmbito.
       */
      onDeleted();
      await reloadAcademy();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível apagar a equipa.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Apagar equipa"
      subtitle={impacto?.name}
      onClose={onClose}
      width={520}
      footer={
        <>
          {error && <span className="mr-auto text-meta text-risk">{error}</span>}
          <button type="button" className="ctl-outline" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="ctl-risk" onClick={() => void apagar()} disabled={!confere || busy}>
            {busy ? "A apagar…" : "Apagar equipa"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5 p-5">
        {!impacto ? (
          <Loading size="panel" />
        ) : (
          <>
            <div className="flex gap-2.5 rounded-[var(--radius-control)] bg-risk-soft p-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-risk" strokeWidth={1.75} />
              <div className="text-meta leading-relaxed text-risk">
                <span className="font-semibold">Vai desaparecer com a equipa:</span>
                <ul className="mt-1 space-y-0.5">
                  <li>
                    {impacto.treinos} treino{impacto.treinos === 1 ? "" : "s"}
                    {impacto.treinosRegistados > 0 && (
                      <strong> — {impacto.treinosRegistados} com presenças registadas</strong>
                    )}
                  </li>
                  <li>
                    {impacto.jogos} jogo{impacto.jogos === 1 ? "" : "s"}
                    {impacto.jogosComFicha > 0 && <strong> — {impacto.jogosComFicha} com ficha preenchida</strong>}
                  </li>
                  {impacto.eventos > 0 && <li>{impacto.eventos} outros eventos do calendário</li>}
                </ul>
                {(impacto.treinosRegistados > 0 || impacto.jogosComFicha > 0) && (
                  <p className="mt-2">
                    A assiduidade e os minutos jogados destes atletas fazem parte do registo
                    deles, e desaparecem com a equipa.
                  </p>
                )}
              </div>
            </div>

            {/* O que fica, com o mesmo destaque: é metade da decisão. */}
            <div className="rounded-[var(--radius-control)] border border-line bg-sunken/50 p-3 text-meta leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">O que não se perde:</span>
              <ul className="mt-1 space-y-0.5">
                <li>
                  {impacto.atletas} atleta{impacto.atletas === 1 ? "" : "s"} — fica
                  {impacto.atletas === 1 ? "" : "m"} no clube, sem equipa. Encontra-l
                  {impacto.atletas === 1 ? "o" : "os"} em Atletas, no filtro “Sem equipa”, para
                  {impacto.atletas === 1 ? " o" : " os"} colocar noutra.
                </li>
                <li>O staff desta equipa mantém a conta e as outras equipas</li>
                {impacto.planos > 0 && <li>As mensalidades e os valores já cobrados</li>}
                <li>Modelos de jogo e bolas paradas passam a ser do clube</li>
              </ul>
            </div>

            <DialogField label="Escreve o nome da equipa para confirmar" hint={impacto.name}>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={impacto.name}
                className={cx(dialogInputClass, typed && !confere && "border-risk")}
              />
            </DialogField>
          </>
        )}
      </div>
    </Dialog>
  );
}
