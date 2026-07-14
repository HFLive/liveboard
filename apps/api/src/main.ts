import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>("API_PORT", 4000);
  const trustProxyHops = Number(config.get<string>("TRUST_PROXY_HOPS", "1"));
  const allowedOrigins = config
    .get<string>("WEB_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(cookieParser());
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", Number.isInteger(trustProxyHops) ? trustProxyHops : 1);
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(port, "0.0.0.0");
}

void bootstrap();
