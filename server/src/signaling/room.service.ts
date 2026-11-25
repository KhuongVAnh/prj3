/**
 * ============================================================================
 * MODULE: NESTJS SIGNALING - ROOM SERVICE
 * ============================================================================
 * Dịch vụ quản lý trạng thái phòng họp 1-1 và phân chia vai trò đàm phán:
 *  - Quản lý vòng đời phòng (khởi tạo, thêm/xóa thành viên, giải phóng bộ nhớ).
 *  - Thực thi giới hạn phòng 1-1 (tối đa 2 người).
 *  - Phân định vai trò W3C Perfect Negotiation (Polite vs Impolite):
 *    * Initiator (người thứ 1): isPolite = false
 *    * Callee (người thứ 2): isPolite = true
 */

import { Injectable } from '@nestjs/common';
import {
  RoomData,
  RoomParticipant,
  CameraInfo,
  WhiteboardState,
  WhiteboardStroke
} from '../types';
import { SERVER_CONFIG } from '../config';

@Injectable()
export class RoomService {
  // Bảng lưu trữ toàn bộ các phòng đang hoạt động: roomId -> RoomData
  private rooms: Map<string, RoomData> = new Map();

  // Bản đồ tra cứu nhanh: socketId -> roomId
  private socketToRoomMap: Map<string, string> = new Map();

  /**
   * Chuẩn hóa mã phòng (chuyển chữ thường, cắt bỏ khoảng trắng)
   */
  public sanitizeRoomId(roomId: string): string {
    return (roomId || 'default').trim().toLowerCase();
  }

  /**
   * Lấy thông tin phòng theo mã phòng
   */
  public getRoom(roomId: string): RoomData | undefined {
    return this.rooms.get(this.sanitizeRoomId(roomId));
  }

  /**
   * Lấy tổng số phòng đang hoạt động
   */
  public getActiveRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Tìm mã phòng mà một socket ID đang tham gia
   */
  public getRoomIdBySocketId(socketId: string): string | null {
    return this.socketToRoomMap.get(socketId) || null;
  }

  /**
   * Tìm socketId hiện tại theo clientId trong một phòng (hỗ trợ beacon rời phòng khi đóng tab)
   */
  public findSocketIdByClientId(rawRoomId: string, clientId: string): string | null {
    const room = this.getRoom(rawRoomId);
    if (!room || !clientId) return null;
    for (const [socketId, participant] of room.participants.entries()) {
      if (participant.clientId === clientId) {
        return socketId;
      }
    }
    return null;
  }

  /**
   * Thêm một người dùng mới vào phòng họp:
   */
  public joinRoom(
    rawRoomId: string,
    socketId: string,
    userName: string,
    clientId?: string
  ): {
    success: boolean;
    isFull?: boolean;
    participant?: RoomParticipant;
    room?: RoomData;
    replacedSocketId?: string;
  } {
    const roomId = this.sanitizeRoomId(rawRoomId);
    let room = this.rooms.get(roomId);

    if (!room) {
      room = {
        id: roomId,
        participants: new Map(),
        createdAt: Date.now(),
        negotiationEpoch: 1,
        whiteboard: {
          isOpen: false,
          ownerId: null,
          ownerName: null,
          showGrid: false,
          strokes: []
        }
      };
      this.rooms.set(roomId, room);
    }

    // Nếu cùng một tab (clientId) reconnect trước khi socket cũ hết pingTimeout -> thay thế slot cũ thay vì báo room-full
    let replacedSocketId: string | undefined;
    let preservedCameras: CameraInfo[] = [];
    let preservedMuted = false;
    if (clientId) {
      for (const [existingSocketId, existingParticipant] of room.participants.entries()) {
        if (existingParticipant.clientId === clientId && existingSocketId !== socketId) {
          replacedSocketId = existingSocketId;
          preservedCameras = existingParticipant.cameras;
          preservedMuted = existingParticipant.isMuted;
          room.participants.delete(existingSocketId);
          this.socketToRoomMap.delete(existingSocketId);
          if (room.whiteboard.ownerId === existingSocketId) {
            room.whiteboard.ownerId = socketId;
          }
          break;
        }
      }
    }

    // Kiểm tra giới hạn 1-1 (tối đa 2 người)
    if (
      room.participants.size >= SERVER_CONFIG.MAX_PARTICIPANTS_PER_ROOM &&
      !room.participants.has(socketId)
    ) {
      return { success: false, isFull: true };
    }

    /**
     * W3C Perfect Negotiation:
     * Luôn đảm bảo 2 người trong phòng mang vai trò đối lập nhau (1 Impolite, 1 Polite),
     * kể cả khi người vào đầu rời đi và có người mới thế chỗ.
     */
    const otherPeer = Array.from(room.participants.values()).find(p => p.id !== socketId);
    const isPolite = otherPeer ? !otherPeer.isPolite : false;

    // Tăng epoch mỗi khi đủ cặp peer mới để cô lập hoàn toàn với các gói signaling cũ
    if (otherPeer) {
      room.negotiationEpoch += 1;
    }

    const participant: RoomParticipant = {
      id: socketId,
      clientId,
      name: (userName || 'Khách').trim(),
      joinedAt: Date.now(),
      isPolite,
      cameras: preservedCameras,
      isMuted: preservedMuted
    };

    room.participants.set(socketId, participant);
    this.socketToRoomMap.set(socketId, roomId);

    return { success: true, participant, room, replacedSocketId };
  }

