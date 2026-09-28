import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule, ObserveInstrument, observeEnabled } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...(observeEnabled ? { instrument: ObserveInstrument } : {}),
  });

  // The API sits behind the Next.js proxy (and usually a load balancer), so
  // trust the first hop for client IPs and don't advertise the framework.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // JSON API only: nothing here should ever be framed, sniffed or cached by a shared proxy.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Close DB pools, Redis and queue workers cleanly on SIGTERM (deploys, scale-down).
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
