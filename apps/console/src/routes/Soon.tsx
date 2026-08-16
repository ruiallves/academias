import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Panel } from "@/components/primitives";
import { ArrowRight, Sparkle } from "@/lib/icons";

/**
 * Destino honesto para as fichas de detalhe (atleta, equipa, treinador).
 *
 * A alternativa seria não ligar nada — e uma tabela cujas linhas não abrem ensina o
 * utilizador a não clicar. Preferimos dizer o que falta e onde está no plano, em vez
 * de encher o produto com ecrãs meio feitos para parecer completo.
 */
export default function Soon({ title, phase }: { title: string; phase: string }) {
  const { pathname } = useLocation();

  return (
    <>
      <PageHeader title={title} subtitle={phase} />
      <Panel>
        <div className="px-5 py-20">
          <Empty
            icon={Sparkle}
            title="Ainda não construído"
            detail="A fundação — permissões, âmbito, dados e desenho — já suporta este ecrã. Fica para a fase em que é preciso."
          >
            <Link to="/" className="ctl-outline gap-1">
              Voltar à visão geral
              <ArrowRight className="size-3.5" strokeWidth={1.75} />
            </Link>
          </Empty>
          <p className="mt-6 text-center font-mono text-meta text-ink-4">{pathname}</p>
        </div>
      </Panel>
    </>
  );
}
