import type { ScopedClient } from "../prisma/prisma.service";

/**
 * As licenças federativas e a morada do atleta.
 *
 * ## A licença é da modalidade e da época
 *
 * Um atleta em futebol e futsal tem duas licenças; um atleta no Sub-13 e no
 * Sub-15 de futebol tem uma. E a inscrição na federação renova-se todas as
 * épocas. Por isso a licença guarda-se por atleta, modalidade e época
 * (`AthleteLicense`), e quem escreve a partir de uma equipa (a inscrição, a
 * linha da importação) escreve na modalidade e na época **dessa equipa**.
 */

/** O número como se guarda: sem espaços nas pontas nem repetidos. Vazio é nulo. */
export function normalizarLicenca(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t || null;
}

/** Texto livre opcional: sem espaços nas pontas; vazio é nulo. */
const texto = (v: string | undefined): string | null => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t || null;
};

/** O n.º do Cartão de Cidadão como se guarda: maiúsculas, um espaço entre blocos. */
export function normalizarCartaoCidadao(v: string | undefined): string | null {
  const t = (v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return t || null;
}

type ComMorada = { address?: string; postalCode?: string; city?: string; citizenCardNumber?: string };

/**
 * Os campos da morada e do CC que vieram no pedido, prontos a escrever.
 *
 * Só os que vieram: um campo ausente não é o clube a dizer que está vazio (na
 * importação, é uma coluna que a folha não tem). Um campo que veio vazio limpa.
 */
export function moradaDoPedido(dto: ComMorada) {
  return {
    ...(dto.address !== undefined ? { address: texto(dto.address) } : {}),
    ...(dto.postalCode !== undefined ? { postalCode: texto(dto.postalCode) } : {}),
    ...(dto.city !== undefined ? { city: texto(dto.city) } : {}),
    ...(dto.citizenCardNumber !== undefined ? { citizenCardNumber: normalizarCartaoCidadao(dto.citizenCardNumber) } : {}),
  };
}

/**
 * Escreve a licença de cada equipa na modalidade e na época dela.
 *
 * Duas equipas da mesma modalidade e época (Sub-13 e Sub-15 de futebol) são a
 * mesma licença: a última escrita ganha, e na inscrição ninguém escreve dois
 * números diferentes para o mesmo atleta. Um número vazio não apaga nada: aqui
 * só se escreve o que veio preenchido.
 */
export async function gravarLicencasDasEquipas(
  db: ScopedClient,
  academyId: string,
  athleteId: string,
  itens: { teamId: string; number: string | null | undefined }[],
): Promise<number> {
  const preenchidos = itens
    .map((i) => ({ teamId: i.teamId, number: normalizarLicenca(i.number) }))
    .filter((i): i is { teamId: string; number: string } => i.number !== null);
  if (preenchidos.length === 0) return 0;

  const equipas = await db.team.findMany({
    where: { id: { in: [...new Set(preenchidos.map((i) => i.teamId))] } },
    select: { id: true, sportId: true, seasonId: true },
  });
  const porId = new Map(equipas.map((t) => [t.id, t]));

  let escritas = 0;
  for (const i of preenchidos) {
    const t = porId.get(i.teamId);
    if (!t) continue;
    await db.athleteLicense.upsert({
      where: { athleteId_sportId_seasonId: { athleteId, sportId: t.sportId, seasonId: t.seasonId } },
      create: { academyId, athleteId, sportId: t.sportId, seasonId: t.seasonId, number: i.number },
      update: { number: i.number },
    });
    escritas++;
  }
  return escritas;
}
