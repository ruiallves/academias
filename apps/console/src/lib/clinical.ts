import { athleteById, today } from "@/lib/api";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import type { ClinicalEntry, ClinicalImpact, ClinicalKind } from "@/data/types";

/**
 * Estado clínico de um atleta.
 *
 * A disponibilidade **não é um campo** que alguém tem de se lembrar de mudar — é
 * derivada do boletim. Enquanto existir uma entrada de baixa sem alta clínica, o
 * atleta está indisponível, e todo o produto lê isso do mesmo sítio: a ficha, a
 * lista de atletas, a convocatória, o registo de presenças.
 *
 * A alternativa — um `status: "injured"` guardado à parte — dessincroniza-se na
 * primeira vez que alguém der alta e se esquecer de o mudar, e a partir daí o
 * treinador convoca um lesionado.
 *
 * ## O que mudou aqui, e porquê
 *
 * Isto tinha um `let added: Record<string, ClinicalEntry[]> = {}` — um objecto em
 * memória onde ficava tudo o que a consola registasse, com um comentário a dizer
 * "quando a API existir, isto passa a `POST /athletes/:id/clinical`". A API não
 * existia, e o resultado era o pior possível: a médica dava uma baixa, via-a no
 * ecrã, recarregava a página e ela tinha desaparecido — com o atleta outra vez
 * apto para o treinador convocar.
 *
 * Agora escreve-se no servidor e recarrega-se a academia, como em todo o resto do
 * produto. As leituras daqui para baixo não mudaram uma linha: já liam de
 * `athleteById(...).clinical`, que vem da API — o que faltava era o outro lado.
 */

export type Availability = "available" | "limited" | "out";

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Apto",
  limited: "Condicionado",
  out: "De baixa",
};

export const KIND_LABEL: Record<ClinicalKind, string> = {
  injury: "Lesão",
  exam: "Exame",
  physio: "Fisioterapia",
  nutrition: "Nutrição",
  psychology: "Psicologia",
  note: "Nota",
};

export const IMPACT_LABEL: Record<ClinicalImpact, string> = {
  none: "Sem impacto",
  limited: "Trabalho condicionado",
  out: "Baixa — não treina nem joga",
};

/* -------------------------------------------------------------------------- */
/* Escritas                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Os enums do servidor são em maiúsculas; os do cliente em minúsculas, porque é
 * assim que vivem no `data/types.ts` desde o princípio. A tradução é aqui e só
 * aqui — espalhá-la pelos ecrãs era garantir que um deles mandava o valor errado.
 */
const paraApi = (v: string) => v.toUpperCase();

export type NovaEntrada = {
  kind: ClinicalKind;
  status: "done" | "scheduled";
  date: string;
  time?: string;
  location?: string;
  title?: string;
  detail?: string;
  impact: ClinicalImpact;
  expectedReturn?: string;
  /** Só em exames realizados: escreve também a validade na ficha do atleta. */
  validUntil?: string;
};

/**
 * Registar no boletim — ou agendar.
 *
 * Recarrega a academia a seguir: o boletim vem dentro do atleta, e é de lá que
 * todos os ecrãs o lêem. Sem o recarregamento, o registo estava na base e não no
 * ecrã — que é o mesmo sintoma, ao contrário.
 */
export async function addClinicalEntry(athleteId: string, entry: NovaEntrada): Promise<void> {
  await apiPost(`/api/athletes/${athleteId}/clinical`, {
    kind: paraApi(entry.kind),
    status: paraApi(entry.status),
    impact: paraApi(entry.impact),
    date: entry.date,
    ...(entry.time ? { time: entry.time } : {}),
    ...(entry.location ? { location: entry.location } : {}),
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.detail ? { detail: entry.detail } : {}),
    ...(entry.expectedReturn ? { expectedReturn: entry.expectedReturn } : {}),
    ...(entry.validUntil ? { validUntil: entry.validUntil } : {}),
  });
  await reloadAcademy();
}

/**
 * Dar alta. Fecha a entrada em vez de criar outra — a alta é o fim daquela
 * ocorrência, não um acontecimento separado no historial.
 */
export async function clearClinicalEntry(_athleteId: string, entryId: string, on?: string): Promise<void> {
  await apiPost(`/api/clinical/${entryId}/alta`, on ? { on } : {});
  await reloadAcademy();
}

/** Desfazer uma alta dada por engano. */
export async function reopenClinicalEntry(entryId: string): Promise<void> {
  await apiPost(`/api/clinical/${entryId}/reabrir`, {});
  await reloadAcademy();
}

/** Corrigir um registo. */
export async function updateClinicalEntry(entryId: string, patch: Partial<NovaEntrada>): Promise<void> {
  await apiPatch(`/api/clinical/${entryId}`, {
    ...(patch.kind ? { kind: paraApi(patch.kind) } : {}),
    ...(patch.status ? { status: paraApi(patch.status) } : {}),
    ...(patch.impact ? { impact: paraApi(patch.impact) } : {}),
    ...(patch.date ? { date: patch.date } : {}),
    ...(patch.time !== undefined ? { time: patch.time } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
    ...(patch.expectedReturn !== undefined ? { expectedReturn: patch.expectedReturn } : {}),
    ...(patch.validUntil ? { validUntil: patch.validUntil } : {}),
  });
  await reloadAcademy();
}

/** Desmarcar um agendamento. O servidor recusa apagar o que já aconteceu. */
export async function deleteClinicalEntry(entryId: string): Promise<void> {
  await apiDelete(`/api/clinical/${entryId}`);
  await reloadAcademy();
}

/* -------------------------------------------------------------------------- */
/* Leitura                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Já não há nada para subscrever — o boletim vive no store da academia, e é esse
 * que notifica os ecrãs quando recarrega. Fica como no-op para os ecrãs que a
 * chamavam não terem de mudar de forma por causa de uma mecânica que desapareceu.
 */
export function useClinicalRecords(): void {
  /* O `useStore` de quem desenha já trata do redesenho. */
}

/** O boletim completo do atleta, como veio do servidor. */
export function clinicalOf(athleteId: string): ClinicalEntry[] {
  return [...(athleteById(athleteId)?.clinical ?? [])].sort((a, b) => b.date.localeCompare(a.date));
}

/** Agendamentos futuros — o que o pai vê na app e o que enche a agenda clínica. */
export function upcomingAppointments(athleteId: string): ClinicalEntry[] {
  const iso = isoToday();
  return clinicalOf(athleteId)
    .filter((e) => e.status === "scheduled" && e.date >= iso)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A entrada que está a afectar o atleta agora, se houver. */
export function activeRestriction(athleteId: string): ClinicalEntry | undefined {
  return clinicalOf(athleteId)
    // Um agendamento futuro não afecta a disponibilidade de hoje.
    .filter((e) => e.status !== "scheduled" && e.status !== "cancelled")
    .filter((e) => e.impact !== "none" && !e.clearedOn)
    // Se houver mais que uma, manda a mais grave.
    .sort((a, b) => (a.impact === "out" ? -1 : b.impact === "out" ? 1 : 0))[0];
}

export function availabilityOf(athleteId: string): Availability {
  const active = activeRestriction(athleteId);
  if (!active) return "available";
  return active.impact === "out" ? "out" : "limited";
}

/** Verdadeiro quando o atleta não pode ser convocado nem contar como falta. */
export function isUnavailable(athleteId: string): boolean {
  return availabilityOf(athleteId) === "out";
}

export function isoToday(): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
