import { Body, Controller, Delete, Post, Req } from "@nestjs/common";
import { IsIn, IsString, Length } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { ClubLogoService } from "./club-logo.service";

class UploadLogoDto {
  @IsIn(["image/png", "image/webp", "image/jpeg"])
  contentType!: "image/png" | "image/webp" | "image/jpeg";
}

class ConfirmLogoDto {
  @IsString()
  @Length(8, 300)
  key!: string;
}

/**
 * O símbolo do clube.
 *
 * Duas fases, como as fotografias: pedir autorização, confirmar que chegou. A
 * diferença está no bucket, que é público — ver `club-logo.service.ts`.
 */
@Controller("api/identidade")
export class ClubLogoController {
  constructor(private readonly logo: ClubLogoService) {}

  @Post("simbolo/upload")
  upload(@Req() req: AuthedRequest, @Body() body: UploadLogoDto) {
    return this.logo.signUpload(req.ctx, body.contentType);
  }

  @Post("simbolo")
  confirm(@Req() req: AuthedRequest, @Body() body: ConfirmLogoDto) {
    return this.logo.confirm(req.ctx, body.key);
  }

  @Delete("simbolo")
  remove(@Req() req: AuthedRequest) {
    return this.logo.remove(req.ctx);
  }
}
