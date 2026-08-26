import { Campo, Hero, Realidade } from "@/sections/top";
import { Pagamentos, Tour } from "@/sections/product";
import { Fecho, Seguranca } from "@/sections/trust";
import { Precos } from "@/sections/Precos";

/**
 * A página.
 *
 * Sete andamentos, cada um com a sua respiração — não doze secções com a mesma
 * estrutura. O herói mostra o produto antes de qualquer argumento; a seguir,
 * quatro linhas com o clube tal como ele é hoje, que é a única coisa que quem
 * chega já reconhece; o tour condensa o produto num sítio só; pagamentos e
 * segurança fecham as duas objecções reais; a nota assume que isto é novo — que
 * é o que uma página sem clientes tem de fazer em vez de fingir escala — e o
 * preço vem no fim, quando já se sabe o que se está a comprar.
 *
 * O que saiu daqui não desapareceu: o inventário completo vive em /software,
 * as perguntas em /planos. A homepage vende a vista, não o manual.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <Realidade />
      <Campo />
      <Tour />
      <Pagamentos />
      <Seguranca />
      <Precos />
      <Fecho />
    </>
  );
}
