import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { PrismaService } from "./prisma/prisma.service";
import { NotificationsService } from "./notifications/notifications.service";
import { EupagoClient } from "./billing/eupago.client";
import { BillingService } from "./billing/billing.service";
import { BillingController } from "./billing/billing.controller";
import { EupagoWebhookController } from "./billing/webhooks.controller";
import { LandingController } from "./landing/landing.controller";
import { LandingService } from "./landing/landing.service";

/**
 * Monólito modular.
 *
 * Um processo, módulos com fronteiras reais. Os módulos de Fase 2 e 3 — equipas,
 * sessões, presenças, avaliações — entram aqui à medida que forem precisos, com o
 * mesmo formato: serviço com âmbito, controlador fino, permissões verificadas no
 * serviço e não no controlador.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule],
  controllers: [BillingController, EupagoWebhookController, LandingController],
  providers: [PrismaService, NotificationsService, EupagoClient, BillingService, LandingService],
  exports: [PrismaService, NotificationsService],
})
export class AppModule {}
