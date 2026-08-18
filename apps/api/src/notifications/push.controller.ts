import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { IsInt, IsObject, IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { PushService, type PushPayload } from "./push.service";

class KeysDto {
  @IsString()
  @Length(1, 300)
  p256dh!: string;

  @IsString()
  @Length(1, 300)
  auth!: string;
}

/**
 * O corpo é a subscrição tal como o browser a serializa: `endpoint`, as chaves, e
 * um `expirationTime` que declaramos só para o `forbidNonWhitelisted` global não o
 * recusar (é quase sempre `null`).
 */
class SubscribeDto {
  @IsString()
  @Length(1, 1000)
  endpoint!: string;

  @IsOptional()
  @IsInt()
  expirationTime?: number | null;

  @IsObject()
  @ValidateNested()
  @Type(() => KeysDto)
  keys!: KeysDto;
}

class EndpointDto {
  @IsString()
  @Length(1, 1000)
  endpoint!: string;
}

class TestDto {
  @IsString()
  @Length(1, 1000)
  endpoint!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  kind?: string;
}

/**
 * Notificações push — o lado do servidor.
 *
 * `key` é pública (o browser precisa dela antes de subscrever); as outras passam
 * pelo `AuthGuard` e por isso sabem que utilizador é — é o que liga a subscrição a
 * uma pessoa, para um aviso poder chegar ao telemóvel certo.
 */
@Controller("api/push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @Public()
  @Get("key")
  key() {
    return { publicKey: this.push.publicKey };
  }

  @Post("subscribe")
  async subscribe(@Req() req: AuthedRequest, @Body() body: SubscribeDto) {
    await this.push.saveSubscription(
      req.ctx.userId,
      { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } },
      req.headers["user-agent"],
    );
    return { ok: true };
  }

  @Post("unsubscribe")
  async unsubscribe(@Body() body: EndpointDto) {
    await this.push.removeSubscription(body.endpoint);
    return { ok: true };
  }

  @Post("test")
  async test(@Body() body: TestDto) {
    const delivered = await this.push.pushToEndpoint(body.endpoint, testPayload(body.kind));
    return { ok: delivered };
  }
}

/** As notificações de teste do `NotificationCard`. */
function testPayload(kind?: string): PushPayload {
  if (kind === "payment-overdue") {
    return {
      title: "Mensalidade vencida",
      body: "A mensalidade de agosto está por pagar. Toca para regularizar.",
      url: "/pagamentos",
      tag: "test-payment",
      requireInteraction: true,
    };
  }
  if (kind === "training-changed") {
    return {
      title: "Treino alterado",
      body: "O treino de amanhã mudou de hora. Vê a agenda.",
      url: "/agenda",
      tag: "test-training",
    };
  }
  return { title: "Academia", body: "Notificação de teste.", url: "/" };
}
