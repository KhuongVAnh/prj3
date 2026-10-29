/**
 * ============================================================================
 * MODULE: NESTJS ROOT APP MODULE
 * ============================================================================
 * Root module tích hợp:
 *  1. ServeStaticModule: Phục vụ trực tiếp thư mục `server/frontend` (sản phẩm build của client).
 *     - Hỗ trợ SPA Routing (mọi route web đều điều hướng về index.html).
 *     - Loại trừ các đường dẫn WebSocket (/socket.io) và API (/health).
 *  2. SignalingModule: Module WebSocket Gateway quản lý WebRTC 1-1 đa camera.
 *  3. HealthController: REST API giám sát sức khỏe dịch vụ.
 */

import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { SignalingModule } from './signaling/signaling.module';
import { HealthController } from './health/health.controller';

// Đảm bảo thư mục frontend luôn tồn tại để ServeStaticModule không ném lỗi nếu client chưa build
const frontendPath = join(__dirname, '..', 'frontend');
if (!existsSync(frontendPath)) {
  try {
    mkdirSync(frontendPath, { recursive: true });
  } catch (_) {}
}

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: frontendPath,
      exclude: ['/api*', '/health*', '/socket.io*'],
      serveStaticOptions: {
        index: 'index.html',
        fallthrough: true
      }
    }),
    SignalingModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
