import type { ScopedClient } from "../prisma/prisma.service";
import { nomeNormalizado } from "./diretorio.service";

/**
 * O emblema do adversário de cada jogo.
 *
 * Vem de dois sítios, por esta ordem:
 *
 *   1. do diretório (`KnownClub.logoKey`), quando o jogo tem `opponentClubId`
 *      e o clube tem emblema;
 *   2. do que **este** clube carregou (`ClubLogoProposal`), pelo clube do
 *      diretório ou pelo nome escrito, enquanto a proposta não for rejeitada.
 *      Uma proposta ainda por rever conta: quem a carregou vê-a logo.
 *
 * Tudo numa ida à base para a lista inteira: uma lista de jogos com cem
 * adversários não pode fazer cem consultas.
 */

export const EMBLEMAS_BUCKET = "emblemas";

export type Emblema = { pequeno: string; grande: string };

export function urlsDoEmblema(base: string, logoKey: string): Emblema {
  const raiz = `${base}/storage/v1/object/public/${EMBLEMAS_BUCKET}/${logoKey}`;
  return { pequeno: `${raiz}/64.webp`, grande: `${raiz}/256.webp` };
}

export async function emblemasDosAdversarios(
  db: ScopedClient,
  base: string,
  jogos: { id: string; opponent: string; opponentClubId: string | null }[],
): Promise<Map<string, Emblema | null>> {
  const out = new Map<string, Emblema | null>();
  if (jogos.length === 0) return out;

  const ids = [...new Set(jogos.map((j) => j.opponentClubId).filter((x): x is string => !!x))];
  const nomes = [...new Set(jogos.map((j) => nomeNormalizado(j.opponent)).filter(Boolean))];

  const [clubes, propostas] = await Promise.all([
    ids.length ? db.knownClub.findMany({ where: { id: { in: ids } }, select: { id: true, logoKey: true } }) : Promise.resolve([]),
    db.clubLogoProposal.findMany({
      where: {
        status: { not: "REJECTED" },
        logoKey: { not: null },
        OR: [...(ids.length ? [{ knownClubId: { in: ids } }] : []), ...(nomes.length ? [{ normalizedName: { in: nomes } }] : [])],
      },
      orderBy: { createdAt: "desc" },
      select: { knownClubId: true, normalizedName: true, logoKey: true },
    }),
  ]);

  const doDiretorio = new Map(clubes.filter((c) => c.logoKey).map((c) => [c.id, c.logoKey as string]));
  const propostaPorClube = new Map<string, string>();
  const propostaPorNome = new Map<string, string>();
  for (const p of propostas) {
    if (p.knownClubId && !propostaPorClube.has(p.knownClubId)) propostaPorClube.set(p.knownClubId, p.logoKey as string);
    if (!propostaPorNome.has(p.normalizedName)) propostaPorNome.set(p.normalizedName, p.logoKey as string);
  }

  for (const j of jogos) {
    const key =
      (j.opponentClubId && (doDiretorio.get(j.opponentClubId) ?? propostaPorClube.get(j.opponentClubId))) ||
      propostaPorNome.get(nomeNormalizado(j.opponent)) ||
      null;
    out.set(j.id, key ? urlsDoEmblema(base, key) : null);
  }
  return out;
}
