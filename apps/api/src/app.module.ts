import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { MailModule } from "./mail/mail.module";
import { AuthModule } from "./auth/auth.module";
import { PrismaService } from "./prisma/prisma.service";
import { NotificationsService } from "./notifications/notifications.service";
import { PushService } from "./notifications/push.service";
import { PushController } from "./notifications/push.controller";
import { NotificationsController } from "./notifications/notifications.controller";
import { EupagoClient } from "./billing/eupago.client";
import { BillingService } from "./billing/billing.service";
import { BillingController } from "./billing/billing.controller";
import { EupagoWebhookController } from "./billing/webhooks.controller";
import { LandingController } from "./landing/landing.controller";
import { LandingService } from "./landing/landing.service";
import { InvitesController, InvitePageController } from "./invites/invites.controller";
import { InvitesService } from "./invites/invites.service";
import { MembersController, PublicMembersController } from "./members/members.controller";
import { MembersService } from "./members/members.service";
import { ScoutingController, ScoutingVideoController, ScoutingWorkflowController } from "./scouting/scouting.controller";
import { ScoutingService } from "./scouting/scouting.service";
import { ScoutingVideoService } from "./scouting/scouting-video.service";
import { ScoutingWorkflowService } from "./scouting/scouting-workflow.service";
import { DepartmentsController } from "./departments/departments.controller";
import { DepartmentsService } from "./departments/departments.service";
import { RolesController } from "./roles/roles.controller";
import { RolesService } from "./roles/roles.service";
import { AcademyController } from "./academy/academy.controller";
import { AcademyService } from "./academy/academy.service";
import { CatalogsController } from "./academy/catalogs.controller";
import { CatalogsService } from "./academy/catalogs.service";
import { AthletesService } from "./academy/athletes.service";
import { MatchesController } from "./academy/matches.controller";
import { MatchesService } from "./academy/matches.service";
import { AnnouncementsController } from "./academy/announcements.controller";
import { AnnouncementsService } from "./academy/announcements.service";
import { PlatformController } from "./platform/platform.controller";
import { PlatformService } from "./platform/platform.service";
import { PlatformGuard } from "./platform/platform.guard";
import { PlatformPrisma } from "./platform/platform.prisma";
import { ContactsController, ContactsCalendarController } from "./platform/contacts.controller";
import { TicketsController } from "./platform/tickets.controller";
import { TicketsService } from "./platform/tickets.service";
import { SiteContactController } from "./platform/site-contact.controller";
import { ContactsService } from "./platform/contacts.service";
import { AdminsController, AdminInvitePageController } from "./platform/admin-invites.controller";
import { AdminInvitesService } from "./platform/admin-invites.service";
import { FamilyInviteController, FamilySignupController } from "./family/family-invites.controller";
import { FamilyInvitesService } from "./family/family-invites.service";
import { DevelopmentController } from "./development/development.controller";
import { EvaluationsService } from "./development/evaluations.service";
import { PhotosController } from "./storage/photos.controller";
import { PhotosService } from "./storage/photos.service";
import { ClubLogoController } from "./storage/club-logo.controller";
import { ClubLogoService } from "./storage/club-logo.service";
import { StorageService } from "./storage/storage.service";
import { ReportsService } from "./development/reports.service";
import { SupabaseAccountsService } from "./auth/supabase-accounts.service";
import { TenantAssetsController } from "./tenant/tenant-assets.controller";

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
    MailModule,
  ],
  controllers: [
    BillingController,
    EupagoWebhookController,
    LandingController,
    InvitesController,
    InvitePageController,
    AcademyController,
    CatalogsController,
    DepartmentsController,
    RolesController,
    ScoutingController,
    MembersController,
    // Público: a inscrição de sócio a partir da página do clube.
    PublicMembersController,
    ScoutingVideoController,
    ScoutingWorkflowController,
    MatchesController,
    AnnouncementsController,
    PushController,
    NotificationsController,
    PlatformController,
    ContactsController,
    AdminsController,
    AdminInvitePageController,
    FamilyInviteController,
    DevelopmentController,
    PhotosController,
    ClubLogoController,
    FamilySignupController,
    // Público por construção — o token no URL é que autentica. Ver o ficheiro.
    ContactsCalendarController,
    // Público por construção — é o formulário de contacto do site de marketing.
    TicketsController,
    SiteContactController,
    // O manifest da PWA com a marca do clube, na raiz da origem do clube.
    TenantAssetsController,
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
    CatalogsService,
    DepartmentsService,
    RolesService,
    ScoutingService,
    MembersService,
    ScoutingVideoService,
    ScoutingWorkflowService,
    AthletesService,
    MatchesService,
    AnnouncementsService,
    PlatformService,
    PlatformGuard,
    PlatformPrisma,
    TicketsService,
    ContactsService,
    AdminInvitesService,
    FamilyInvitesService,
    EvaluationsService,
    PhotosService,
    ClubLogoService,
    StorageService,
    ReportsService,
    SupabaseAccountsService,
  ],
  exports: [PrismaService, NotificationsService],
})
export class AppModule {}
