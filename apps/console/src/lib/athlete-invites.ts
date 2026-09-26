import { apiDelete, apiPost } from "@/lib/http";

/**
 * O convite da app a um atleta — o mesmo desenho dos sócios (`lib/members.ts`).
 *
 * O botão da ficha manda um; a lista manda a vários e recebe a contagem por
 * motivo; desligar tira a ligação quando a ficha se colou à pessoa errada.
 */

/**
 * (Re)enviar o convite — a resposta traz o email para a consola o dizer.
 *
 * `linked` diz que **não saiu convite nenhum**: a conta daquele email já existia
 * neste clube e a ficha ligou-se a ela na hora. É o caminho normal de quem já
 * entrou uma vez na app, e a consola tem de dizer qual das duas coisas fez.
 */
export const inviteAthlete = (id: string) =>
  apiPost<{ ok: true; linked?: boolean; email: string }>(`/api/athletes/${encodeURIComponent(id)}/convite`, {});

/** A vários de uma vez — a acção em massa da lista de atletas. */
export const inviteAthletes = (ids: string[]) =>
  apiPost<{
    ok: true;
    enviados: number;
    /** Quantos não precisaram de convite: a conta já existia e a ficha ligou-se. */
    ligados: number;
    falhas: { id: string; reason: string }[];
  }>("/api/athletes/convites", { ids });

/** Desligar a conta da ficha. Não apaga o atleta nem a conta. */
export const unlinkAthleteAccount = (id: string) =>
  apiDelete<{ ok: true }>(`/api/athletes/${encodeURIComponent(id)}/conta`);
