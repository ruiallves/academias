import type { ScopedClient } from "../prisma/prisma.service";
import type { RequestContext } from "../common/permissions";
import { nomeDeQuemMexe, registarAlteracoes } from "../common/historico";
import { digitosDoTelefone } from "../common/telefone";
import type { EncarregadoDaFolhaDto } from "./athletes.dto";

/**
 * Os encarregados que vêm na folha de atletas.
 *
 * Uma folha não cria contas: um encarregado é sempre alguém com login, e quem
 * ainda não o tem entra pelo link de famílias. Por isso a importação só
 * reconhece quem **já tem conta no clube** (staff, encarregado, sócio com
 * conta), pelo email, liga-o ao atleta e acerta o telemóvel. Os outros não
 * travam o atleta: ficam numa lista no fim, para o clube os convidar.
 *
 * Um telemóvel que **substitui** outro pergunta antes, como os campos da ficha
 * (ver `sobrescrever` em `importMany`). Preencher um telemóvel vazio não
 * pergunta: não se perde nada.
 *
 * Ninguém é avisado de nada: as importações não mandam correio sozinhas.
 */

/** Uma conta do clube que pode ser encarregada. `telefone` undefined = não se sabe (sócio sem vínculo: a RLS de User não o mostra). */
export type ContaDoClube = {
  userId: string;
  nome: string;
  telefone: string | null | undefined;
  /** A membership de família, se já existir. */
  familia: { id: string; ativa: boolean } | null;
};

export type EncarregadoPorLigar = { athleteId: string; atleta: string; userId: string; nome: string; telefoneNovo: string | null };
export type TelefoneASubstituir = { line: number; atleta: string; encarregado: string; de: string | null; para: string };
export type EncarregadoDeFora = { line: number; atleta: string; nome: string; email: string; motivo: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export { digitosDoTelefone };

export function emailsDaFolha(rows: { encarregados?: EncarregadoDaFolhaDto[] }[]): string[] {
  const todos = rows.flatMap((r) => (r.encarregados ?? []).map((e) => (e.email ?? "").trim().toLowerCase()));
  return [...new Set(todos.filter((e) => EMAIL.test(e)))];
}

/** As contas do clube com estes emails, por email em minúsculas. */
export async function contasDoClube(db: ScopedClient, academyId: string, emails: string[]): Promise<Map<string, ContaDoClube>> {
  const contas = new Map<string, ContaDoClube>();
  if (emails.length === 0) return contas;
  const porEmail = emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } }));

  const vinculos = await db.membership.findMany({
    where: { academyId, role: { not: "ATHLETE" }, user: { OR: porEmail } },
    select: { id: true, role: true, isActive: true, user: { select: { id: true, name: true, email: true, phone: true } } },
  });
  for (const v of vinculos) {
    // Um vínculo de staff desligado não faz da pessoa alguém do clube; o de família conta sempre (para dizer que está à espera).
    if (v.role !== "GUARDIAN" && !v.isActive) continue;
    const chave = v.user.email.toLowerCase();
    const atual = contas.get(chave) ?? { userId: v.user.id, nome: v.user.name, telefone: v.user.phone, familia: null };
    if (v.role === "GUARDIAN") atual.familia = { id: v.id, ativa: v.isActive };
    contas.set(chave, atual);
  }

  const socios = await db.member.findMany({
    where: { NOT: { userId: null }, OR: porEmail },
    select: { userId: true, name: true, email: true },
  });
  for (const s of socios) {
    if (!s.userId || !s.email) continue;
    const chave = s.email.toLowerCase();
    if (!contas.has(chave)) contas.set(chave, { userId: s.userId, nome: s.name, telefone: undefined, familia: null });
  }
  return contas;
}

/**
 * O que fazer com os encarregados de uma linha. Não escreve nada: devolve o
 * que ligar, os telemóveis que vão ser substituídos e quem fica de fora.
 */
