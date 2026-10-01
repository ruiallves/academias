import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * O espaço de ficheiros de cada clube: quanto usa, quanto pode usar, e o travão.
 *
 * ## O limite
 *
 * 5 GB por omissão (`Academy.storageLimitMb`), como dizem os Termos de Serviço.
 * A plataforma aumenta-o a um clube, normalmente com a mensalidade dele.
 *
 * ## O que está usado
 *
 * Mede-se no armazenamento, não se guarda: `app.storage_by_academy` soma os
 * ficheiros de `storage.objects` e atribui cada um ao clube pelo caminho. Apagar
 * uma fotografia baixa o número sem ninguém ter de se lembrar de o baixar. Ver a
 * migração `20260928100000_espaco_por_clube`.
 *
 * ## O travão
 *
 * Um clube no limite não carrega ficheiros novos: cada autorização de
 * carregamento pergunta primeiro (`garantirEspaco`). Apagar continua sempre
 * possível, porque é assim que se sai do limite. O que já lá está não se toca.
 */

export const MB = 1024 * 1024;

/** As categorias, como a consola e a plataforma as escrevem. */
export const CATEGORIAS: Record<string, string> = {
  fotografias: "Fotografias",
  documentos: "Documentos de atletas",
  simbolo: "Símbolo do clube",
  inventario: "Inventário",
  exercicios: "Exercícios",
  scouting: "Vídeos de scouting",
  video: "Vídeos da Academias AI",
};

export type EspacoDoClube = {
  usedBytes: number;
  limitBytes: number;
  categorias: { key: string; label: string; bytes: number; ficheiros: number }[];
};

@Injectable()
export class EspacoService {
  constructor(private readonly prisma: PrismaService) {}

  /** O que o clube usa, por categoria, e o limite. */
  async doClube(academyId: string): Promise<EspacoDoClube> {
    const [linhas, limiteMb] = await Promise.all([this.medir(academyId), this.limiteMb(academyId)]);
    const categorias = linhas
      .map((l) => ({ key: l.categoria, label: CATEGORIAS[l.categoria] ?? l.categoria, bytes: Number(l.bytes), ficheiros: Number(l.ficheiros) }))
      .sort((a, b) => b.bytes - a.bytes);
    return {
      usedBytes: categorias.reduce((s, c) => s + c.bytes, 0),
      limitBytes: limiteMb * MB,
      categorias,
    };
  }

  /** O que cada clube usa, em bytes — para a lista da plataforma. */
  async deTodos(): Promise<Map<string, number>> {
    const linhas = await this.prisma.$queryRaw<{ academy_id: string; bytes: bigint }[]>`
      SELECT academy_id, bytes FROM app.storage_by_academy(NULL)
    `;
    const out = new Map<string, number>();
    for (const l of linhas) out.set(l.academy_id, (out.get(l.academy_id) ?? 0) + Number(l.bytes));
    return out;
  }

  /**
   * Recusa um carregamento que passe o limite.
   *
   * `bytesPrevistos` é o tamanho do ficheiro quando se sabe (um vídeo diz quanto
   * tem); sem ele, só se recusa a quem já está no limite. Uma fotografia não
   * passa de 8 MB, e recusá-la por ficar a meio megabyte do limite era mais
   * incómodo do que o que se poupava.
   */
  async garantirEspaco(academyId: string, bytesPrevistos = 0): Promise<void> {
    const [linhas, limiteMb] = await Promise.all([this.medir(academyId), this.limiteMb(academyId)]);
    const usado = linhas.reduce((s, l) => s + Number(l.bytes), 0);
    const limite = limiteMb * MB;
    if (usado >= limite || usado + bytesPrevistos > limite) {
      throw new BadRequestException(
        `O clube chegou ao limite de espaço para ficheiros (${formatarTamanho(limite)}). ` +
          "Apaga ficheiros de que já não precisas, ou fala connosco para aumentar o espaço.",
      );
    }
  }

  private medir(academyId: string) {
    return this.prisma.$queryRaw<{ categoria: string; bytes: bigint; ficheiros: bigint }[]>`
      SELECT categoria, bytes, ficheiros FROM app.storage_by_academy(${academyId})
    `;
  }

  /*
   * Lido no contexto do próprio clube (`runAs`), e não da sessão de quem pede:
   * o travão corre também em caminhos sem sessão de academia, como a
   * plataforma a carregar o símbolo de um clube novo.
   */
  private async limiteMb(academyId: string): Promise<number> {
    const a = await this.prisma.runAs(academyId, (db) =>
      db.academy.findFirst({ where: { id: academyId }, select: { storageLimitMb: true } }),
    );
    return a?.storageLimitMb ?? 5120;
  }
}

/** "1,2 GB", "340 MB", "12 KB" — para as mensagens. */
export function formatarTamanho(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
