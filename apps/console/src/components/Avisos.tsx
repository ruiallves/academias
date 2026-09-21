import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, TriangleAlert, X } from "@/lib/icons";
import { avisosActuais, fecharAviso, ouvirAvisos, type Aviso } from "@/lib/avisos";
import { cx } from "./primitives";

/**
 * Os avisos, ao canto de baixo à direita.
 *
 * ## Porque é que os erros saíram de dentro dos ecrãs
 *
 * Estavam em cinquenta sítios, cada um com a sua forma: uma linha vermelha no
 * fundo de um diálogo, um parágrafo por baixo de um botão, um `span` ao lado de
 * um campo. Três problemas com isso. O primeiro é que metade deles aparecia
 * **fora da vista** — num diálogo com scroll, a frase nascia abaixo do fundo do
 * ecrã e ninguém a via. O segundo é que uma acção que muda de página não tinha
 * onde pôr o erro: o componente que o ia mostrar já não existia. O terceiro é
 * que, sendo cinquenta, nunca eram iguais.
 *
 * Um canal só, sempre no mesmo canto, resolve os três.
 *
 * ## Por cima de tudo, incluindo os primeiros passos
 *
 * O painel de "primeiros passos" vive exactamente neste canto (`z-40`), e os
 * diálogos estão em `z-50`. Um erro tem de se ler por cima dos dois — um erro
 * tapado é um erro que não existe —, e por isso isto vive acima de ambos. É a
 * única coisa da consola nesta camada.
 *
 * ## A barra de baixo
 *
 * Na cor do clube, a encolher até ao fim. Não é decoração: é a resposta à
 * pergunta "isto vai-se embora sozinho ou tenho de fazer alguma coisa?", que é
 * a primeira coisa que alguém pensa ao ver um cartão aparecer. E dá para parar
 * — com o rato em cima, a barra pára, porque ler uma frase longa não deve ser
 * uma corrida.
 */
export function Avisos() {
  const avisos = useSyncExternalStore(ouvirAvisos, avisosActuais, avisosActuais);
  if (avisos.length === 0) return null;

  return (
    <div
      /*
       * `pointer-events-none` no contentor e `auto` em cada cartão: a coluna
       * ocupa o canto todo, e sem isto um cartão de 320px de largura roubava os
       * cliques a tudo o que estivesse por baixo dele — incluindo o botão de
       * fechar do painel dos primeiros passos.
       */
      className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[360px] flex-col gap-2 max-md:inset-x-3 max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] max-md:w-auto"
      /*
       * `assertive` porque isto é quase sempre um erro a seguir a um gesto: quem
       * usa leitor de ecrã tem de o ouvir agora, e não quando acabar de ler o
       * que estava a ler.
       */
      role="log"
      aria-live="assertive"
      aria-relevant="additions"
    >
      {avisos.map((aviso) => (
        <Cartao key={aviso.id} aviso={aviso} />
      ))}
    </div>
  );
}

function Cartao({ aviso }: { aviso: Aviso }) {
  const erro = aviso.tipo === "erro";
  const [pausado, setPausado] = useState(false);

  /*
   * O tempo que falta, guardado fora do render.
   *
   * A barra é uma animação CSS e não um contador em React: um `setInterval` a
   * 60fps por cartão, a reescrever estado, era gastar trabalho de render para
   * desenhar uma linha a encolher. O que o React faz aqui é só decidir **quando**
   * o cartão sai.
   */
  const fim = useRef(0);
  const restante = useRef(aviso.duracao);
  const versaoVista = useRef(aviso.versao);

  /*
   * Um efeito só, e não dois.
   *
   * Foram dois — um a contar o tempo, outro a repor o relógio quando o mesmo
   * aviso voltava a acontecer — e não funcionava: o segundo mudava o tempo que
   * faltava, mas o `setTimeout` já estava marcado pelo primeiro e nem a versão
   * nem a duração estavam nas dependências dele. Um erro que se repetisse
   * fechava à hora do primeiro, e o reacendimento era só a animação a voltar ao
   * princípio sobre um cartão que já ia a sair.
   */
  useEffect(() => {
    const reacendeu = versaoVista.current !== aviso.versao;
    versaoVista.current = aviso.versao;
    if (reacendeu) restante.current = aviso.duracao;

    if (pausado) {
      // Guarda o que falta e pára: sem isto, tirar o rato recomeçava do
      // princípio. Um reacendimento com o rato em cima não conta o que passou —
      // acabou de voltar ao princípio, e não passou nada.
      if (!reacendeu) restante.current = Math.max(0, fim.current - Date.now());
      return;
    }

    fim.current = Date.now() + restante.current;
    const relogio = setTimeout(() => fecharAviso(aviso.id), restante.current);
    return () => clearTimeout(relogio);
  }, [aviso.id, aviso.versao, aviso.duracao, pausado]);

  return (
    <div
      className={cx(
        "pointer-events-auto relative overflow-hidden rounded-[var(--radius-panel)] border bg-surface shadow-[var(--shadow-pop)]",
        // Uma entrada curta, vinda do lado onde o cartão vive. Ver `styles.css`.
        "animate-[aviso-entra_180ms_ease-out]",
        erro ? "border-risk/40" : "border-line",
      )}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      /* Quem navega por teclado também pára: o foco no botão de fechar não pode
         ser uma corrida contra o temporizador. */
      onFocusCapture={() => setPausado(true)}
      onBlurCapture={() => setPausado(false)}
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span
          className={cx(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            erro ? "bg-risk-soft text-risk" : "bg-ok-soft text-ok",
          )}
          aria-hidden
        >
          {erro ? <TriangleAlert className="size-3.5" strokeWidth={2} /> : <Check className="size-3.5" strokeWidth={2.5} />}
        </span>

        <p className="min-w-0 flex-1 text-body leading-relaxed text-ink">
          {aviso.texto}
          {/* "e mais duas vezes" — sem isto, um erro que se repete parece um
              erro que não se repetiu, e a pessoa tenta outra vez. */}
          {aviso.repetido > 0 && (
            <span className="ml-1.5 text-meta text-ink-3">
              ({aviso.repetido + 1}×)
            </span>
          )}
        </p>

        <button
          type="button"
          onClick={() => fecharAviso(aviso.id)}
          className="ctl-ghost -mt-0.5 -mr-1 size-7 shrink-0 justify-center px-0 text-ink-4 hover:text-ink"
          aria-label="Fechar aviso"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      {/*
        A linha do tempo, na cor do clube.

        `key` com a versão para a animação recomeçar quando o mesmo aviso volta a
        acontecer. `animation-play-state` é o que a pára com o rato em cima — e
        pará-la é o que permite ler uma frase longa sem pressa.
      */}
      <span
        key={aviso.versao}
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[3px] origin-left animate-[aviso-tempo_linear_forwards]"
        style={{
          background: "var(--color-signal)",
          animationDuration: `${aviso.duracao}ms`,
          animationPlayState: pausado ? "paused" : "running",
        }}
      />
    </div>
  );
}
