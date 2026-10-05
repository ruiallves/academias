import { listAthletes, naEquipa, numeroNaEquipa, posicaoNaEquipa, teamById } from "@/lib/api";
import { availabilityOn, diaDe } from "@/lib/clinical";
import { academy, ensureCalendarRange, sessions } from "@/lib/store";
import type { Session } from "@/lib/permissions";

/**
 * Quem se espera num treino, por posição.
 *
 * É o cabeçalho do PDF do plano: o treinador imprime a folha e quer saber com
 * quantos guarda-redes e com quantos centrais conta. As regras são as das
 * Presenças, para as duas folhas dizerem o mesmo:
 *
 *  - quem está de baixa **no dia do treino** não conta (`availabilityOn`);
 *  - quem avisou pela app que não vem não conta (`AbsenceNotice`);
 *  - com a folha de presenças já gravada, é ela que manda: quem faltou não
 *    conta, e quem tinha avisado mas apareceu volta a contar;
 *  - quem está condicionado conta, com a nota ao lado.
 */
export type AtletaEsperado = { nome: string; numero?: number; nota?: string };
export type FicaDeFora = { nome: string; motivo: string };
export type Esperados = {
  grupos: { posicao: string; atletas: AtletaEsperado[] }[];
  total: number;
  plantel: number;
  fora: FicaDeFora[];
};

export async function esperadosNoTreino(session: Session, sessionId: string, teamId: string, startsAt: string): Promise<Esperados> {
  const inicio = new Date(startsAt);
  // O treino pode estar fora da janela que o arranque trouxe.
  const dia0 = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  await ensureCalendarRange(dia0, new Date(dia0.getTime() + 86_400_000)).catch(() => undefined);
  const treino = sessions.find((s) => s.id === sessionId);

  const dia = diaDe(inicio);
  const plantel = listAthletes(session).filter((a) => naEquipa(a, teamId) && a.status === "active");
  const folha = treino?.attendance ? new Map(treino.attendance.absences.map((x) => [x.athleteId, x])) : null;
  const avisos = new Map((treino?.notices ?? []).map((n) => [n.athleteId, n]));

  const fora: FicaDeFora[] = [];
  const contam: (AtletaEsperado & { posicao: string })[] = [];
  for (const a of plantel) {
    const estado = availabilityOn(a.id, dia);
    if (estado === "out") {
      fora.push({ nome: a.name, motivo: "de baixa" });
      continue;
    }
    if (folha) {
      const falta = folha.get(a.id);
      if (falta && falta.kind !== "late") {
        fora.push({ nome: a.name, motivo: falta.kind === "justified" ? `faltou, justificada${falta.note ? `: ${falta.note}` : ""}` : "faltou" });
        continue;
      }
    } else {
      const aviso = avisos.get(a.id);
      if (aviso) {
        fora.push({ nome: a.name, motivo: `avisou que não vem${aviso.reason ? `: ${aviso.reason}` : ""}` });
        continue;
      }
    }
    contam.push({
      nome: a.name,
      numero: numeroNaEquipa(a, teamId),
      posicao: posicaoNaEquipa(a, teamId)?.trim() || "Sem posição",
      ...(estado === "limited" ? { nota: "condicionado" } : {}),
    });
  }

  // As posições pela ordem da modalidade; as que o clube inventou a seguir; "Sem posição" no fim.
  const ordem = academy.sports.find((s) => s.id === teamById(teamId)?.sportId)?.positions ?? [];
  const peso = (p: string) => (p === "Sem posição" ? 10_000 : ordem.indexOf(p) >= 0 ? ordem.indexOf(p) : 1_000);
  const posicoes = [...new Set(contam.map((c) => c.posicao))].sort((x, y) => peso(x) - peso(y) || x.localeCompare(y, "pt"));

  return {
    grupos: posicoes.map((posicao) => ({
      posicao,
      atletas: contam
        .filter((c) => c.posicao === posicao)
        .sort((x, y) => (x.numero ?? 999) - (y.numero ?? 999) || x.nome.localeCompare(y.nome, "pt"))
        .map(({ nome, numero, nota }) => ({ nome, numero, nota })),
    })),
    total: contam.length,
    plantel: plantel.length,
    fora: fora.sort((x, y) => x.nome.localeCompare(y.nome, "pt")),
  };
}
