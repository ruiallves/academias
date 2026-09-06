import { Link } from "react-router-dom";
import { Reveal } from "@/components/primitives";
import { Precos } from "@/sections/Precos";
import { Perguntas } from "@/sections/trust";
import { MODULES } from "@/lib/content";

/**
 * Planos.
 *
 * A página da **decisão**: os preços, a tabela do que muda entre os dois
 * planos, e as perguntas todas. A pergunta que sobra depois de ver os preços é
 * sempre a mesma — "e a app do clube, está no primeiro?" — e a tabela
 * responde-lhe sem obrigar ninguém a reler as listas.
 */
export default function Planos() {
  return (
    <>
      <Precos compact />

      {/* A tabela de decisão — na mesma caixa larga da mesa dos preços, que
          fica logo acima: duas larguras diferentes na mesma página lêem-se como
          desalinhamento, não como intenção. */}
      <section className="band-tight bg-paper-2">
        <div className="wrap-wide">
          <Reveal>
            <h2 className="display d3">O que muda entre os dois</h2>
          </Reveal>

          <Reveal i={1}>
            <div className="canto-sm mt-8 overflow-x-auto border border-line-2 bg-chalk">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line-2">
                    <th className="py-4 pr-4 pl-6 text-[12px] font-[650] tracking-[0.12em] text-ink-3 uppercase">
                      Módulo
                    </th>
                    <th className="w-[120px] py-4 text-center text-[12px] font-[650] tracking-[0.12em] text-ink-3 uppercase">
                      Consola
                    </th>
                    <th className="w-[140px] py-4 text-center text-[12px] font-[650] tracking-[0.12em] text-field uppercase">
                      Connect
                    </th>
                    <th className="w-[140px] py-4 text-center text-[12px] font-[650] tracking-[0.12em] text-ink-3 uppercase">
                      Vision
                      <span className="mt-1 block text-[10px] font-medium tracking-[0.08em] normal-case">
                        brevemente
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m.key} className="border-b border-line last:border-b-0">
                      <td className="py-3.5 pr-4 pl-6">
                        <p className="text-[15.5px] font-medium">{m.name}</p>
                        <p className="hidden text-[13.5px] text-ink-3 sm:block">{m.line}</p>
                      </td>
                      <td className="py-3.5 text-center">
                        <Cell on={!m.paidTier} />
                      </td>
                      <td className="py-3.5 text-center">
                        <Cell on />
                      </td>
                      {/* O Vision é o Connect mais a IA: tudo o que lá está, está aqui. */}
                      <td className="py-3.5 text-center">
                        <Cell on />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-line">
                    <td className="py-3.5 pr-4 pl-6">
                      <p className="text-[15.5px] font-medium">Página pública de adesão a sócio</p>
                      <p className="hidden text-[13.5px] text-ink-3 sm:block">O clube recebe inscrições online.</p>
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on={false} />
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on />
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on />
                    </td>
                  </tr>
                  {/*
                    A única linha da tabela que ainda não existe — e por isso o
                    sinal é outro. Um ponto cheio ao lado de "análise de vídeo"
                    seria dizer que já se compra; o anel diz "vem, não está cá".
                  */}
                  <tr>
                    <td className="py-3.5 pr-4 pl-6">
                      <p className="text-[15.5px] font-medium">Academias AI — análise de vídeo</p>
                      <p className="hidden text-[13.5px] text-ink-3 sm:block">
                        O jogo gravado vira números, com a confiança à vista.
                      </p>
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on={false} />
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on={false} />
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on soon />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Reveal>

          <Reveal i={2}>
            <p className="mt-6 max-w-[60ch] text-[14.5px] leading-relaxed text-ink-2">
              Na prática: a <span className="font-semibold text-ink">Consola</span> resolve o clube por dentro. O{" "}
              <span className="font-semibold text-ink">Connect</span> acrescenta as duas coisas que as famílias e os
              sócios vêem — a app do clube e os pagamentos. Quase todos os clubes acabam no segundo; começa no que
              fizer sentido e muda quando quiseres. O <span className="font-semibold text-ink">Vision</span> é o passo
              a seguir e ainda não se vende — fica aqui para saberes para onde é que a plataforma vai antes de
              escolheres.
            </p>
          </Reveal>
        </div>
      </section>

      {/* As perguntas todas — é aqui que se compram respostas. */}
      <Perguntas />

      <section className="dark">
        <div className="wrap band-tight flex flex-wrap items-center justify-between gap-8">
          <p className="display d3 max-w-[22ch]">Trinta dias com tudo, para veres com o teu clube lá dentro.</p>
          <Link to="/contactos" className="btn btn-primary">
            Começar gratuitamente
            <span aria-hidden className="arr">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}

/**
 * Um sinal, não um emoji: ponto cheio para incluído, traço para não incluído —
 * e **anel** para o que vem mas ainda não está cá. O terceiro estado existe
 * porque a tabela ganhou um plano por sair: pintá-lo com o mesmo ponto dos
 * outros era vender hoje o que só abre em 2027.
 */
function Cell({ on, soon = false }: { on: boolean; soon?: boolean }) {
  if (on && soon) {
    return <span aria-label="Brevemente" className="inline-block size-2 rounded-full border border-field" />;
  }
  return on ? (
    <span aria-label="Incluído" className="inline-block size-2 rounded-full bg-field" />
  ) : (
    <span aria-label="Não incluído" className="inline-block h-px w-3 bg-line-2 align-middle" />
  );
}
