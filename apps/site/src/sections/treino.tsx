import { ProductFrame, Reveal, SectionMark } from "@/components/primitives";
import { CampoTaticoShot, PlanoTreinoShot } from "@/components/shots-treino";

/**
 * Área técnica — a secção que vende o treino.
 *
 * Estava no roteiro como "Gestão de treinos, Novembro de 2026". Foi construída
 * antes do prazo, e a regra da casa é que o que existe sai do roteiro e entra na
 * montra — com a mesma honestidade nas duas direções.
 *
 * ## O que se escolheu mostrar, e porquê
 *
 * O **editor tático** primeiro e em grande: é a peça que nenhum concorrente
 * nesta gama tem, e é visual por natureza — não precisa de ser explicada, só de
 * ser vista. O **plano de sessão** a seguir, porque é onde o treinador vive
 * todas as semanas; a carga derivada e o tempo por objetivo são o argumento
 * para o coordenador, que é quem costuma decidir a compra.
 *
 * A biblioteca, os modelos de jogo e as bolas paradas vão na lista com filetes:
 * são reais e vendem, mas três molduras de produto numa secção era uma feira.
 */
export function AreaTecnica({ n }: { n?: string } = {}) {
  return (
    <section id="area-tecnica" className="band">
      <div className="wrap">
        <Reveal>
          <SectionMark n={n}>Área técnica</SectionMark>
        </Reveal>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-16">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[15ch]">
              O treino planeia-se <em>aqui</em>, não no caderno.
            </h2>
            <p className="lede mt-5">
              Uma área técnica completa dentro da consola: o exercício desenha-se num campo à escala real, o plano
              monta-se por blocos, e a carga da semana calcula-se sozinha.
            </p>

            <ul className="mt-9">
              {[
                [
                  "Um editor tático a sério",
                  "Jogadores, adversários, bolas, cones e zonas num campo com as medidas verdadeiras — futebol de 11, 9, 7 e 5, e futsal. Setas de passe, deslocamento e condução, e animação por frames para mostrar o movimento, não só a foto.",
                ],
                [
                  "Uma biblioteca que cresce com o clube",
                  "Exercícios prontos de futebol e futsal para começar, e os do treinador guardados com imagem, filtros e favoritos. Cada um importa-se para o plano num toque.",
                ],
                [
                  "Modelos de jogo e bolas paradas",
                  "O sistema desenhado, os princípios por escrito, os cantos e livres ensaiados — do treinador, ou do clube inteiro, para a metodologia sobreviver à saída de quem a criou.",
                ],
              ].map(([t, d]) => (
                <li key={t} className="border-t border-line py-5 last:border-b">
                  <p className="text-[16.5px] font-semibold tracking-[-0.02em]">{t}</p>
                  <p className="mt-1.5 max-w-[48ch] text-[15px] leading-relaxed text-ink-2">{d}</p>
                </li>
              ))}
            </ul>

            {/*
              As modalidades, com etiquetas — as vivas cheias, as que vêm a
              tracejado (`.tag-soon`). Tem de estar aqui e não numa nota de
              rodapé: as imagens desta secção são todas de futebol, e um clube
              de basquetebol que só olhe para elas conclui "não é para nós" e
              fecha a página. O futebol é por onde começámos, não onde acabamos.
            */}
            <div className="mt-8">
              <p className="eyebrow">Modalidades</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="tag tag-live">Futebol · 11</span>
                <span className="tag tag-live">Futebol · 9</span>
                <span className="tag tag-live">Futebol · 7</span>
                <span className="tag tag-live">Futebol · 5</span>
                <span className="tag tag-live">Futsal</span>
                <span className="tag tag-soon">Basquetebol · em desenvolvimento</span>
                <span className="tag tag-soon">Andebol · em desenvolvimento</span>
                <span className="tag tag-soon">Mais a caminho</span>
              </div>
            </div>
          </Reveal>

          <Reveal i={2} className="space-y-6">
            <div>
              <ProductFrame
                label="Editor tático · Pressão após perda"
                shot="/shots/treino-editor.png"
                alt="O editor tático com um exercício desenhado"
              >
                <CampoTaticoShot className="min-h-[300px]" />
              </ProductFrame>
              <p className="mt-3 text-[13.5px] text-ink-3">
                Desenhado no produto, frame a frame — funciona no tablet, à beira do campo.
              </p>
            </div>

            <ProductFrame
              label="Treinos · plano de sessão"
              shot="/shots/treino-plano.png"
              alt="O plano de uma sessão de treino com a carga estimada"
            >
              <PlanoTreinoShot className="min-h-[260px]" />
            </ProductFrame>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
