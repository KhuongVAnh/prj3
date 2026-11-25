/**
 * ============================================================================
 * MODULE: NESTJS SIGNALING - HTTP BEACON LEAVE CONTROLLER
 * ============================================================================
 * Endpoint POST /api/leave-room:
 * Đón gói navigator.sendBeacon / fetch(keepalive) khi trình duyệt đóng tab hoặc
 * bị vuốt tắt trên điện thoại để ngắt phòng & báo peer-left tức thì, không phải
 * chờ Socket.IO pingTimeout.
 */

import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';

@Controller('api/leave-room')
export class SignalingController {
  constructor(
    @Inject(SignalingGateway) private readonly signalingGateway: SignalingGateway
  ) {}

  @Post()
  @HttpCode(200)
  leaveRoomBeacon(@Body() rawBody: any) {
    // Một số trình duyệt gửi sendBeacon dạng chuỗi text/plain thay vì JSON -> tự parse dự phòng
    let payload: { socketId?: string; roomId?: string; clientId?: string } = {};
    if (typeof rawBody === 'string') {
      try {
        payload = JSON.parse(rawBody);
      } catch (_) {}
    } else if (rawBody && typeof rawBody === 'object') {
      payload = rawBody;
    }

    // Gọi gateway dọn phòng & bắn peer-left ngay lập tức (idempotent nếu socket đã tự đóng trước đó)
    const removed = this.signalingGateway.forceLeaveByBeacon(payload);
    return { ok: true, removed };
  }
}
