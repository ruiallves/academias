import { AppDoClube, Ciclo, Clubes, Consola, Fecho, Ferramentas, Heroi, Numeros } from "@/seccoes/home";
import { Precos } from "@/seccoes/Precos";

/**
 * A página inicial.
 *
 * Mostra o produto a funcionar, secção a secção: o que é, quem já o usa, a consola
 * de quem trabalha no clube, a app no telemóvel das famílias, como tudo se
 * liga, os números e os planos.
 *
 * Nas duas secções do meio o aparelho fica preso ao ecrã e o scroll percorre o
 * produto. O inventário completo vive em /produto.
 */
export default function Home() {
  return (
    <>
      <Heroi />
      <Clubes />
      <Consola />
      <AppDoClube />
      <Ciclo />
      <Ferramentas />
      <Numeros />
      <Precos />
      <Fecho />
    </>
  );
}
