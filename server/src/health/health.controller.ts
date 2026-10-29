/**
 * ============================================================================
 * MODULE: NESTJS HEALTH - CONTROLLER
 * ============================================================================
 * Endpoint GET /health:
 * Cung cấp thông tin giám sát sức khỏe dịch vụ và số lượng phòng gọi đang chạy.
 */

import { Controller, Get, Inject } from '@nestjs/common';
import { RoomService } from '../signaling/room.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(RoomService) private readonly roomService: RoomService) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'OmniCam NestJS WebRTC Signaling Server',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      activeRooms: this.roomService.getActiveRoomCount()
    };
  }
}