  /**
   * Tăng bộ đếm phiên đàm phán WebRTC (epoch) một cách nguyên tử trên server:
   * - Nếu client gửi kèm fromEpoch < room.negotiationEpoch => nghĩa là bên kia đã nâng tầng trước rồi,
   *   trả về bumped=false để server bỏ qua yêu cầu trùng lặp.
   * - Ngược lại tăng negotiationEpoch lên 1 và trả về bumped=true để broadcast cho cả 2 peer cùng tạo lại PC.
   */
  public bumpNegotiationEpoch(
    roomId: string,
    fromEpoch?: number
  ): { bumped: boolean; epoch: number } | null {
    const room = this.getRoom(roomId);
    if (!room) return null;

    if (typeof fromEpoch === 'number' && fromEpoch < room.negotiationEpoch) {
      return { bumped: false, epoch: room.negotiationEpoch };
    }

    room.negotiationEpoch += 1;
    return { bumped: true, epoch: room.negotiationEpoch };
  }

  /**
   * Cập nhật danh sách camera của một người tham gia
   */
  public updateCameras(roomId: string, socketId: string, cameras: CameraInfo[]): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    const participant = room.participants.get(socketId);
    if (!participant) return false;

    participant.cameras = cameras;
    return true;
  }

  /**
   * Cập nhật trạng thái bật/tắt micro
   */
  public updateMicState(roomId: string, socketId: string, isMuted: boolean): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    const participant = room.participants.get(socketId);
    if (!participant) return false;

    participant.isMuted = isMuted;
    return true;
  }

  /**
   * Bật/Tắt Bảng trắng với khóa độc quyền 1 trong 2 người:
   * - Khi bảng chưa mở: ai bật trước sẽ trở thành ownerId.
   * - Khi bảng đang mở: chỉ ownerId mới được phép tắt; người kia bị từ chối.
   * - Giữ nguyên danh sách nét vẽ (strokes) suốt phiên phòng họp.
   */
  public toggleWhiteboard(
    roomId: string,
    socketId: string,
    userName: string,
    nextOpen: boolean
  ): { ok: boolean; reason?: 'not-found' | 'already-open' | 'not-owner'; whiteboard?: WhiteboardState } {
    const room = this.getRoom(roomId);
    if (!room) return { ok: false, reason: 'not-found' };

    const wb = room.whiteboard;
    if (nextOpen) {
      if (wb.isOpen && wb.ownerId && wb.ownerId !== socketId) {
        return { ok: false, reason: 'already-open', whiteboard: wb };
      }
      wb.isOpen = true;
      wb.ownerId = socketId;
      wb.ownerName = userName;
      return { ok: true, whiteboard: wb };
    } else {
      if (wb.ownerId && wb.ownerId !== socketId) {
        return { ok: false, reason: 'not-owner', whiteboard: wb };
      }
      wb.isOpen = false;
      wb.ownerId = null;
      wb.ownerName = null;
      return { ok: true, whiteboard: wb };
    }
  }

  /**
   * Lưu nét vẽ đã hoàn thành vào phòng (giới hạn 2000 nét để bảo vệ bộ nhớ)
   */
  public addWhiteboardStroke(roomId: string, stroke: WhiteboardStroke): boolean {
    const room = this.getRoom(roomId);
    if (!room || !room.whiteboard.isOpen) return false;
    if (room.whiteboard.strokes.length >= 2000) {
      room.whiteboard.strokes.shift();
    }
    room.whiteboard.strokes.push(stroke);
    return true;
  }

  /**
   * Hoàn tác nét vẽ gần nhất của chính người gọi
   */
  public undoWhiteboardStroke(roomId: string, socketId: string): string | null {
    const room = this.getRoom(roomId);
    if (!room || !room.whiteboard.isOpen) return null;

    const strokes = room.whiteboard.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i].authorId === socketId) {
        const [removed] = strokes.splice(i, 1);
        return removed.id;
      }
    }
    return null;
  }

  /**
   * Xóa sạch toàn bộ nét vẽ trên bảng trắng của phòng
   */
  public clearWhiteboard(roomId: string): boolean {
    const room = this.getRoom(roomId);
    if (!room || !room.whiteboard.isOpen) return false;
    room.whiteboard.strokes = [];
    return true;
  }

  /**
   * Bật/Tắt nền kẻ ô ly trên bảng trắng
   */
  public setWhiteboardGrid(roomId: string, showGrid: boolean): boolean {
    const room = this.getRoom(roomId);
    if (!room) return false;
    room.whiteboard.showGrid = Boolean(showGrid);
    return true;
  }

  /**
   * Xử lý khi một người rời phòng hoặc ngắt kết nối mạng
   */
  public leaveRoom(
    rawRoomId: string,
    socketId: string
  ): { removed: boolean; remainingCount: number; peerName?: string; whiteboardClosed?: boolean } {
    const roomId = this.sanitizeRoomId(rawRoomId);
    const room = this.rooms.get(roomId);
    this.socketToRoomMap.delete(socketId);

    if (!room) return { removed: false, remainingCount: 0 };

    const participant = room.participants.get(socketId);
    const peerName = participant?.name;
    const removed = room.participants.delete(socketId);
    const remainingCount = room.participants.size;
    let whiteboardClosed = false;

    // Nếu người đang giữ quyền bật bảng trắng rời phòng -> tự đóng & giải phóng quyền cho người còn lại
    if (remainingCount > 0 && room.whiteboard.isOpen && room.whiteboard.ownerId === socketId) {
      room.whiteboard.isOpen = false;
      room.whiteboard.ownerId = null;
      room.whiteboard.ownerName = null;
      whiteboardClosed = true;
    }

    // Tự động thu hồi tài nguyên nếu phòng trống
    if (remainingCount === 0) {
      this.rooms.delete(roomId);
    }

    return { removed, remainingCount, peerName, whiteboardClosed };
  }
}
