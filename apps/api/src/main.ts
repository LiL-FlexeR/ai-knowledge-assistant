import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_CONFIG } from './config/config.module';
import { ConfigurationError, parseEnvironment } from './config/environment';
import type { Environment } from './config/environment';
import { configureHttp } from './http';

async function bootstrap(): Promise<void> {
  // Validate before Nest's logger could inspect a failed provider.
  parseEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureHttp(app);
  app.enableShutdownHooks();
  const config = app.get<Environment>(API_CONFIG);
  await app.listen(config.API_PORT, '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'API startup failed; check local configuration and port availability.',
  );
  process.exitCode = 1;
});
