/**
 * Telemóveis: como se comparam e quando chegam.
 *
 * Guardam-se como a pessoa os escreveu; comparam-se só pelos algarismos, sem o
 * indicativo de Portugal ("+351 912 345 678" e "912345678" são o mesmo).
 */
export function digitosDoTelefone(t: string | null | undefined): string {
  return (t ?? "").replace(/\D/g, "").replace(/^(00351|351)(?=\d{9}$)/, "");
}

/** Nove algarismos no mínimo (um número português), quinze no máximo (o limite internacional). */
export function telefoneValido(t: string | null | undefined): boolean {
  const d = digitosDoTelefone(t);
  return d.length >= 9 && d.length <= 15 && /^[+\d\s().\-/]+$/.test((t ?? "").trim());
}