export function planearEncarregados(
  linha: { line: number; athleteId: string; atleta: string; encarregados?: EncarregadoDaFolhaDto[] },
  contas: Map<string, ContaDoClube>,
  podeLigar: boolean,
  out: { porLigar: EncarregadoPorLigar[]; telefones: TelefoneASubstituir[]; deFora: EncarregadoDeFora[] },
): void {
  for (const enc of linha.encarregados ?? []) {
    const nome = (enc.nome ?? "").trim();
    const email = (enc.email ?? "").trim().toLowerCase();
    const telefone = (enc.telefone ?? "").trim();
    if (!nome && !email && !telefone) continue;

    const fora = (motivo: string) => out.deFora.push({ line: linha.line, atleta: linha.atleta, nome, email, motivo });
    if (!podeLigar) { fora("sem permissão para gerir famílias"); continue; }
    if (!email) { fora("sem email, não dá para o reconhecer"); continue; }
    if (!EMAIL.test(email)) { fora("email inválido"); continue; }
    const conta = contas.get(email);
    if (!conta) { fora("ainda não tem conta no clube"); continue; }
    if (conta.familia && !conta.familia.ativa) { fora("à espera de aprovação ou desligado em Famílias"); continue; }

    const muda = telefone !== "" && digitosDoTelefone(telefone) !== digitosDoTelefone(conta.telefone);
    if (muda && conta.telefone !== null && conta.telefone !== "") {
      const jaDito = out.telefones.some((t) => t.encarregado === conta.nome && digitosDoTelefone(t.para) === digitosDoTelefone(telefone));
      if (!jaDito) out.telefones.push({ line: linha.line, atleta: linha.atleta, encarregado: conta.nome, de: conta.telefone ?? null, para: telefone });
    }
    out.porLigar.push({ athleteId: linha.athleteId, atleta: linha.atleta, userId: conta.userId, nome: conta.nome, telefoneNovo: muda ? telefone : null });
  }
}

/** Liga e acerta os telemóveis. Corre depois da pergunta, dentro da transação da importação. */
export async function aplicarEncarregados(
  db: ScopedClient,
  ctx: RequestContext,
  porLigar: EncarregadoPorLigar[],
): Promise<{ ligados: number; telefones: number }> {
  let ligados = 0;
  const telefonesFeitos = new Set<string>();
  const familiaDe = new Map<string, string>();
  const nomesAntes = new Map<string, string[]>();
  let quem: string | null = null;

  for (const op of porLigar) {
    let membershipId = familiaDe.get(op.userId);
    if (!membershipId) {
      const existente = await db.membership.findFirst({
        where: { academyId: ctx.academyId, userId: op.userId, role: "GUARDIAN" },
        select: { id: true, isActive: true },
      });
      // Desligada ou à espera já ficou de fora no plano; isto é só a rede.
      if (existente && !existente.isActive) continue;
      membershipId = existente?.id
        ?? (await db.membership.create({ data: { academyId: ctx.academyId, userId: op.userId, role: "GUARDIAN", isActive: true }, select: { id: true } })).id;
      familiaDe.set(op.userId, membershipId);
    }

    const ligacao = await db.guardianLink.findUnique({
      where: { athleteId_membershipId: { athleteId: op.athleteId, membershipId } },
      select: { id: true },
    });
    if (!ligacao) {
      if (!nomesAntes.has(op.athleteId)) nomesAntes.set(op.athleteId, await nomesDosEncarregados(db, op.athleteId));
      await db.guardianLink.create({ data: { athleteId: op.athleteId, membershipId, relation: "Encarregado" } });
      ligados++;
    }

    if (op.telefoneNovo && !telefonesFeitos.has(op.userId)) {
      await db.user.update({ where: { id: op.userId }, data: { phone: op.telefoneNovo } });
      telefonesFeitos.add(op.userId);
    }
  }

  // O histórico da ficha, como quando se liga à mão.
  for (const [athleteId, antes] of nomesAntes) {
    quem ??= await nomeDeQuemMexe(db, ctx);
    await registarAlteracoes(db, ctx, "ATHLETE", athleteId, { encarregados: antes }, { encarregados: await nomesDosEncarregados(db, athleteId) }, quem);
  }
  return { ligados, telefones: telefonesFeitos.size };
}

async function nomesDosEncarregados(db: ScopedClient, athleteId: string): Promise<string[]> {
  const links = await db.guardianLink.findMany({
    where: { athleteId },
    select: { membership: { select: { user: { select: { name: true } } } } },
  });
  return links.map((l) => l.membership.user.name).sort((a, b) => a.localeCompare(b, "pt"));
}
