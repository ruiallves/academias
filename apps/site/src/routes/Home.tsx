import { Hero, Sistema } from "@/sections/top";
import { Consola, Familias, Pagamentos, Scouting, Socios, Treinador } from "@/sections/product";
import { Fecho, Perguntas, Roteiro, Seguranca } from "@/sections/trust";
import { Precos } from "@/sections/Precos";

/**
 * A página.
 *
 * A ordem é um argumento, não uma lista de secções: primeiro o alívio (herói),
 * depois o sistema que o explica. Só então o produto — gestão, equipa técnica,
 * famílias, pagamentos, scouting, sócios — e por fim as três coisas que fecham uma
 * venda a um clube: segurança, honestidade sobre o que falta, e preço.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <Sistema />
      <Consola />
      <Treinador />
      <Familias />
      <Pagamentos />
      <Scouting />
      <Socios />
      <Seguranca />
      <Roteiro />
      <Precos />
      <Perguntas />
      <Fecho />
    </>
  );
}
