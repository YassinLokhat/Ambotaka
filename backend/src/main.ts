import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Derrière un reverse proxy (HTTPS), req.ip doit être l'IP du client (journal d'audit) : TRUST_PROXY=1 (nombre de proxys).
  if (process.env.TRUST_PROXY) (app.getHttpAdapter().getInstance() as any).set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.get<string[]>('corsOrigins') });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('RoadPulse API').setVersion('0.1.0').build(),
  );
  SwaggerModule.setup('api/docs', app, doc);

  await app.listen(config.get<number>('port')!);
}
bootstrap();
