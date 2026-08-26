// De `store` e não de `api`: o `api` passou a importar daqui, e importar de lá
// fechava um ciclo. O `today` nasce no store, que não depende de ninguém.
import { today } from "@/lib/store";

/**
 * A ficha médica de um atleta, lida num sítio só.
 *
 * ## Porque é que isto existe
 *
 * O mesmo cálculo — expirada, a expirar dentro de 30 dias, em ordem — estava
 * escrito seis vezes: na lista de atletas, na ficha da equipa, nos dois ecrãs do
 * departamento clínico, no painel clínico e no "Precisa de atenção". Seis cópias
 * de `new Date(a.medicalValidUntil)`, e nenhuma delas tratava a ausência.
 *
 * Um atleta inscrito sem exame — o caso normal, porque o exame vem depois da
 * inscrição — tinha `medicalValidUntil` vazio, `new Date("")` dava `Invalid
 * Date`, e a comparação com hoje era `false` em qualquer sentido. Resultado: o
 * atleta aparecia como "em ordem" nos ecrãs que perguntavam se tinha expirado, e
 * fazia rebentar aqueles que tentavam formatar a data.
 *
 * ## Ausente não é "em ordem"
 *
 * `missing` é um estado próprio, e não um caso de `ok`. Um clube que não sabe
 * distinguir "exame válido até Março" de "exame nenhum" é um clube que põe um
 * miúdo a jogar sem exame — que é precisamente o que este produto existe para
 * evitar.
 */

export type MedicalState = "missing" | "expired" | "soon" | "ok";

/** Trinta dias — a janela em que vale a pena avisar que está a acabar. */
const AVISO_MS = 30 * 86_400_000;

type ComFicha = { medicalValidUntil: string | null };

/**
 * A data de validade, ou `null`.
 *
 * `null` tanto para ausente como para texto que não é uma data: as duas coisas
 * dizem o mesmo a quem vai mostrar isto — não há validade conhecida — e
 * distingui-las só espalharia `Invalid Date` pelos ecrãs.
 */
export function medicalExpiry(a: ComFicha): Date | null {
  if (!a.medicalValidUntil) return null;
  const d = new Date(a.medicalValidUntil);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function medicalState(a: ComFicha, from: Date = today): MedicalState {
  const d = medicalExpiry(a);
  if (!d) return "missing";
  if (d.getTime() < from.getTime()) return "expired";
  if (d.getTime() < from.getTime() + AVISO_MS) return "soon";
  return "ok";
}

/**
 * Precisa de atenção do departamento clínico?
 *
 * Sem exame, expirado ou a expirar. É a pergunta que as listas fazem, e tê-la
 * aqui evita que cada ecrã escolha um subconjunto diferente de estados.
 */
export function medicalNeedsAttention(a: ComFicha, from: Date = today): boolean {
  return medicalState(a, from) !== "ok";
}
