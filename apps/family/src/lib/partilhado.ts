import type { CSSProperties } from "react";

/**
 * O cartão que se transforma no cabeçalho do ecrã que abre.
 *
 * Tocar no próximo jogo no Início, ou numa linha da Agenda, e ver esse cartão
 * crescer até ser o título do ecrã do jogo é o que mais faz uma app parecer
 * nativa — e com a View Transitions API custa só dar o **mesmo nome** aos dois
 * elementos (`view-transition-name`), o cartão de um lado e o cabeçalho do
 * outro. O browser faz o resto. Ver `Ecras.tsx`.
 *
 * O nome tem de ser único no ecrã: numa lista com dez cartões, só o que foi
 * tocado o leva. Guarda-se o destino do último toque (o `href`), e o cartão
 * cujo destino é esse veste o nome — ao ir, para o browser saber de onde parte;
 * e ao voltar, para saber onde aterra. Os cabeçalhos dos ecrãs de detalhe
 * vestem-no sempre, porque num ecrã de detalhe só há um.
 *
 * Quando se sai por outro caminho (do Início para os Pagamentos, com o cartão
 * ainda a vestir o nome), o cartão desliza com o resto do ecrã: o CSS trata os
 * grupos "sozinhos" (`:only-child`) como parte do fundo.
 */

const NOME = "partilhado";

let aberto: string | null = null;

/** No toque que abre o detalhe: o cartão com este destino passa a ser o partilhado. */
export function abrirPartilhado(href: string): void {
  aberto = href;
}

/** O estilo do cartão de uma lista: leva o nome só se foi o último a abrir. */
export function estiloDoCartao(href: string): CSSProperties | undefined {
  return aberto === href ? { viewTransitionName: NOME } : undefined;
}

/** O estilo do cabeçalho de um ecrã de detalhe — o outro lado da transformação. */
export const ESTILO_DO_CABECALHO: CSSProperties = { viewTransitionName: NOME };
