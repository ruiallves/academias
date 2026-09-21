import { useState } from "react";
import { Download } from "@/lib/icons";
import { cx } from "@/components/primitives";

/**
 * "Exportar" numa ficha de pessoa.
 *
 * Um botão e não um diálogo: não há nada a escolher — a ficha em papel é a ficha
 * que está no ecrã, e perguntar "que secções quer?" seria dar trabalho a quem só
 * quer o PDF.
 *
 * O que faz é esperar. Gerar o documento lê a fotografia e o emblema da rede e
 * pede o histórico ao servidor; num telemóvel são dois ou três segundos em que
 * nada acontece, e sem estado de espera a pessoa carrega outra vez e leva dois
 * ficheiros. O erro fica por baixo do botão, porque um `alert` a meio de uma
 * exportação é pior do que a falha.
 */
export function BotaoExportarPerfil({
  exportar,
  className,
}: {
  exportar: () => Promise<void>;
  className?: string;
}) {
  const [aGerar, setAGerar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    if (aGerar) return;
    setAGerar(true);
    setErro(null);
    try {
      await exportar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setAGerar(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button type="button" className={cx("ctl-ghost", className)} disabled={aGerar} onClick={() => void carregar()}>
        <Download className="size-3.5" strokeWidth={1.75} />
        {aGerar ? "A gerar…" : "Exportar"}
      </button>
      {erro && (
        <span className="absolute top-full right-0 mt-1 whitespace-nowrap text-meta text-risk">{erro}</span>
      )}
    </span>
  );
}
