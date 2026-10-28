/**
 * Os botões da loja: altos, quase retos, em maiúsculas curtas, como nas lojas
 * de equipamento. O principal é a tinta (preto), e não a cor do clube: lê-se
 * bem com qualquer cor de clube, e a cor fica para os acentos.
 */
const base =
  "inline-flex h-14 items-center justify-center gap-2 rounded-[3px] px-7 text-[0.875rem] font-bold uppercase tracking-[0.06em] whitespace-nowrap transition-[background-color,color,border-color,transform] duration-200 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

export const botaoLoja = `${base} bg-ink text-canvas hover:bg-ink-2`;
export const botaoLojaContorno = `${base} border border-ink text-ink hover:bg-ink hover:text-canvas`;
