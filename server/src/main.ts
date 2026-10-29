/**
 * ============================================================================
 * MODULE: NESTJS MAIN ENTRYPOINT
 * ============================================================================
 * Khởi động máy chủ NestJS:
 *  - Phục vụ Web Application tĩnh tại `server/frontend`
 *  - Phục vụ WebSocket Signaling Gateway cho WebRTC đa camera
 *  - Cung cấp API giám sát tại /health
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SERVER_CONFIG } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Kích hoạt CORS cho phép các kết nối từ trình duyệt
  app.enableCors({
    origin: SERVER_CONFIG.CORS_ORIGIN,
    methods: ['GET', 'POST']
  });

  const port = SERVER_CONFIG.PORT;
  await app.listen(port);

  console.log('================================================================');
  console.log(`[NestJS] OmniCam Single Artifact Server đang chạy tại: http://localhost:${port}`);
  console.log(`[NestJS] Web Application (Frontend): http://localhost:${port}`);
  console.log(`[NestJS] API Health Check: http://localhost:${port}/health`);
  console.log(`[NestJS] WebSocket Signaling Gateway: ws://localhost:${port}/socket.io/`);
  console.log('================================================================');
}

bootstrap();
