import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });

  const port = Number(process.env.KERN_API_PORT ?? 3000);
  await app.listen(port);
  console.log(`KERN API listening on http://127.0.0.1:${port}/api`);
}

void bootstrap();
