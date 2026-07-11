import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";

process.on("unhandledRejection", (reason) => {
  console.error("[kern-api] unhandled rejection (API kept running):", reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.KERN_PUBLIC_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });

  const port = Number(process.env.KERN_API_PORT ?? 3000);
  try {
    await app.listen(port);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the other process and retry:`);
      console.error(`  kill $(lsof -t -i:${port})`);
      process.exit(1);
    }
    throw error;
  }
  console.log(`KERN API listening on http://127.0.0.1:${port}/api`);
}

void bootstrap();
