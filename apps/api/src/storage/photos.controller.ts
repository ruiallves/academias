import { Body, Controller, Delete, Param, Post, Req } from "@nestjs/common";
import { IsIn, IsString, Length } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { PhotosService } from "./photos.service";

/**
 * O corpo do pedido de autorização.
 *
 * O tipo vem do cliente e é validado **duas vezes**: aqui, contra a lista do que se
 * aceita, e outra vez no bucket, que o Supabase impõe no carregamento. A primeira dá
 * uma mensagem em português a quem escolheu um PDF; a segunda é a que vale.
 */
class UploadPhotoDto {
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  contentType!: "image/jpeg" | "image/png" | "image/webp";
}

class ConfirmPhotoDto {
  @IsString()
  @Length(8, 200)
  key!: string;
}

/**
 * Fotografias.
 *
 * Duas fases por fotografia — pedir autorização, confirmar que chegou — e o
 * ficheiro nunca passa por aqui. Ver `photos.service.ts` para o porquê.
 */
@Controller("api")
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  /* ---- Atletas ----------------------------------------------------------- */

  @Post("athletes/:id/foto/upload")
  athleteUpload(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: UploadPhotoDto) {
    return this.photos.athleteUploadUrl(req.ctx, id, body.contentType);
  }

  @Post("athletes/:id/foto")
  athleteConfirm(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ConfirmPhotoDto) {
    return this.photos.setAthletePhoto(req.ctx, id, body.key);
  }

  @Delete("athletes/:id/foto")
  athleteRemove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.photos.removeAthletePhoto(req.ctx, id);
  }

  /* ---- Staff ------------------------------------------------------------- */

  @Post("staff/:id/foto/upload")
  staffUpload(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: UploadPhotoDto) {
    return this.photos.staffUploadUrl(req.ctx, id, body.contentType);
  }

  @Post("staff/:id/foto")
  staffConfirm(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: ConfirmPhotoDto) {
    return this.photos.setStaffPhoto(req.ctx, id, body.key);
  }

  @Delete("staff/:id/foto")
  staffRemove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.photos.removeStaffPhoto(req.ctx, id);
  }
}
