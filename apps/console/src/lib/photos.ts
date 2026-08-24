import { apiDelete, apiPost } from "@/lib/http";

/**
 * Carregar uma fotografia, do lado do browser.
 *
 * ## Três passos, e o do meio não passa pela nossa API
 *
 * 1. **Autorizar** — a API responde com um endereço assinado, válido para uma
 *    chave só, que ela própria escolheu.
 * 2. **Carregar** — o ficheiro vai daqui directamente para o Supabase. Atravessar
 *    imagens no processo que serve toda a gente é trabalho a mais para nada.
 * 3. **Confirmar** — a API verifica que o ficheiro chegou mesmo e grava a chave.
 *
 * O passo 3 não é cerimónia: entre o 1 e o 2 pode falhar a rede, e uma chave
 * gravada sem ficheiro por trás é uma fotografia partida em todos os ecrãs onde
 * aquela pessoa aparecer.
 *
 * ## O que se valida aqui, e porquê
 *
 * Tipo e tamanho, antes de gastar um pedido. O servidor valida na mesma — e o
 * bucket também — mas quem escolheu um ficheiro de 30 MB merece sabê-lo no
 * instante em que o escolhe, e não depois de trinta segundos a carregar.
 */

const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** 8 MB — o mesmo tecto do servidor. Gémeo de `MAX_BYTES` em `photos.service.ts`. */
const MAX_BYTES = 8 * 1024 * 1024;

type Signed = { url: string; token: string; key: string };

export class PhotoError extends Error {}

/**
 * O que o `<input type="file">` devolveu está em condições?
 *
 * Devolve a mensagem do problema, ou `null` quando está bom — a forma que deixa
 * quem chama escrever `const erro = checkPhoto(file); if (erro) …`.
 */
export function checkPhoto(file: File): string | null {
  if (!TYPES.includes(file.type)) return "A fotografia tem de ser JPEG, PNG ou WebP.";
  if (file.size > MAX_BYTES) return `A fotografia tem ${mb(file.size)} MB — o máximo são ${mb(MAX_BYTES)} MB.`;
  return null;
}

async function put(signed: Signed, file: File): Promise<void> {
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      ...(signed.token ? { Authorization: `Bearer ${signed.token}` } : {}),
    },
    body: file,
  });

  if (!res.ok) {
    // O corpo do Supabase é JSON com `message`; quando não for, o estado chega.
    const detail = await res.text().catch(() => "");
    throw new PhotoError(
      /EntityTooLarge|exceeded/i.test(detail)
        ? "O armazenamento recusou o ficheiro por ser grande de mais."
        : "Não foi possível carregar a fotografia.",
    );
  }
}

/** A fotografia de um atleta. Devolve o link assinado, já pronto para `<img src>`. */
export async function uploadAthletePhoto(athleteId: string, file: File): Promise<string | null> {
  const problema = checkPhoto(file);
  if (problema) throw new PhotoError(problema);

  const signed = await apiPost<Signed>(`/api/athletes/${athleteId}/foto/upload`, { contentType: file.type });
  await put(signed, file);
  const { photoUrl } = await apiPost<{ photoUrl: string | null }>(`/api/athletes/${athleteId}/foto`, { key: signed.key });
  return photoUrl;
}

export function removeAthletePhoto(athleteId: string) {
  return apiDelete(`/api/athletes/${athleteId}/foto`);
}

/** A de alguém do staff. `membershipId` — a pessoa **nesta** academia. */
export async function uploadStaffPhoto(membershipId: string, file: File): Promise<string | null> {
  const problema = checkPhoto(file);
  if (problema) throw new PhotoError(problema);

  const signed = await apiPost<Signed>(`/api/staff/${membershipId}/foto/upload`, { contentType: file.type });
  await put(signed, file);
  const { photoUrl } = await apiPost<{ photoUrl: string | null }>(`/api/staff/${membershipId}/foto`, { key: signed.key });
  return photoUrl;
}

export function removeStaffPhoto(membershipId: string) {
  return apiDelete(`/api/staff/${membershipId}/foto`);
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
