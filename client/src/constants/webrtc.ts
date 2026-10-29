/**
 * ============================================================================
 * MODULE: CLIENT CONSTANTS - WEBRTC & MEDIA CONFIGURATION
 * ============================================================================
 * Cấu hình tập trung các tham số mạng và hạ tầng WebRTC:
 *  1. Danh sách máy chủ STUN/TURN (Interactive Connectivity Establishment - ICE)
 *  2. Các mức phân giải video (1080p, 720p, 480p, 360p) phục vụ đa camera
 *  3. Ngưỡng âm lượng phát hiện giọng nói (Voice Activity Detection - VAD)
 */

/**
 * Cấu hình máy chủ STUN (Session Traversal Utilities for NAT):
 * STUN server giúp 2 máy tính nằm sau các Router NAT (mạng gia đình, 4G, Wifi trường)
 * tìm ra địa chỉ IP công cộng (Public IP) và Port của nhau để thiết lập kênh P2P trực tiếp.
 */
export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

/**
 * Các bậc cấu hình Video Constraints khi kích hoạt camera vật lý:
 * Khi bật 2 camera cùng lúc trên 1 máy tính (đặc biệt là camera USB qua cổng USB 2.0),
 * băng thông của bus USB có thể bị nghẽn nếu cả 2 đều đòi phân giải cao.
 * Hệ thống sẽ thử lần lượt từ Tier 1 (720p) xuống Tier 2 (480p), Tier 3 (360p) để đảm bảo luôn bật được.
 */
export const VIDEO_CONSTRAINT_TIERS = {
  HIGH_RES: { width: { ideal: 1280 }, height: { ideal: 720 } },
  MEDIUM_RES: { width: { ideal: 640 }, height: { ideal: 480 } },
  LOW_RES: { width: { ideal: 480 }, height: { ideal: 360 } }
};

/**
 * Ngưỡng phát hiện người dùng đang nói (Voice Activity Detection):
 * Giá trị từ 0 đến 100 tính theo biên độ tần số âm thanh từ Web Audio API AnalyserNode.
 */
export const SPEAKING_THRESHOLD_VOLUME = 14; // Âm lượng > 14% được tính là đang nói
