/**
 * ============================================================================
 * MODULE: NESTJS SIGNALING - WEBSOCKET GATEWAY (SignalingGateway)
 * ============================================================================
 * Gateway quản lý toàn bộ luồng tín hiệu WebRTC qua Socket.io trong NestJS:
 *  - Chuyển tiếp SDP Offer/Answer và ICE Candidate.
 *  - Đồng bộ Metadata camera đa luồng (Multi-Camera state synchronization).
 *  - Chuyển phát tin nhắn văn bản tức thời (In-Call chat).
 *  - Quản lý sự kiện kết nối/ngắt kết nối người dùng.
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RoomService } from './room.service';
import { CameraMetaPayload, ChatMessagePayload } from '../types';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(@Inject(RoomService) private readonly roomService: RoomService) {}

  /**
   * Xử lý khi có client kết nối mới
   */
  handleConnection(client: Socket) {
    console.log(`[SignalingGateway] Client đã kết nối: ${client.id}`);
  }

  /**
   * Xử lý khi client ngắt kết nối đột ngột
   */
  handleDisconnect(client: Socket) {
    console.log(`[SignalingGateway] Client ngắt kết nối: ${client.id}`);
    this.processLeave(client);
  }

  /**
   * SỰ KIỆN: 'join-room'
   * Client yêu cầu tham gia phòng 1-1
   */
  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; userName: string }
  ) {
    const cleanRoomId = this.roomService.sanitizeRoomId(data?.roomId);
    const userName = (data?.userName || 'Khách').trim();

    // Lưu username vào socket data để truy xuất khi chat/ngắt kết nối
    client.data.userName = userName;

    const result = this.roomService.joinRoom(cleanRoomId, client.id, userName);

    // Xử lý khi phòng đã đủ 2 người
    if (!result.success && result.isFull) {
      client.emit('room-full', { roomId: cleanRoomId, max: 2 });
      console.log(`[SignalingGateway] Phòng [${cleanRoomId}] đã đủ 2 người. Từ chối: ${client.id}`);
      return;
    }

    const participant = result.participant!;
    const room = result.room!;

    client.join(cleanRoomId);
    console.log(
      `[SignalingGateway] ${client.id} (${userName}) vào phòng [${cleanRoomId}]. isPolite=${participant.isPolite}. Sĩ số: ${room.participants.size}/2`
    );

    // Thông báo cho người đang có trong phòng biết có người mới vào
    client.to(cleanRoomId).emit('peer-joined', {
      peerId: client.id,
      peerName: userName,
      isPolite: participant.isPolite
    });

    // Cung cấp danh sách các peer có sẵn cho người mới
    const existingPeers = Array.from(room.participants.values())
      .filter(p => p.id !== client.id)
      .map(p => ({
        peerId: p.id,
        peerName: p.name,
        isPolite: p.isPolite,
        cameras: p.cameras,
        isMuted: p.isMuted
      }));

    client.emit('room-joined', {
      roomId: cleanRoomId,
      yourId: client.id,
      isPolite: participant.isPolite,
      peers: existingPeers
    });
  }

  /**
   * SỰ KIỆN: 'signal-offer'
   * Chuyển tiếp SDP Offer
   */
  @SubscribeMessage('signal-offer')
  handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      targetId?: string;
      offer: any;
      camerasMeta?: CameraMetaPayload[];
    }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    const payload = {
      senderId: client.id,
      senderName: client.data.userName || 'Khách',
      offer: data.offer,
      camerasMeta: data.camerasMeta
    };

    if (data.targetId) {
      this.server.to(data.targetId).emit('signal-offer', payload);
    } else {
      client.to(roomId).emit('signal-offer', payload);
    }
  }

  /**
   * SỰ KIỆN: 'signal-answer'
   * Chuyển tiếp SDP Answer
   */
  @SubscribeMessage('signal-answer')
  handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      targetId?: string;
      answer: any;
      camerasMeta?: CameraMetaPayload[];
    }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    const payload = {
      senderId: client.id,
      senderName: client.data.userName || 'Khách',
      answer: data.answer,
      camerasMeta: data.camerasMeta
    };

    if (data.targetId) {
      this.server.to(data.targetId).emit('signal-answer', payload);
    } else {
      client.to(roomId).emit('signal-answer', payload);
    }
  }

  /**
   * SỰ KIỆN: 'signal-ice-candidate'
   * Chuyển tiếp ICE Candidate
   */
  @SubscribeMessage('signal-ice-candidate')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetId?: string; candidate: any }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    const payload = {
      senderId: client.id,
      candidate: data.candidate
    };

    if (data.targetId) {
      this.server.to(data.targetId).emit('signal-ice-candidate', payload);
    } else {
      client.to(roomId).emit('signal-ice-candidate', payload);
    }
  }

  /**
   * SỰ KIỆN: 'camera-state-update'
   * Đồng bộ danh sách camera đang ON AIR
   */
  @SubscribeMessage('camera-state-update')
  handleCameraUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { cameras: any[] }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    this.roomService.updateCameras(roomId, client.id, data.cameras);
    client.to(roomId).emit('peer-camera-updated', {
      peerId: client.id,
      cameras: data.cameras
    });
  }

  /**
   * SỰ KIỆN: 'mic-state-update'
   * Đồng bộ trạng thái micro
   */
  @SubscribeMessage('mic-state-update')
  handleMicUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { isMuted: boolean }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    this.roomService.updateMicState(roomId, client.id, data.isMuted);
    client.to(roomId).emit('peer-mic-updated', {
      peerId: client.id,
      isMuted: data.isMuted
    });
  }

  /**
   * SỰ KIỆN: 'pin-state-update'
   * Đồng bộ ID camera đang được người xem ghim tiêu điểm (Spotlight Pin)
   * để bên gửi tự động nâng/hạ chất lượng luồng video phát đi
   */
  @SubscribeMessage('pin-state-update')
  handlePinUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pinnedCameraId: string | null }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    client.to(roomId).emit('peer-pin-updated', {
      peerId: client.id,
      pinnedCameraId: data?.pinnedCameraId ?? null
    });
  }

  /**
   * SỰ KIỆN: 'send-chat'
   * Chuyển phát tin nhắn văn bản tức thời
   */
  @SubscribeMessage('send-chat')
  handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string }
  ) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId || !data?.text?.trim()) return;

    const message: ChatMessagePayload = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      senderId: client.id,
      senderName: client.data.userName || 'Khách',
      text: data.text.trim().slice(0, 1000),
      timestamp: Date.now()
    };

    this.server.to(roomId).emit('chat-message', message);
  }

  /**
   * SỰ KIỆN: 'leave-room'
   */
  @SubscribeMessage('leave-room')
  handleLeaveRoom(@ConnectedSocket() client: Socket) {
    this.processLeave(client);
  }

  /**
   * Xử lý dọn dẹp khi người dùng rời phòng
   */
  private processLeave(client: Socket) {
    const roomId = this.roomService.getRoomIdBySocketId(client.id);
    if (!roomId) return;

    const { removed, remainingCount, peerName } = this.roomService.leaveRoom(roomId, client.id);

    if (removed) {
      console.log(
        `[SignalingGateway] ${client.id} (${peerName}) đã rời phòng [${roomId}]. Còn lại: ${remainingCount}`
      );

      client.to(roomId).emit('peer-left', {
        peerId: client.id,
        peerName: peerName || client.data.userName || 'Khách'
      });
    }

    client.leave(roomId);
  }
}
