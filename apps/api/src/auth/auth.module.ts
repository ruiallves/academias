import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { SupabaseJwtService } from "./supabase-jwt.service";
import { PresenceService } from "../presence/presence.service";

/**
 * O guard é registado como `APP_GUARD` — global.
 *
 * É a escolha certa para isto: uma rota nova nasce protegida, e abrir uma exige
 * escrever `@Public()`. O contrário — proteger rota a rota — significa que a
 * próxima rota que alguém acrescentar num dia apressado fica aberta.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    SupabaseJwtService,
    AuthService,
    // Vive aqui porque quem a escreve é o guard, e o guard vive aqui. Exportada
    // porque quem a lê é a plataforma. Ver `presence.service.ts`.
    PresenceService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SupabaseJwtService, AuthService, PresenceService],
})
export class AuthModule {}
