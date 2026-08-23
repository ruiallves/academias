import { Body, Controller, Delete, Get, Header, Ip, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, Length, ValidateIf } from "class-validator";
import type { Response } from "express";
import { ContactChannel, ContactStatus } from "@prisma/client";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { ContactsService } from "./contacts.service";
import { renderIcs } from "./contacts.ics";

const ESTADOS = Object.values(ContactStatus);
const CANAIS = Object.values(ContactChannel);

/**
 * Os campos de um contacto.
 *
 * `@ValidateIf` no email e no telefone porque a lista serve para trabalhar com o
 * que se sabe: um nome e um clube, sem contacto nenhum, é uma linha legítima —
 * é o estado normal de quem ainda só se ouviu falar. Exigir email aqui obrigaria a
 * inventar um, e um email inventado é pior do que nenhum.
 */
class ContactDto {
  /**
   * Opcional no tipo, obrigatório na criação.
   *
   * O mesmo corpo serve o `POST` e o `PATCH` — e um `PATCH` que só muda o estado
   * não tem por que repetir o nome. Quem exige o nome é o serviço, no sítio onde
   * sabe se está a criar ou a alterar; duas classes quase iguais seriam dois sítios
   * onde as regras podem divergir.
   */
  @IsOptional() @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @IsString() @Length(0, 40)
  phone?: string;

  @IsOptional() @ValidateIf((_, v) => v !== "" && v !== null) @IsEmail() @Length(0, 254)
  email?: string;

  @IsOptional() @IsString() @Length(0, 160)
  club?: string;

  @IsOptional() @IsString() @Length(0, 80)
  role?: string;

  @IsOptional() @IsIn(ESTADOS)
  status?: ContactStatus;

  @IsOptional() @IsString() @Length(0, 4000)
  notes?: string;

  @IsOptional() @IsString()
  academyId?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601()
  nextActionAt?: string | null;

  @IsOptional() @IsString() @Length(0, 200)
  nextActionNote?: string;
}

class TouchDto {
  @IsIn(CANAIS)
  channel!: ContactChannel;

  @IsOptional() @IsString() @Length(0, 2000)
  note?: string;

  @IsOptional() @IsIn(ESTADOS)
  status?: ContactStatus;

  @IsOptional() @IsISO8601()
  happenedAt?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601()
  nextActionAt?: string | null;

  @IsOptional() @IsString() @Length(0, 200)
  nextActionNote?: string;
}

class CalendarDto {
  /** Deitar fora o link anterior e emitir outro. Ver `ContactsService.calendarUrl`. */
  @IsOptional() @IsBoolean()
  rotate?: boolean;
}

/**
 * Contactos, do lado do painel.
 *
 * `@Public()` desliga o guard **das academias** e `@UseGuards(PlatformGuard)` põe o
 * desta no lugar — exactamente como em `platform.controller.ts`, e pela mesma
 * razão: estes pedidos não pertencem a nenhum tenant. As rotas não ficam abertas,
 * ficam com outra porta.
 *
 * Escrita aberta a `SUPPORT`, ao contrário de criar academias. É deliberado: quem
 * dá apoio também fala com clubes, e registar uma chamada não mexe em faturação
 * nem cria clientes. Apagar é que não — isso é `OWNER`/`ADMIN`.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform/contactos")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list() {
    return this.contacts.list();
  }

  /**
   * O endereço do feed para o Google Calendar.
   *
   * `POST` e não `GET` porque a primeira chamada **cria** um segredo. Um `GET` que
   * muda estado é o tipo de coisa que um pré-carregador de browser dispara sozinho.
   */
  @Post("agenda")
  calendar(@Req() req: PlatformRequest, @Ip() ip: string, @Body() body: CalendarDto) {
    return this.contacts.calendarUrl(req.admin, body.rotate === true, ip);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.contacts.get(id);
  }

  @Post()
  create(@Req() req: PlatformRequest, @Ip() ip: string, @Body() body: ContactDto) {
    return this.contacts.create(req.admin, body, ip);
  }

  @Patch(":id")
  update(@Req() req: PlatformRequest, @Param("id") id: string, @Body() body: ContactDto) {
    return this.contacts.update(req.admin, id, body);
  }

  /** Registar uma chamada, um email, uma reunião — e o que ficou combinado a seguir. */
  @Post(":id/interacoes")
  touch(@Req() req: PlatformRequest, @Param("id") id: string, @Body() body: TouchDto) {
    return this.contacts.addTouch(req.admin, id, body);
  }

  @Delete(":id")
  @PlatformRoles("OWNER", "ADMIN")
  remove(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.contacts.remove(req.admin, id, ip);
  }
}

/**
 * O feed que o Google Calendar subscreve.
 *
 * ## Porque é que este controlador é outro
 *
 * Porque **não pode** ter o `PlatformGuard`. Uma subscrição de calendário é um
 * `GET` anónimo feito pelos servidores do Google, sem cabeçalho de sessão e sem
 * forma de lhe acrescentar um. O que autentica é o token no URL.
 *
 * Está num controlador à parte, com um prefixo à parte, precisamente para que isso
 * se veja: ninguém acrescenta uma rota nova aqui a pensar que está protegida como
 * as de cima. Tudo o que entrar neste ficheiro é público por construção.
 *
 * ## O que se perde e o que não
 *
 * Quem tiver o link vê os seguimentos marcados — nome, clube, telefone e a nota do
 * próximo passo. Não vê o histórico das conversas, não vê contactos sem data
 * marcada, não vê nada de nenhuma academia. E o link revoga-se: `POST /agenda`
 * com `rotate`.
 */
@Public()
@Controller("api/agenda/contactos")
export class ContactsCalendarController {
  constructor(private readonly contacts: ContactsService) {}

  /**
   * `:token` e não `:token.ics` no padrão da rota: o `.ics` é aparado aqui.
   *
   * O sufixo existe porque há clientes de calendário que decidem o que estão a
   * receber pela extensão do URL antes de olharem para o `Content-Type` — mas
   * pô-lo no padrão da rota depende de como a versão do Express em uso trata o
   * ponto, e isso é dependência a mais para um detalhe cosmético.
   */
  @Get(":token")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async ics(@Param("token") token: string, @Res({ passthrough: true }) res: Response) {
    const feed = await this.contacts.feedFor(token.replace(/\.ics$/i, ""));

    // 404 e não 401: um token errado não é uma sessão por renovar, é um endereço
    // que não existe. E não diz se existiu alguma vez.
    if (!feed) {
      res.status(404);
      return "Feed não encontrado";
    }

    res.setHeader("Content-Disposition", 'inline; filename="seguimentos.ics"');
    return renderIcs(feed.contacts, `Seguimentos · ${feed.admin.name}`);
  }
}
