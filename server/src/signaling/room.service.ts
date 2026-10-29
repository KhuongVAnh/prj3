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
import { RoomData, RoomParticipant, CameraInfo } from '../types';
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
   * Thêm một người dùng mới vào phòng họp:
   */
  public joinRoom(
    rawRoomId: string,
    socketId: string,
    userName: string
  ): { success: boolean; isFull?: boolean; participant?: RoomParticipant; room?: RoomData } {
    const roomId = this.sanitizeRoomId(rawRoomId);
    let room = this.rooms.get(roomId);

    if (!room) {
      room = {
        id: roomId,
        participants: new Map(),
        createdAt: Date.now()
      };
      this.rooms.set(roomId, room);
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
     * - Người tạo phòng (vào đầu tiên): isPolite = false (Impolite initiator)
     * - Người vào thứ hai: isPolite = true (Polite callee)
     */
    const isFirstParticipant = room.participants.size === 0;
    const isPolite = !isFirstParticipant;

    const participant: RoomParticipant = {
      id: socketId,
      name: (userName || 'Khách').trim(),
      joinedAt: Date.now(),
      isPolite,
      cameras: [],
      isMuted: false
    };

    room.participants.set(socketId, participant);
    this.socketToRoomMap.set(socketId, roomId);

    return { success: true, participant, room };
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
   * Xử lý khi một người rời phòng hoặc ngắt kết nối mạng
   */
  public leaveRoom(
    rawRoomId: string,
    socketId: string
  ): { removed: boolean; remainingCount: number; peerName?: string } {
    const roomId = this.sanitizeRoomId(rawRoomId);
    const room = this.rooms.get(roomId);
    this.socketToRoomMap.delete(socketId);

    if (!room) return { removed: false, remainingCount: 0 };

    const participant = room.participants.get(socketId);
    const peerName = participant?.name;
    const removed = room.participants.delete(socketId);
    const remainingCount = room.participants.size;

    // Tự động thu hồi tài nguyên nếu phòng trống
    if (remainingCount === 0) {
      this.rooms.delete(roomId);
    }

    return { removed, remainingCount, peerName };
  }
}
