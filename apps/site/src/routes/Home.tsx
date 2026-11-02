import { Clubes, Fecho, Ganhos, Heroi, OQueFaz } from "@/seccoes/home";

/**
 * A página inicial: o produto, os clubes, o que faz, o que o clube ganha e o convite.
 * Os preços vivem em /planos e o inventário em /produto.
 */
export default function Home() {
  return (
    <>
      <Heroi />
      <Clubes />
      <OQueFaz />
      <Ganhos />
      <Fecho />
    </>
  );
}
