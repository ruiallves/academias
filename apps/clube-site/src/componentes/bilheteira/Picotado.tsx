/**
 * O picotado de um bilhete: a linha tracejada por onde se destaca o canhoto,
 * com um recorte redondo em cada ponta. Os recortes são círculos da cor do
 * fundo da página por cima da borda do cartão, por isso o cartão tem de ter
 * `overflow-hidden` e `fundo` tem de ser a cor que está por trás dele.
 *
 * - `responsivo` (por omissão): deitado no telemóvel, de pé a partir de `sm`,
 *   para um cartão que é coluna no telemóvel e linha no ecrã largo.
 * - `deitado`: sempre na horizontal, entre duas partes empilhadas.
 */
export function Picotado({ fundo = "bg-canvas", orientacao = "responsivo", margem = "mx-5 sm:my-5" }: { fundo?: string; orientacao?: "responsivo" | "deitado"; margem?: string }) {
  if (orientacao === "deitado") {
    return (
      <div aria-hidden className="relative mx-5 border-t-2 border-dashed border-line">
        <span className={`absolute -left-8 -top-3 size-6 rounded-full ${fundo}`} />
        <span className={`absolute -right-8 -top-3 size-6 rounded-full ${fundo}`} />
      </div>
    );
  }
  return (
    <div aria-hidden className={`relative shrink-0 border-t-2 border-dashed border-line sm:mx-0 sm:border-l-2 sm:border-t-0 ${margem}`}>
      <span className={`absolute -left-8 -top-3 size-6 rounded-full sm:-left-[13px] sm:-top-8 ${fundo}`} />
      <span className={`absolute -right-8 -top-3 size-6 rounded-full sm:-bottom-8 sm:-left-[13px] sm:right-auto sm:top-auto ${fundo}`} />
    </div>
  );
}
