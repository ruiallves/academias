import { Prisma, type ProfileKind } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";
import type { RequestContext } from "./permissions";
import { formatarNoFuso } from "./fuso";

/**
 * O histórico de alterações de uma ficha.
 *
 * ## A pergunta que isto responde
 *
 * "Isto estava assim ontem?" — e a seguir, "quem mudou?". O peso e a altura de
 * um atleta são o caso que o fez nascer: alguém escreve 64 onde era 62, e três
 * meses depois o gráfico de crescimento mente sem ninguém saber porquê. Vale
 * para tudo o que se edita numa ficha: nome, contacto, escalão, número, cargo,
 * acessos, estado.
 *
 * ## Uma linha por campo
 *
 * E não uma linha por gravação com um JSON lá dentro. É o que permite ler
 * "Peso 62 → 64" sem abrir nada, seguir a história de um número só, e mostrar
 * o histórico de um campo ao lado do próprio campo, quando um ecrã o quiser.
 *
 * ## Texto, e não tipos
 *
 * Os valores guardam-se já formatados, como se mostram. O histórico não tem de
 * saber de `Decimal`, de datas nem de enums, e uma coluna que mude de tipo mais
 * tarde não estraga o que já lá está escrito. O preço é não se poder somar nem
 * ordenar por valor, e ninguém quer isso de um histórico.
 *
 * ## Nunca falha a operação
 *
 * Gravar o histórico corre **dentro** da mesma transação da alteração, para não
 * ficar um sem o outro. Mas um erro a escrever o histórico não pode impedir uma
 * secretária de corrigir um telefone: o que falha, falha em silêncio e fica no
 * log do servidor.
 */

/** Como cada valor se escreve no histórico. Nulo é "vazio", e mostra-se assim. */
export function valorEmTexto(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    // Só a data quando a hora não diz nada (nascimento, validade do exame).
    const meiaNoite = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    return meiaNoite
      ? v.toISOString().slice(0, 10)
      : formatarNoFuso(v, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  if (v instanceof Prisma.Decimal) return v.toString();
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) return v.length === 0 ? null : v.map((x) => String(x)).join(", ");
  return String(v);
}

/**
 * Regista o que mudou entre `antes` e `depois`.
 *
 * Só os campos presentes em `depois` entram na comparação: quem grava metade de
 * um formulário não escreve histórico sobre a outra metade. Um campo com o
 * mesmo valor não gera linha nenhuma.
 */
export async function registarAlteracoes(
  db: ScopedClient,
  ctx: RequestContext,
  kind: ProfileKind,
  subjectId: string,
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  quem: string,
): Promise<number> {
  const linhas: Prisma.ProfileChangeCreateManyInput[] = [];

  for (const [field, valor] of Object.entries(depois)) {
    if (valor === undefined) continue;
    const de = valorEmTexto(antes[field]);
    const para = valorEmTexto(valor);
    if (de === para) continue;
    linhas.push({
      academyId: ctx.academyId,
      kind,
      subjectId,
      field,
      before: de,
      after: para,
      byId: ctx.membershipId,
      byName: quem,
    });
  }

  if (linhas.length === 0) return 0;
  try {
    await db.profileChange.createMany({ data: linhas });
  } catch (e) {
    // Um histórico que rebenta a gravação seria pior do que um histórico com
    // um buraco. Fica o rasto no log do servidor.
    console.error("histórico de alterações:", e instanceof Error ? e.message : e);
    return 0;
  }
  return linhas.length;
}

/** O nome de quem está a mexer, para a linha do histórico o guardar. */
export async function nomeDeQuemMexe(db: ScopedClient, ctx: RequestContext): Promise<string> {
  const m = await db.membership.findFirst({
    where: { id: ctx.membershipId },
    select: { user: { select: { name: true } } },
  });
  return m?.user.name ?? "Alguém do clube";
}
