/**
 * ============================================================================
 * MODULE: NESTJS SIGNALING - MODULE REGISTRATION
 * ============================================================================
 */

import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';
import { RoomService } from './room.service';

@Module({
  providers: [SignalingGateway, RoomService],
  exports: [RoomService]
})
export class SignalingModule {}
