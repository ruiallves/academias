import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/**
 * A porta dos workers de computer vision.
 *
 * Um worker não é um utilizador: não tem sessão Supabase nem membership. O que
 * tem é um segredo partilhado — `AI_WORKER_TOKEN` — no cabeçalho
 * `x-ai-worker-token`. As rotas do worker são `@Public()` (o AuthGuard global
 * não lhes serve) e este guard é a fronteira delas.
 *
 * ## A lição do webhook, repetida de propósito
 *
 * **Segredo vazio = porta fechada, nunca aberta.** O webhook da euPago já foi
 * forjável porque um segredo por configurar validava tudo; aqui, sem
 * `AI_WORKER_TOKEN` no ambiente, todos os pedidos de worker são recusados — e
 * a mensagem diz o que falta configurar.
 *
 * A comparação é em tempo constante: um segredo que se confirma byte a byte
 * com `===` conta o tempo de resposta a quem o adivinha.
 */
@Injectable()
export class AiWorkerGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>("AI_WORKER_TOKEN")?.trim();
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException("AI_WORKER_TOKEN não está configurado no servidor");
    }

    const req = context.switchToHttp().getRequest<Request>();
    const given = (req.headers["x-ai-worker-token"] as string | undefined)?.trim() ?? "";

    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) throw new UnauthorizedException("Token de worker inválido");

    return true;
  }
}
