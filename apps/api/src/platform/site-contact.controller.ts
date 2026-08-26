import { Body, Controller, Ip, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsOptional, IsString, Length } from "class-validator";
import { Public } from "../auth/auth.guard";
import { TicketsService } from "./tickets.service";

class SiteContactDto {
  @IsString() @Length(2, 120)
  name!: string;

  @IsEmail() @Length(3, 254)
  email!: string;

  @IsOptional() @IsString() @Length(0, 40)
  phone?: string;

  @IsOptional() @IsString() @Length(0, 160)
  club?: string;

  @IsString() @Length(2, 80)
  subject!: string;

  /**
   * O id do assunto, estável: "experimentar", "reuniao", "outro".
   *
   * Opcional porque o site antigo não o mandava, e um pedido de um separador
   * aberto há uma semana não pode falhar por causa de um campo novo. O rótulo em
   * `subject` chega sempre; isto é o que deixa filtrar sem depender de texto que
   * alguém pode reescrever.
   */
  @IsOptional() @IsString() @Length(0, 40)
  subjectId?: string;

  @IsOptional() @IsString() @Length(0, 20)
  athletes?: string;

  @IsOptional() @IsString() @Length(0, 4000)
  message?: string;
}

/**
 * O formulário de contacto do site — a entrada da frente.
 *
 * ## Porque é que isto é um controlador à parte, e não uma rota em `contacts.controller.ts`
 *
 * Porque tudo o resto naquele ficheiro está atrás do `PlatformGuard`: é a consola
 * interna, para quem já é dos nossos. Isto é o oposto — **ninguém** que chegue
 * aqui tem sessão, e é assim que tem de ser: é o site de marketing, aberto ao
 * mundo, a mandar o primeiro contacto de um clube para dentro da nossa CRM.
 *
 * Separar o ficheiro é a mesma disciplina de `ContactsCalendarController`: um
 * controlador inteiro que é público por construção não deixa ninguém acrescentar
 * uma rota nova aqui a pensar que está protegida.
 *
 * ## Porque é que isto cria um `Ticket` e não um `Contact`
 *
 * Criava um contacto, e enfiava o assunto, o número de atletas e a mensagem todos
 * dentro do campo `notes` como texto corrido. Perdia o dado — "Atletas: 120"
 * dentro de uma string não se filtra nem se conta — e metia uma pergunta de um
 * curioso na mesma lista de quem a equipa anda a trabalhar, com responsável e
 * próximo passo no calendário.
 *
 * A caixa de entrada e o funil de vendas são coisas diferentes. Quem decidir que
 * um pedido é mesmo um negócio converte-o, e aí sim nasce um contacto. Ver
 * `TicketsService`.
 *
 * ## Porque é que isto substitui o `mailto:`
 *
 * Um botão que abre o cliente de email do visitante não garante nada — não há
 * cliente de email configurado, o browser bloqueia o popup, a pessoa fecha a
 * janela sem carregar em enviar. Isto grava o contacto na base de dados antes de
 * a página dizer "enviado", por isso "enviado" passa a ser verdade.
 *
 * ## Porque é que está apertado
 *
 * Um `POST` público e sem autenticação que escreve na base de dados é, por
 * definição, uma superfície de spam. Cinco pedidos por minuto por IP chegam para
 * qualquer pessoa a preencher um formulário a sério, e travam um script a martelar
 * o endpoint.
 */
@Public()
@Controller("api/site")
export class SiteContactController {
  constructor(private readonly tickets: TicketsService) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("contacto")
  create(@Body() body: SiteContactDto, @Ip() ip: string) {
    return this.tickets.createFromSite(body, ip);
  }
}
