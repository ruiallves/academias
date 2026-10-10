import type { Clube, Equipa, Jogo, Noticia, Produto } from "@/dados/tipos";

/** O que a página de início recebe, em qualquer layout. */
export type DadosInicio = {
  clube: Clube;
  noticias: Noticia[];
  proximo: Jogo | null;
  ultimo: Jogo | null;
  equipas: Equipa[];
  produtos: Produto[];
};
