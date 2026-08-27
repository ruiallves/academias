import { Global, Module } from "@nestjs/common";
import { MailClient } from "./mail.client";

/**
 * O correio, disponível em todo o lado.
 *
 * `@Global` pela mesma razão que o Prisma o é: quem precisa de mandar um email
 * está espalhado por vários módulos (convites de staff, de família, da
 * plataforma) e importar o módulo em cada um deles era cerimónia sem conteúdo.
 */
@Global()
@Module({
  providers: [MailClient],
  exports: [MailClient],
})
export class MailModule {}
