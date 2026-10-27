import type { NotificationType } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { formatarNoFuso, horaNoFuso } from "../common/fuso";
import { pesoDoTitulo } from "./head-coaches";

/**
 * O aviso que chega ao treinador quando uma família diz que o atleta não vai.
 *
 * ## Porque é que existe
 *
 * A família avisava pela app, o aviso ficava gravado e ninguém do clube sabia.
 * O treinador só o via ao abrir as presenças, depois do treino: foi a queixa do
 * Santa Maria FC a 27/10/2026, nos benjamins. A app dizia "avisa o treinador por
 * aqui" e o treinador não recebia nada.
 *
 * ## Quem recebe
 *
 * Quem treina a equipa: as linhas da equipa técnica cujo título diz treinador
 * (a regra de `pesoDoTitulo`, a mesma que escolhe o treinador principal), mais o
 * treinador marcado no próprio treino ou jogo. O delegado e a médica não: um
 * aviso de falta é trabalho de quem monta o treino.
 *
 * Quem avisou fica de fora. Um treinador que também é pai e avisa pelo filho não
 * precisa de ser avisado do que acabou de dizer.
 */
export type LinhaDaEquipaTecnica = { title: string; userId: string };

export function destinatarios(
  equipaTecnica: LinhaDaEquipaTecnica[],
  treinadorMarcado: string | null,
  quemAvisou: string,
): string[] {
  const ids = new Set<string>();
  for (const l of equipaTecnica) if (pesoDoTitulo(l.title) > 0) ids.add(l.userId);
  if (treinadorMarcado) ids.add(treinadorMarcado);
  ids.delete(quemAvisou);
  return [...ids];
}

/** Os treinadores desta equipa, prontos a avisar. Só leitura: corre dentro do `runAs`. */
export async function treinadoresAAvisar(
  db: ScopedClient,
  teamId: string,
  coachMembershipId: string | null,
  quemAvisou: string,
): Promise<string[]> {
  const equipa = await db.teamStaff.findMany({
    where: { teamId, leftAt: null, membership: { isActive: true } },
    select: { title: true, membership: { select: { userId: true } } },
  });
  const marcado = coachMembershipId
    ? await db.membership.findFirst({ where: { id: coachMembershipId, isActive: true }, select: { userId: true } })
    : null;
  return destinatarios(
    equipa.map((l) => ({ title: l.title, userId: l.membership.userId })),
    marcado?.userId ?? null,
    quemAvisou,
  );
}

/** "terça-feira, 28 de outubro às 18:30", na hora do clube. */
export function quando(instante: Date): string {
  return `${formatarNoFuso(instante, { weekday: "long", day: "numeric", month: "long" })} às ${horaNoFuso(instante)}`;
}

export type Aviso = {
  atleta: string;
  equipa: string;
  inicio: Date;
  /** Nulo quando a família voltou atrás: afinal vai. */
  motivo: string | null;
} & ({ evento: "treino" } | { evento: "jogo"; adversario: string });

/** O título e o texto da notificação. Puro, para se poder testar sem base. */
export function textoDoAviso(a: Aviso): { title: string; body: string } {
  const onde = a.evento === "treino" ? "ao treino" : "ao jogo";
  const title = a.motivo === null ? `${a.atleta} afinal vai ${onde}` : `${a.atleta} não vai ${onde}`;
  const partes = [
    a.evento === "treino" ? a.equipa : `${a.equipa} com ${a.adversario}`,
    quando(a.inicio),
    a.motivo,
  ].filter((p): p is string => Boolean(p));
  return { title, body: partes.join(" · ") };
}

/**
 * O aviso a quem passa a dar um treino, ou deixa de o dar.
 *
 * Nunca vai ao treinador principal: o treino é dele por omissão, e ele sabe que
 * o dá (pedido do Rui, 27/10/2026). Vai a quem foi escolhido no lugar dele, que
 * de outra forma só o descobria a olhar para o calendário, e a quem foi tirado,
 * para não aparecer no campo para nada.
 *
 * Numa série de treinos sai **um** aviso, não um por treino: vinte e dois pushes
 * seguidos a dizer a mesma coisa ensinavam a ignorá-los.
 */
export type AvisoDeQuemDa = {
  equipa: string;
  inicio: Date;
  local?: string | null;
  /** Numa série: quantos treinos, e o último. */
  total?: number;
  ultimo?: Date;
  /** Deixou de o dar: quem fica com ele. */
  saiu?: { para: string | null };
};

export function textoDeQuemDa(a: AvisoDeQuemDa): { title: string; body: string } {
  if (a.saiu) {
    return {
      title: "Já não dás este treino",
      body: [a.equipa, quando(a.inicio), a.saiu.para ? `Passou para ${a.saiu.para}` : null]
        .filter((p): p is string => Boolean(p))
        .join(" · "),
    };
  }
  if (a.total && a.total > 1 && a.ultimo) {
    const ate = formatarNoFuso(a.ultimo, { day: "numeric", month: "long" });
    return {
      title: `Vais dar ${a.total} treinos`,
      body: `${a.equipa} · a partir de ${quando(a.inicio)}, até ${ate}`,
    };
  }
  return {
    title: "Vais dar um treino",
    body: [a.equipa, quando(a.inicio), a.local].filter((p): p is string => Boolean(p)).join(" · "),
  };
}

/**
 * Envia, um a um, e nunca falha para quem chamou.
 *
 * Corre **depois** da transação (ver `NotificationsService.enqueue`). O aviso da
 * família já está gravado; um push que falha, ou um tipo de notificação que a
 * base ainda não conhece por a migração não ter corrido, não pode desfazer isso
 * nem devolver erro ao pai.
 */
export async function avisarTreinadores(
  notifications: NotificationsService,
  academyId: string,
  userIds: string[],
  type: Extract<NotificationType, "ABSENCE_NOTICED" | "CALLUP_DECLINED" | "TRAINING_COACH_ASSIGNED">,
  texto: { title: string; body: string },
  link: string,
  aoFalhar: (erro: unknown) => void,
): Promise<void> {
  for (const userId of userIds) {
    await notifications
      .enqueue({ academyId, userId, type, title: texto.title, body: texto.body, payload: { link } })
      .catch(aoFalhar);
  }
}
