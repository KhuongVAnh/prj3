/**
 * ============================================================================
 * MODULE: SIGNALING SERVER - TYPES & INTERFACES DEFINITION
 * ============================================================================
 * Định nghĩa toàn bộ cấu trúc dữ liệu và các kiểu đối tượng dùng cho
 * hệ thống WebRTC Signaling Server:
 *  - Thông tin người tham gia (Participant)
 *  - Dữ liệu phòng họp 1-1 (Room)
 *  - Metadata camera đa luồng (Multi-Camera Meta)
 *  - Các gói tin trao đổi tín hiệu (SDP Offer, Answer, ICE Candidates, Chat)
 */

/**
 * Phân loại nguồn camera:
 * - 'physical': Camera vật lý phần cứng (Webcam laptop, camera USB ngoài, DroidCam/Iriun)
 * - 'virtual': Camera mô phỏng bằng HTML5 Canvas phục vụ test và demo
 * - 'screen': Luồng chia sẻ màn hình máy tính (Screen Share)
 */
export type CameraType = 'physical' | 'virtual' | 'screen';

/**
 * Thông tin chi tiết của một luồng camera được phát từ phía client:
 */
export interface CameraInfo {
  id: string;                      // Định danh duy nhất của camera trên client (vd: physical-xxx, virtual-clock)
  label: string;                   // Tên hiển thị của camera (vd: "Integrated Webcam", "Studio Clock")
  type: CameraType;                // Loại camera ('physical' | 'virtual' | 'screen')
  trackId?: string;                // ID của MediaStreamTrack truyền qua WebRTC
  streamId?: string;               // ID của MediaStream truyền qua WebRTC
}

/**
 * Thông tin của một người tham gia (Peer) trong phòng họp:
 */
export interface RoomParticipant {
  id: string;                      // Socket ID duy nhất của kết nối
  name: string;                    // Tên hiển thị người dùng (nhập từ Lobby)
  joinedAt: number;                // Thời điểm tham gia phòng (Unix timestamp)
  isPolite: boolean;               // Vai trò trong Perfect Negotiation (true: nhường, false: khởi tạo)
  cameras: CameraInfo[];           // Danh sách tất cả các camera mà người này đang bật đồng thời
  isMuted: boolean;                // Trạng thái micro (true: tắt tiếng, false: bật tiếng)
}

/**
 * Cấu trúc dữ liệu của một phòng họp (Room):
 */
export interface RoomData {
  id: string;                                   // Mã phòng (vd: "meet-123-456")
  participants: Map<string, RoomParticipant>;   // Danh sách thành viên (lưu dưới dạng Map socketId -> Participant)
  createdAt: number;                            // Thời điểm tạo phòng (Unix timestamp)
}

/**
 * Metadata camera gửi kèm theo SDP Offer / Answer:
 * Giúp bên nhận (Remote Peer) gắn đúng nhãn tên ("Webcam chính", "Camera góc 2")
 * vào từng track video nhận được từ WebRTC RTCPeerConnection.
 */
export interface CameraMetaPayload {
  cameraId: string;
  trackId: string;
  streamId: string;
  label: string;
  type: CameraType;
}

/**
 * Cấu trúc gói tin tin nhắn Chat trong phòng gọi:
 */
export interface ChatMessagePayload {
  id: string;                      // ID tin nhắn
  senderId: string;                // Socket ID người gửi
  senderName: string;              // Tên người gửi
  text: string;                    // Nội dung tin nhắn
  timestamp: number;               // Thời gian gửi
}
