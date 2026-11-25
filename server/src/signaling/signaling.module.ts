/**
 * ============================================================================
 * MODULE: NESTJS SIGNALING - MODULE REGISTRATION
 * ============================================================================
 */

import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';
import { SignalingController } from './signaling.controller';
import { RoomService } from './room.service';

@Module({
  controllers: [SignalingController],
  providers: [SignalingGateway, RoomService],
  exports: [RoomService]
})
export class SignalingModule {}
