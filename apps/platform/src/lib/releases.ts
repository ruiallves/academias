import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { temReceita, estadoComercial } from "@/lib/estado";
import type { AcademyStatus } from "@/lib/types";

/**
 * Os comunicados da plataforma aos clubes.
 *
 * Escreve-se aqui, escolhem-se os clubes, e sai um email ao **responsável** de
 * cada um — a mesma pessoa que assina o contrato e recebe as cobranças.
 *
 * São de dois tipos. `NOVIDADES` é uma versão, com uma novidade por linha, e foi
 * por onde isto começou. `MENSAGEM` é um email livre, com assunto e texto, para
 * tudo o resto que se quer dizer a um clube.
 */

export type TipoDeComunicado = "NOVIDADES" | "MENSAGEM";

/** Um servidor antigo não manda o tipo: eram todos novidades. */
export const tipoDe = (r: { kind?: string | null }): TipoDeComunicado => (r.kind === "MENSAGEM" ? "MENSAGEM" : "NOVIDADES");

export type ReleaseRecipient = {
  academyId: string;
  academyName: string;
  name: string;
  email: string;
  sentAt: string | null;
  /** O motivo, quando não saiu. Nulo com `sentAt` = correu bem. */
  error: string | null;
};

export type Release = {
  id: string;
  /** Novidades de uma versão, ou uma mensagem livre. Ver `tipoDe`. */
  kind?: TipoDeComunicado;
  /** Vazia numa mensagem. */
  version: string;
  title: string;
  notes: string;
  /** Nulo = rascunho, e um rascunho ainda se edita e apaga. */
  sentAt: string | null;
  createdAt: string;
  author: string | null;
  recipients: ReleaseRecipient[];
  enviados: number;
  falhados: number;
};

/** Um clube no ecrã de escolha, com o que decide se vem pré-escolhido. */
export type Destinatario = {
  id: string;
  name: string;
  shortName: string;
  slug: string;
  status: AcademyStatus;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  /** Quem representa o clube. Nulo = não há a quem escrever. */
  responsavel: { name: string; email: string; title: string } | null;
  /** Já recebeu esta versão. */
  jaRecebeu: boolean;
};

export const createRelease = (body: { kind: TipoDeComunicado; version: string; title: string; notes: string }) =>
  apiPost<{ id: string }>("/releases", body);

export const updateRelease = (id: string, body: { version?: string; title?: string; notes?: string }) =>
  apiPatch<{ id: string }>(`/releases/${encodeURIComponent(id)}`, body);

export const deleteRelease = (id: string) => apiDelete<{ ok: true }>(`/releases/${encodeURIComponent(id)}`);

/** O email tal e qual vai sair, desenhado pelo servidor. Ver `ReleasesService.preview`. */
export type EmailPreview = {
  de: { email: string; name: string };
  para: { name: string; email: string };
  clubName: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * O corpo do pedido de pré-visualização: **estes quatro campos e mais nenhum**.
 *
 * A API recusa campos que não conhece (`forbidNonWhitelisted`), e o primeiro
 * envio mandava o objecto do ecrã inteiro, com um `releaseId` que o servidor não
 * pede. Numa versão nova o `releaseId` era `undefined` e sumia no JSON; numa
 * gravada ia, e a pré-visualização falhava com a mensagem de "o servidor ainda
 * está a receber a versão nova", que apontava para o deploy e não para o bug.
 * Escolher os campos à mão fecha a porta a que volte a acontecer com o próximo
 * campo que o ecrã ganhar. Ver `test-novidades`, que valida isto contra o DTO.
 */
export function corpoDaPreview(
  texto: { kind?: TipoDeComunicado; version: string; title: string; notes: string },
  academyId?: string,
) {
  return {
    ...(texto.kind ? { kind: texto.kind } : {}),
    version: texto.version,
    title: texto.title,
    notes: texto.notes,
    ...(academyId ? { academyId } : {}),
  };
}

export const previewRelease = (body: ReturnType<typeof corpoDaPreview>) =>
  apiPost<EmailPreview>("/releases/preview", body);

export const sendRelease = (id: string, academyIds: string[]) =>
  apiPost<{ ok: true; enviados: number; falhas: { academyId: string; name: string; reason: string }[] }>(
    `/releases/${encodeURIComponent(id)}/enviar`,
    { academyIds },
  );

/**
 * Quem vem escolhido de início: **os clubes que pagam**.
 *
 * Foi o pedido, e a regra é a que o painel já usa em todo o lado (`temReceita`:
 * a pagar ou em falta). Um clube em avaliação ou por decidir não vem escolhido —
 * mandar-lhe novidades é uma decisão comercial e não um automatismo — mas está
 * na lista a um clique.
 *
 * Fica de fora, mesmo sendo pagante, quem **não tem a quem escrever** e quem
 * **já recebeu** esta versão. O primeiro porque não há endereço; o segundo
 * porque um reenvio existe para alcançar quem faltou, e não para escrever duas
 * vezes a quem já leu.
 */
export function escolhidosPorOmissao(clubes: Destinatario[], kind: TipoDeComunicado = "NOVIDADES"): Set<string> {
  /*
   * Uma mensagem não vem com ninguém escolhido. As novidades são para os
   * clubes que usam a plataforma; uma mensagem é para quem se quiser, e a quem
   * se escreve faz parte do que se está a decidir.
   */
  if (kind === "MENSAGEM") return new Set();
  return new Set(
    clubes
      .filter((c) => c.responsavel && !c.jaRecebeu && temReceita(estadoComercial(c)))
      .map((c) => c.id),
  );
}

/**
 * As novidades como o email as vai mostrar: uma linha, uma novidade.
 *
 * Gémeo de `linhasDeNovidades` do servidor, e está aqui pela mesma razão que
 * qualquer pré-visualização existe: quem escreve tem de ver o que vai sair antes
 * de sair. Se as duas discordarem, o que manda é a do servidor — mas então a
 * pré-visualização mente, e é por isso que ambas são exercitadas pelo mesmo
 * conjunto de casos em `test-novidades.ts`.
 */
export function linhasDeNovidades(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((linha) => linha.trim().replace(/^[-*•]\s*/, "").trim())
    .filter((linha) => linha.length > 0);
}

/**
 * O texto de uma mensagem como o email o vai mostrar: uma ou mais linhas em
 * branco separam dois parágrafos, e as quebras simples ficam. Gémeo de
 * `paragrafosDoComunicado` do servidor, que é o que manda.
 */
export function paragrafosDoComunicado(notes: string): string[] {
  return notes
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).join("\n").trim())
    .filter((p) => p.length > 0);
}
