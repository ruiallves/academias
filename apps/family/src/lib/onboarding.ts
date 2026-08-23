/**
 * Se a apresentação já foi vista.
 *
 * Guardada no `localStorage` e não no servidor de propósito: a apresentação
 * ensina *esta* app neste telemóvel — instalar noutro aparelho é começar de novo,
 * e é isso que se quer. Também sobrevive a não haver sessão ainda.
 *
 * A chave leva versão. Quando a app mudar o suficiente para valer a pena
 * reapresentá-la, sobe-se o número e toda a gente vê a nova — sem código a
 * decidir quem já viu o quê.
 */

const KEY = "academia.family.onboarded.v1";

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Modo privado: a app funciona na mesma, só volta a apresentar-se.
    return false;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignorado de propósito — ver acima */
  }
}

/** Para o "Rever a apresentação" no perfil. */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorado de propósito */
  }
}
