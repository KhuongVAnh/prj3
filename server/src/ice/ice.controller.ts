/**
 * ============================================================================
 * MODULE: NESTJS ICE/TURN - REST CONTROLLER
 * ============================================================================
 * Endpoint GET /api/ice-servers:
 * Trả về cấu hình STUN/TURN mới nhất cho WebRTC RTCPeerConnection.
 */

import { Controller, Get, Inject } from '@nestjs/common';
import { IceService } from './ice.service';

@Controller('api/ice-servers')
export class IceController {
  constructor(@Inject(IceService) private readonly iceService: IceService) {}

  @Get()
  async getIceServers() {
    return this.iceService.getIceServers();
  }
}
