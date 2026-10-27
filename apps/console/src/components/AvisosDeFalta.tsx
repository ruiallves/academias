import { athleteById } from "@/lib/api";
import type { AbsenceNotice } from "@/data/types";
import { cx } from "./primitives";

/**
 * Quem avisou pela app que não vem a um treino, e porquê.
 *
 * ## Porque é que se mostra antes do treino
 *
 * Os avisos só apareciam nas presenças, depois de o treino começar. O treinador
 * do Santa Maria FC preparou o treino a contar com um miúdo que a mãe já tinha
 * dito que não ia (27/10/2026). Agora aparecem onde o treinador olha antes de
 * treinar: na lista dos treinos a seguir, nos treinos por planear e no plano.
 *
 * Os nomes e os motivos vão escritos por extenso, e não escondidos atrás de um
 * número: é isso que muda o treino que se prepara, e um número obriga a abrir
 * outra coisa para saber quem é.
 */
export function AvisosDeFalta({ notices, className }: { notices?: AbsenceNotice[]; className?: string }) {
  if (!notices || notices.length === 0) return null;

  const linhas = notices
    .map((n) => ({ ...n, nome: athleteById(n.athleteId)?.name ?? "Atleta" }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));

  return (
    /* `span` em bloco e não `div`: vive dentro de linhas que são botões. */
    <span className={cx("block text-meta leading-relaxed", className)}>
      <span className="font-medium text-risk">{linhas.length === 1 ? "Não vem: " : `Não vêm (${linhas.length}): `}</span>
      {linhas.map((l, i) => (
        <span key={l.athleteId}>
          {i > 0 && <span className="text-ink-4"> · </span>}
          <span className="font-medium text-ink">{l.nome}</span>
          {l.reason && <span className="text-ink-3"> ({l.reason})</span>}
        </span>
      ))}
    </span>
  );
}
