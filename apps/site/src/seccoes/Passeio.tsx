import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/marca";
import { seguir, useParado } from "@/lib/scroll";

/**
 * Um passeio pelo produto.
 *
 * A secção é alta e o conteúdo fica preso ao ecrã com `position: sticky`, que é
 * nativo: o scroll continua a ser o da pessoa. O percurso divide-se em passos
 * iguais. Cada passo troca a legenda e muda o que o aparelho mostra, e é assim
 * que quem faz scroll percorre a app sem clicar em nada.
 *
 * Com movimento reduzido pedido ao sistema, as transições desaparecem (ver
 * `brand.css`) e o progresso contínuo anda aos degraus, um por passo.
 */

export type Passo = { rotulo: string; titulo: string; texto: string };

type Props = {
  id: string;
  /** Quantos ecrãs de scroll o passeio dura. */
  ecras: number;
  passos: Passo[];
  /** "lado": legenda à esquerda e aparelho à direita. "centro": aparelho ao centro e legendas a alternar de lado. */
  variante?: "lado" | "centro";
  /** O progresso contínuo, de 0 a 1, para o que acompanha o scroll sem degraus. */
  aoAndar?: (p: number) => void;
  className?: string;
  children: (passo: number) => ReactNode;
};

export function Passeio({ id, ecras, passos, variante = "lado", aoAndar, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const parado = useParado();
  const [passo, setPasso] = useState(0);

  // A função muda a cada desenho; a inscrição no scroll não tem de mudar com ela.
  const vivo = useRef(aoAndar);
  vivo.current = aoAndar;

  const total = passos.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return seguir(el, (p) => {
      const n = Math.min(total - 1, Math.floor(p * total));
      const q = parado && total > 1 ? n / (total - 1) : p;
      setPasso(n);
      vivo.current?.(q);
    });
  }, [parado, total]);

  return (
    <div ref={ref} id={id} className={cx("passeio", `passeio-${variante}`, className)} style={{ height: `calc(${ecras + 1} * 100svh)` }}>
      <div className="passeio-preso">
        <div className="passeio-legendas">
          {passos.map((x, i) => (
            <div key={x.titulo} className="legenda" data-on={passo === i ? "" : undefined}>
              <p className="rotulo">{x.rotulo}</p>
              <h3 className="titulo t2 mt-3">{x.titulo}</h3>
              <p className="lede mt-5">{x.texto}</p>
            </div>
          ))}
        </div>

        <div className="passeio-visual">{children(passo)}</div>

        <div className="passeio-fio" aria-hidden>
          {passos.map((x, i) => (
            <i key={x.titulo} data-on={i === passo ? "" : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
