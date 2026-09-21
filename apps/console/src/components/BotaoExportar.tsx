import { useState } from "react";
import { Download } from "@/lib/icons";
import { exportarParaExcel, type ColunaExport } from "@/lib/exportar";

/**
 * "Exportar" — o mesmo botão em todas as listas.
 *
 * ## Porque é que é um componente e não um botão por página
 *
 * Porque são cinco listas, e cinco botões escritos à mão davam cinco estados
 * de ocupado diferentes, cinco maneiras de falhar em silêncio e cinco nomes de
 * ficheiro. O que muda de lista para lista são as **colunas** e o **nome do
 * ficheiro**; tudo o resto é igual, e por isso vive aqui.
 *
 * ## O que exporta é o que está no ecrã
 *
 * As linhas chegam já filtradas por quem chama. É a leitura certa: quem filtrou
 * a lista pelos Sub-13 e carrega em Exportar quer os Sub-13, não o clube todo.
 * A alternativa — exportar sempre tudo — obrigava a explicar num rodapé porque
 * é que o ficheiro tem mais linhas do que a tabela.
 *
 * ## Um erro aqui aparece
 *
 * Escrever um ficheiro pode falhar (memória, um bloqueador de transferências), e
 * um botão que não faz nada é indistinguível de um botão avariado. A frase fica
 * ao lado, e desaparece à tentativa seguinte.
 */
export function BotaoExportar<T>({
  linhas,
  colunas,
  ficheiro,
  folha,
  rotulo = "Exportar",
}: {
  linhas: T[];
  colunas: ColunaExport<T>[];
  /** Sem extensão nem data — a data entra sozinha. Ver `exportarParaExcel`. */
  ficheiro: string;
  /** O nome do separador dentro do Excel. */
  folha: string;
  rotulo?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar() {
    if (busy || linhas.length === 0) return;
    setBusy(true);
    setErro(null);
    try {
      await exportarParaExcel(linhas, colunas, { ficheiro, folha });
    } catch {
      setErro("Não foi possível criar o ficheiro.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ctl-outline"
        onClick={() => void exportar()}
        /* Uma lista vazia não dá um ficheiro vazio: dá um botão apagado, que
           diz a mesma coisa sem fazer descarregar nada. */
        disabled={busy || linhas.length === 0}
        title={linhas.length === 0 ? "Nada para exportar" : `Exportar ${linhas.length} para Excel`}
      >
        <Download className="size-3.5" strokeWidth={1.75} />
        {busy ? "A exportar…" : rotulo}
      </button>
      {erro && (
        <span role="alert" className="text-meta text-risk">
          {erro}
        </span>
      )}
    </>
  );
}
