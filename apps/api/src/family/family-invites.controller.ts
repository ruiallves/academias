import { Body, Controller, Delete, Get, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import type { Response } from "express";
import { Public, type AuthedRequest } from "../auth/auth.guard";
import { FamilyInvitesService } from "./family-invites.service";

/* -------------------------------------------------------------------------- */
/* Corpos                                                                      */
/* -------------------------------------------------------------------------- */

class CreateFamilyInviteDto {
  /**
   * Dias de validade. `null` é sem prazo — e tem de ser escrito, não omitido: um
   * campo em falta seria um link eterno criado por engano.
   */
  @IsOptional()
  @IsIn([1, 7, 30, null])
  days?: number | null;
}

/** Uma família na lista de envio. O nome é opcional: nem sempre a secretaria o tem. */
class FamilyRecipientDto {
  @IsEmail({}, { message: "Endereço de email inválido" })
  email!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  name?: string;
}

/**
 * Para quem vai o link.
 *
 * Tecto de 50 por pedido. Não é o limite do serviço de email — é o limite do que faz
 * sentido escrever à mão de uma vez, e um pedido que envia mil emails em série é
 * um pedido que fica minutos aberto.
 */
class SendFamilyInviteDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Indica pelo menos um endereço" })
  @ArrayMaxSize(50, { message: "No máximo 50 endereços de cada vez" })
  @ValidateNested({ each: true })
  @Type(() => FamilyRecipientDto)
  recipients!: FamilyRecipientDto[];
}

/** As duas provas. Nunca uma só — ver `FamilyInvitesService`. */
class IdentifyChildDto {
  @IsString()
  @Matches(/^\d{9}$/, { message: "O NIF tem nove dígitos" })
  taxId!: string;

  @IsISO8601()
  birthdate!: string;
}

class RegisterFamilyDto extends IdentifyChildDto {
  @IsString() @Length(2, 120)
  name!: string;

  @IsString() @Length(3, 254)
  email!: string;

  @IsString() @Length(0, 40)
  phone!: string;

  @IsString() @Length(8, 200)
  password!: string;

  /** "Mãe", "Pai", "Encarregado" — texto livre, como no `GuardianLink`. */
  @IsString() @Length(0, 40)
  relation!: string;
}

/* -------------------------------------------------------------------------- */
/* Do lado da academia                                                         */
/* -------------------------------------------------------------------------- */

/**
 * O link das famílias, gerido pela secretaria.
 *
 * Controlador fino: quem pode o quê decide-se no serviço, com `can()`. Um
 * controlador que decide permissões é um controlador que as decide de forma
 * diferente do próximo.
 */
@Controller("api/family-invite")
export class FamilyInviteController {
  constructor(private readonly invites: FamilyInvitesService) {}

  /** O link vivo, ou `null` se ainda não há nenhum. */
  @Get()
  current(@Req() req: AuthedRequest) {
    return this.invites.current(req.ctx);
  }

  /** Gerar um novo — fecha o anterior no mesmo passo. */
  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateFamilyInviteDto) {
    return this.invites.create(req.ctx, body.days === undefined ? 7 : body.days);
  }

  /**
   * Mandar o link vivo por email.
   *
   * Apertado a 10 pedidos por minuto: cada um pode levar 50 endereços, e sem
   * tecto isto era uma máquina de mandar correio em nome do clube.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("enviar")
  send(@Req() req: AuthedRequest, @Body() body: SendFamilyInviteDto) {
    return this.invites.sendToFamilies(req.ctx, body.recipients);
  }

  @Delete()
  revoke(@Req() req: AuthedRequest) {
    return this.invites.revoke(req.ctx);
  }

  /**
   * Acrescentar outro educando, já com sessão.
   *
   * Vive aqui e não em `academy.controller` porque é a mesma prova do registo — o
   * par NIF+data — e a prova tem de ser a mesma nos dois sítios. Separá-la seria
   * deixar dois caminhos para reclamar uma criança, e um deles acabaria mais
   * frouxo.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("educandos")
  addChild(@Req() req: AuthedRequest, @Body() body: IdentifyChildDto) {
    return this.invites.addChild(req.ctx, body.taxId, body.birthdate);
  }
}

/* -------------------------------------------------------------------------- */
/* Do lado da família — sem sessão                                             */
/* -------------------------------------------------------------------------- */

/**
 * O registo de uma família.
 *
 * Público por obrigação: quem chega aqui ainda não tem conta, logo não pode ter
 * token de sessão. Quem autentica é o convite — e, sobretudo, o par NIF + data de
 * nascimento, que é o que decide a que criança a conta fica ligada.
 *
 * ## Os limites de tentativas não são cosmética
 *
 * Um NIF são nove dígitos. Sem limite, alguém com o link fixava uma data de
 * nascimento plausível e varria o espaço até encontrar um atleta desta academia —
 * e isto passava a ser um oráculo que confirma o clube de crianças. Com dez
 * tentativas por minuto por IP, o mesmo varrimento demora anos e aparece nos logs
 * muito antes disso.
 *
 * `registar` é mais apertado ainda, porque também toca no Supabase: quando o email
 * já tem conta, verificar a password é o que prova a identidade — e sem limite era
 * um oráculo de passwords.
 */
@Public()
@Controller()
export class FamilySignupController {
  constructor(private readonly invites: FamilyInvitesService) {}

  /**
   * O link que se manda aos pais.
   *
   * Não serve nada: **redirecciona para a landing do clube**, que é onde se
   * instala a app, com o convite agarrado ao endereço. O pai clica no WhatsApp,
   * abre no Chrome, instala, e entra — sem passar por um ecrã intermédio que só
   * existiria para dizer "carrega aqui".
   *
   * `/l/:slug/familia/:token` é o equivalente testável em desenvolvimento de
   * `{slug}.academias.pt/familia/:token`. O slug do caminho não decide nada — a
   * academia sai do token — mas está lá para quem recebe o link reconhecer o clube.
   */
  @Get("l/:slug/familia/:token")
  redirect(@Param("slug") slug: string, @Param("token") token: string, @Res() res: Response) {
    res.redirect(302, `/l/${encodeURIComponent(slug)}?convite=${encodeURIComponent(token)}`);
  }

  /** De que clube é este link. É o primeiro pedido que a app faz. */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get("api/convite-familia/:token")
  preview(@Param("token") token: string) {
    return this.invites.preview(token);
  }

  /** "É este o teu filho?" — confirma antes de pedir a password. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("api/convite-familia/:token/educando")
  find(@Param("token") token: string, @Body() body: IdentifyChildDto) {
    return this.invites.findAthlete(token, body.taxId, body.birthdate);
  }

  /** Criar a conta e ligá-la ao educando. Devolve a sessão — a app entra já dentro. */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("api/convite-familia/:token/registar")
  register(@Param("token") token: string, @Body() body: RegisterFamilyDto) {
    return this.invites.register(token, body);
  }
}
