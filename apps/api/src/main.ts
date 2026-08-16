import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  /**
   * O corpo em bruto é preservado para as rotas de webhook: a assinatura HMAC é
   * calculada sobre os bytes exactos que a euPago enviou, e um `JSON.parse` seguido
   * de `JSON.stringify` reordena chaves e invalida a verificação.
   */
  app.use(
    json({
      verify: (req, _res, buf) => {
        if (req.url?.startsWith("/webhooks/")) {
          (req as { rawBody?: string }).rawBody = buf.toString("utf8");
        }
      },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableCors({
    origin: [
      process.env.CONSOLE_ORIGIN ?? "http://localhost:5173",
      process.env.FAMILY_ORIGIN ?? "http://localhost:5174",
    ],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
