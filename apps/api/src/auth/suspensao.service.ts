import { ForbiddenException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const ACADEMY_SUSPENDED_CODE = "ACADEMY_SUSPENDED";

/** Quanto tempo a lista em memória vale antes de se voltar a ler. */
const VALIDADE_MS = 60_000;

/**
 * Quem está suspenso por falta de pagamento da mensalidade da plataforma.
 *
 * ## Porquê em memória
 *
 * Porque o guard pergunta isto em **todos** os pedidos autenticados, e uma ida
 * à base por pedido era pagar 300 ms de pooler para responder "não" a toda a
 * gente. A lista é pequena (quem deve), muda poucas vezes por mês, e um minuto
 * de atraso a fechar a porta não é nada ao pé das semanas de lembretes que
 * vieram antes. Abrir é imediato: quem paga chama `levantar` e entra a seguir.
 *
 * ## O que a suspensão fecha
 *
 * A consola e a app das famílias, por inteiro, com um 403 de código
 * `ACADEMY_SUSPENDED`. O que fica aberto é só o que serve para pagar
 * (`@SuspensionExempt()`), e os dados ficam todos onde estão: suspender não é
 * cancelar, é esperar.
 */
@Injectable()
export class SuspensaoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SuspensaoService.name);
  private suspensas = new Set<string>();
  private lidaEm = 0;
  private relogio: NodeJS.Timeout | null = null;
  private aLer: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.relogio = setInterval(() => void this.recarregar(), VALIDADE_MS);
    this.relogio.unref();
    void this.recarregar();
  }

  onModuleDestroy() {
    if (this.relogio) clearInterval(this.relogio);
  }

  async recarregar(): Promise<void> {
    if (this.aLer) return this.aLer;
    this.aLer = (async () => {
      try {
        const rows = await this.prisma.$queryRaw<{ academy_id: string }[]>`SELECT * FROM app.suspended_academies()`;
        this.suspensas = new Set(rows.map((r) => r.academy_id));
        this.lidaEm = Date.now();
      } catch (e) {
        // Fica a lista anterior: pior do que um minuto de atraso é fechar ou
        // abrir a porta a toda a gente por causa de uma consulta que falhou.
        this.log.warn(`Não foi possível ler as academias suspensas: ${e instanceof Error ? e.message : e}`);
      } finally {
        this.aLer = null;
      }
    })();
    return this.aLer;
  }

  async estaSuspensa(academyId: string): Promise<boolean> {
    if (Date.now() - this.lidaEm > VALIDADE_MS * 2) await this.recarregar();
    return this.suspensas.has(academyId);
  }

  /** O guard, e o `academiaDe` da app do clube: a mesma recusa nos dois sítios. */
  async recusarSeSuspensa(academyId: string): Promise<void> {
    if (!(await this.estaSuspensa(academyId))) return;
    throw new ForbiddenException({
      statusCode: 403,
      code: ACADEMY_SUSPENDED_CODE,
      message: "O acesso do clube está suspenso até ao pagamento da mensalidade da plataforma.",
    });
  }

  marcar(academyId: string) {
    this.suspensas.add(academyId);
  }

  levantar(academyId: string) {
    this.suspensas.delete(academyId);
  }
}
