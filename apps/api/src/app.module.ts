import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { PrismaService } from "./prisma/prisma.service";
import { NotificationsService } from "./notifications/notifications.service";
import { PushService } from "./notifications/push.service";
import { PushController } from "./notifications/push.controller";
import { EupagoClient } from "./billing/eupago.client";
import { BillingService } from "./billing/billing.service";
import { BillingController } from "./billing/billing.controller";
import { EupagoWebhookController } from "./billing/webhooks.controller";
import { LandingController } from "./landing/landing.controller";
import { LandingService } from "./landing/landing.service";
import { InvitesController, InvitePageController } from "./invites/invites.controller";
import { InvitesService } from "./invites/invites.service";
import { AcademyController } from "./academy/academy.controller";
import { AcademyService } from "./academy/academy.service";
import { AthletesService } from "./academy/athletes.service";
import { MatchesController } from "./academy/matches.controller";
import { MatchesService } from "./academy/matches.service";
import { AnnouncementsController } from "./academy/announcements.controller";
import { AnnouncementsService } from "./academy/announcements.service";
import { PlatformController } from "./platform/platform.controller";
import { PlatformService } from "./platform/platform.service";
import { PlatformGuard } from "./platform/platform.guard";
import { PlatformPrisma } from "./platform/platform.prisma";

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
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    /*
     * Rate-limiting global.
     *
     * Um tecto largo por IP — 120 pedidos por minuto — que não estorva o uso
     * normal da consola mas trava a inundação de webhooks e a raspagem de
     * endpoints. As rotas sensíveis (login de convite, resgate) apertam-no com
     * `@Throttle` próprio. Sem isto, o *password oracle* do resgate de convite
     * era força bruta ilimitada contra a conta de um diretor.
     */
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
  ],
  controllers: [
    BillingController,
    EupagoWebhookController,
    LandingController,
    InvitesController,
    InvitePageController,
    AcademyController,
    MatchesController,
    AnnouncementsController,
    PushController,
    PlatformController,
  ],
  providers: [
    // O throttler como guard global — aplica-se a todas as rotas, incluindo as
    // `@Public()`, que são precisamente as mais expostas.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    PrismaService,
    NotificationsService,
    PushService,
    EupagoClient,
    BillingService,
    LandingService,
    InvitesService,
    AcademyService,
    AthletesService,
    MatchesService,
    AnnouncementsService,
    PlatformService,
    PlatformGuard,
    PlatformPrisma,
  ],
  exports: [PrismaService, NotificationsService],
})
export class AppModule {}
