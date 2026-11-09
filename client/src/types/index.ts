/**
 * ============================================================================
 * MODULE: CLIENT TYPES - DATA TYPES & INTERFACES DEFINITION
 * ============================================================================
 */

/**
 * Phân loại nguồn cấp video:
 * - 'physical': Camera vật lý phần cứng gắn qua USB hoặc webcam tích hợp laptop
 * - 'screen': Luồng chia sẻ màn hình máy tính (getDisplayMedia)
 */
export type CameraType = 'physical' | 'screen';

/**
 * Nguồn camera cục bộ (Local Camera):
 * Đại diện cho một luồng video đang được phát từ phía máy của người dùng.
 */
export interface CameraSource {
  id: string;                                          // Định danh duy nhất (vd: 'physical-devId123')
  deviceId?: string;                                   // Hardware deviceId từ navigator.mediaDevices.enumerateDevices()
  label: string;                                       // Tên hiển thị (vd: 'Arducam 12MP', 'Integrated Webcam')
  type: CameraType;                                    // Loại camera
  stream: MediaStream;                                 // Luồng MediaStream chứa VideoTrack thực tế
  active: boolean;                                     // Trạng thái đang phát (ON AIR)
}

/**
 * Luồng camera nhận từ đối phương (Remote Camera):
 * Đại diện cho một luồng video nhận về qua kết nối WebRTC RTCPeerConnection.
 */
export interface RemoteCameraStream {
  id: string;                      // Định danh track ID hoặc stream ID
  cameraId: string;                // Camera ID của đối phương tương ứng
  peerId: string;                  // Socket ID của người gửi
  peerName: string;                // Tên của người gửi
  label: string;                   // Nhãn tên camera (vd: 'Bob: Camera')
  type: CameraType;                // Loại camera ('physical' | 'screen')
  stream: MediaStream;             // Luồng video nhận về để gán vào thẻ <video>
  isMuted?: boolean;               // Trạng thái mic của đối phương
}

/**
 * Metadata thông tin camera đi kèm trong SDP Offer/Answer:
 * Do WebRTC chuẩn chỉ truyền các Track ID thô (vd: "4a7b8c..."), metadata này
 * giúp liên kết Track ID đó với nhãn tên có nghĩa ("Webcam chính", "Camera phụ").
 */
export interface CameraMeta {
  cameraId: string;
  trackId: string;
  streamId: string;
  label: string;
  type: CameraType;
}

/**
 * Thông tin của người đối diện trong phòng họp (Remote Peer):
 */
export interface PeerInfo {
  peerId: string;                  // Socket ID của đối phương
  peerName: string;                // Tên hiển thị của đối phương
  isPolite: boolean;               // Vai trò đàm phán trong Perfect Negotiation
  isMuted: boolean;                // Đối phương có đang tắt mic hay không
  cameras: CameraMeta[];           // Danh sách camera đối phương đang bật
}

/**
 * Tin nhắn trong cuộc gọi (In-Call Text Chat):
 */
export interface ChatMessage {
  id: string;                      // Mã tin nhắn duy nhất
  senderId: string;                // Socket ID người gửi
  senderName: string;              // Tên người gửi
  text: string;                    // Nội dung tin nhắn
  timestamp: number;               // Thời gian gửi (Unix timestamp)
}

/**
 * Thống kê đo kiểm thông số mạng WebRTC (Real-time Diagnostic Metrics):
 * Được trích xuất định kỳ từ phương thức pc.getStats().
 */
export interface WebRTCStats {
  rtt: number;                     // Độ trễ khứ hồi Round-Trip Time (mili-giây ms)
  packetsLost: number;             // Số gói tin UDP bị mất
  fps?: number;                    // Số khung hình trên giây (Frames Per Second)
  resolution?: string;             // Độ phân giải video thực tế (vd: 1280x720)
  bitrateKbps?: number;            // Tốc độ truyền tải dữ liệu (Kbps)
  videoBitrate?: number;           // Bitrate video
  audioBitrate?: number;           // Bitrate âm thanh
  candidateType?: string;          // Loại kết nối ICE: 'host' (LAN), 'srflx' (STUN WAN), 'relay' (TURN)
}
