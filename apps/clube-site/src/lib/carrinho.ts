"use client";

import { useSyncExternalStore } from "react";
import { VAZIO, ler, subscrever, type Carrinho } from "./loja";

/**
 * O carrinho deste clube, para os componentes do browser. À parte de
 * `lib/loja.ts` porque esse é importado também por componentes de servidor
 * (`CartaoProduto`), e um hook do React lá dentro partia a página de início.
 *
 * No servidor é vazio: o número só aparece depois de hidratar.
 */
export function useCarrinho(slug: string): Carrinho {
  return useSyncExternalStore(
    subscrever,
    () => ler(slug),
    () => VAZIO,
  );
}
