import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { temReceita, estadoComercial } from "@/lib/estado";
import type { AcademyStatus } from "@/lib/types";

/**
 * As novidades da plataforma, contadas aos clubes.
 *
 * Uma versão escreve-se aqui, escolhem-se os clubes, e sai um email ao
 * **responsável** de cada um — a mesma pessoa que assina o contrato e recebe as
 * cobranças.
 */

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

export const createRelease = (body: { version: string; title: string; notes: string }) =>
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

export const previewRelease = (body: { version: string; title: string; notes: string; academyId?: string }) =>
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
export function escolhidosPorOmissao(clubes: Destinatario[]): Set<string> {
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
