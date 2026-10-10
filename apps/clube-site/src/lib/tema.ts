import type { CSSProperties } from "react";
import { signalVars } from "@academia/ui/tokens";

/**
 * As variáveis CSS da cor do clube, prontas para um `style={}`.
 *
 * A mesma função que a consola e a app usam (`signalVars`), para a tinta por
 * cima da cor, o tom como texto e a linha de foco serem calculados da mesma
 * maneira em todo o lado. Um clube amarelo lê-se aqui como lá. Os dois
 * layouts são claros, por isso a conta é a mesma nos dois.
 */
export function estiloDoClube(signalColor: string): CSSProperties {
  return signalVars(signalColor) as CSSProperties;
}
