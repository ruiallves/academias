import { Link } from "react-router-dom";
import { Seta } from "@/components/marca";
import { Precos } from "@/seccoes/Precos";
import { FAQ, MODULES } from "@/lib/content";

/**
 * Planos.
 *
 * A página da decisão: os preços, a tabela do que muda entre os planos e as
 * perguntas todas. A pergunta que sobra depois de ver os preços é quase sempre
 * "e a app do clube, está no primeiro?", e a tabela responde-lhe.
 */
export default function Planos() {
  return (
    <>
      <Precos pagina />

      <section className="palco-cal faixa-curta">
        <div className="wrap">
          <h2 className="titulo t2">O que muda entre os planos</h2>

          <div className="mt-8 overflow-x-auto border border-fio-2 bg-sup">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-fio-2">
                  <th className="rotulo py-4 pr-4 pl-6 font-normal text-texto-3">Módulo</th>
                  <th className="rotulo w-[110px] py-4 text-center font-normal text-texto-3">Consola</th>
                  <th className="rotulo w-[110px] py-4 text-center font-normal text-texto">Connect</th>
                  <th className="rotulo w-[130px] py-4 text-center font-normal text-texto-3">
                    Vision AI
                    <span className="block normal-case">em breve</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {MODULES.map((m) => (
                  <tr key={m.key} className="border-b border-fio">
                    <td className="py-3.5 pr-4 pl-6">
                      <p className="font-semibold">{m.name}</p>
                      <p className="hidden text-[0.88rem] text-texto-3 sm:block">{m.line}</p>
                    </td>
                    <td className="py-3.5 text-center">
                      <Sinal on={!m.paidTier} />
                    </td>
                    <td className="py-3.5 text-center">
                      <Sinal on />
                    </td>
                    <td className="py-3.5 text-center">
                      <Sinal on />
                    </td>
                  </tr>
                ))}
                {/* A única linha que ainda não existe leva outro sinal: um anel, e não um ponto cheio. */}
                <tr>
                  <td className="py-3.5 pr-4 pl-6">
                    <p className="font-semibold">Análise de vídeo</p>
                    <p className="hidden text-[0.88rem] text-texto-3 sm:block">
                      O jogo gravado vira números, com a confiança à vista. Cobrado por análises.
                    </p>
                  </td>
                  <td className="py-3.5 text-center">
                    <Sinal on={false} />
                  </td>
                  <td className="py-3.5 text-center">
                    <Sinal on={false} />
                  </td>
                  <td className="py-3.5 text-center">
                    <Sinal on breve />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="corpo mt-6 text-[0.95rem]">
            A Consola resolve o clube por dentro. O Connect acrescenta o que as famílias e os sócios veem: a app do clube
            e os pagamentos. Podes começar num e mudar para o outro quando quiseres.
          </p>
        </div>
      </section>

      <section id="perguntas" className="palco-cal faixa scroll-mt-(--topo)">
        <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-20">
          <h2 className="titulo t2 max-w-[10ch]">Perguntas.</h2>
          <div className="border-b border-fio">
            {FAQ.map((f) => (
              <details key={f.q} className="pergunta">
                <summary>
                  <span className="titulo t4">{f.q}</span>
                  <span aria-hidden className="mais text-texto-3">
                    +
                  </span>
                </summary>
                <p className="corpo pb-6">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bloco palco-noite mb-[clamp(8px,1.2vw,20px)]">
        <div className="wrap faixa-curta flex flex-wrap items-center justify-between gap-8">
          <p className="titulo t2 max-w-[20ch]">Trinta dias com tudo, com o teu clube lá dentro.</p>
          <Link to="/contactos" className="btn btn-cheio">
            Começar
            <Seta />
          </Link>
        </div>
      </section>
    </>
  );
}

/** Ponto cheio para incluído, traço para não incluído, anel para o que vem mas ainda não está cá. */
function Sinal({ on, breve = false }: { on: boolean; breve?: boolean }) {
  if (on && breve) return <span aria-label="Em breve" className="inline-block size-2.5 rounded-full border-2 border-texto" />;
  return on ? (
    <span aria-label="Incluído" className="inline-block size-2.5 rounded-full bg-texto" />
  ) : (
    <span aria-label="Não incluído" className="inline-block h-px w-3 bg-fio-2 align-middle" />
  );
}
