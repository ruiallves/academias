import { Clubes, Fecho, Ganhos, Heroi, OQueFaz } from "@/seccoes/home";

/**
 * A página inicial: o produto, os clubes, o que faz, o que o clube ganha e o convite.
 * Os preços vivem em /planos e o inventário em /produto. O assistente com IA é um
 * separador de "O que a Academias faz" e tem página própria; uma secção só dele
 * aqui foi recusada pelo Rui (12/11/2026).
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
