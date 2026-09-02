import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Length } from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { PollsService } from "./polls.service";

class PollDto {
  @IsString() @Length(5, 200)
  question!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  details?: string;

  @IsArray()
  @ArrayMinSize(2, { message: "Uma sondagem precisa de pelo menos duas opções" })
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options!: string[];
}

/** Sondagens aos sócios — atrás de `member:read`/`member:write`, no serviço. */
@Controller("api/polls")
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.polls.list(req.ctx);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: PollDto) {
    return this.polls.create(req.ctx, body);
  }

  @Post(":id/publish")
  publish(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.polls.publish(req.ctx, id);
  }

  @Post(":id/close")
  close(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.polls.close(req.ctx, id);
  }

  @Delete(":id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.polls.remove(req.ctx, id);
  }
}
