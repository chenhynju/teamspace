import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    // 保留原始请求体，供支付 webhook 做 Stripe 风格 HMAC 验签
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('APP_PORT', 3001);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('WEB_URL', 'http://localhost:3000').split(','),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('TeamSpace API')
    .setDescription('企业项目协作云 - 多租户 B2B SaaS')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.setGlobalPrefix('api/v1');

  // WebSocket 走 Redis adapter，多节点部署时房间广播/presence 跨节点一致
  const redisAdapter = new RedisIoAdapter(app);
  try {
    await redisAdapter.connectToRedis(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
    app.useWebSocketAdapter(redisAdapter);
  } catch (e) {
    Logger.warn(`Redis 不可用，WebSocket 降级为单机模式：${(e as Error).message}`, 'Bootstrap');
  }

  await app.listen(port);
  Logger.log(`TeamSpace API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
}
bootstrap();
