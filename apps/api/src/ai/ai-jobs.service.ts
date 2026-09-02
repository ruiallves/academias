import { Injectable } from "@nestjs/common";
import type { ScopedClient } from "../prisma/prisma.service";

/**
 * A fila de trabalhos da Academias AI — o lado de dentro.
 *
 * ## Porque é que a fila é uma tabela
 *
 * O stack não tem Redis nem SQS, e não vale a pena trazê-los por isto: o
 * Postgres faz uma fila correcta com `FOR UPDATE SKIP LOCKED`, os jobs ficam ao
 * lado dos dados que descrevem, e um worker novo — local ou na cloud — só
 * precisa do URL da API e de um token. O **claim** (que atravessa tenants) vive
 * em `ai-worker.service.ts`; aqui está o que se faz dentro de um contexto de
 * academia: enfileirar, encadear e manter as caches de leitura.
 *
 * ## O limiar de revisão
 *
 * Abaixo de 0.75 de confiança de identidade, um track pede um humano. O número
 * não é ciência — é o ponto de partida honesto: preferimos pedir uma confirmação
 * a mais do que escrever uma estatística no nome do atleta errado.
 */
export const REVIEW_THRESHOLD = 0.75;

/** Só tracks com tempo de jogo relevante pedem revisão — 20 s de figurante não. */
export const REVIEW_MIN_TRACK_MS = 20_000;

@Injectable()
export class AiJobsService {
  /** Enfileira um trabalho. Chamado sempre dentro de um `runAs`. */
  async enqueue(
    db: ScopedClient,
    academyId: string,
    analysisId: string,
    kind: string,
    params?: Record<string, unknown>,
    priority = 0,
  ) {
    return db.aIJob.create({
      data: {
        academyId,
        analysisId,
        kind,
        params: (params ?? {}) as object,
        priority,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  /**
   * Recalcula o que está à espera de revisão humana — a cache `reviewCount`.
   *
   * Deriva dos dados, nunca se soma nem subtrai à mão: uma correção aplicada, um
   * job terminado, e a contagem volta a ser calculada do zero. É o mesmo
   * princípio da carga de treino — o que se pode derivar não se guarda como
   * verdade própria.
   */
  async recomputeReview(db: ScopedClient, analysisId: string) {
    const [tracks, lowEvents, analysis] = await Promise.all([
      db.playerTrack.findMany({
        where: {
          analysisId,
          status: "auto",
          // "unknown" conta: enquanto a separação de equipas não existir, todos
          // os tracks nascem sem lado — e são precisamente os que pedem gente.
          side: { in: ["ours", "unknown"] },
          OR: [{ identityConfidence: null }, { identityConfidence: { lt: REVIEW_THRESHOLD } }],
        },
        select: { firstMs: true, lastMs: true },
      }),
      db.detectedEvent.count({
        where: { analysisId, status: "auto", confidence: { lt: REVIEW_THRESHOLD } },
      }),
      db.aIAnalysis.findFirst({ where: { id: analysisId }, select: { status: true } }),
    ]);

    // Só o que tem tempo de jogo relevante pede um humano — 20 s de figurante não.
    const lowIdentity = tracks.filter((t) => t.lastMs - t.firstMs >= REVIEW_MIN_TRACK_MS).length;
    const reviewCount = lowIdentity + lowEvents;
    const data: { reviewCount: number; updatedAt: Date; status?: "REVIEW" | "COMPLETED" } = {
      reviewCount,
      updatedAt: new Date(),
    };
    // O estado REVIEW/COMPLETED só se decide depois de o processamento acabar —
    // uma análise a meio não muda de estado por uma correção.
    if (analysis && (analysis.status === "REVIEW" || analysis.status === "COMPLETED")) {
      data.status = reviewCount > 0 ? "REVIEW" : "COMPLETED";
    }

    await db.aIAnalysis.update({ where: { id: analysisId }, data });
    return reviewCount;
  }
}
