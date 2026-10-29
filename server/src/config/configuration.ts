/**
 * ============================================================================
 * MODULE: NESTJS CONFIGURATION - SERVER CONSTANTS
 * ============================================================================
 * Cấu hình tập trung các thông số runtime của NestJS server:
 *  - Cổng lắng nghe (PORT)
 *  - Giới hạn người tham gia cuộc gọi 1-1 (MAX_PARTICIPANTS_PER_ROOM)
 *  - Thông số WebSocket Heartbeat (pingInterval / pingTimeout)
 *  - Cấu hình CORS
 */

export const SERVER_CONFIG = {
  // Cổng HTTP / WebSocket của máy chủ (mặc định 3001)
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,

  // Số lượng người tham gia tối đa trong 1 phòng gọi 1-1
  MAX_PARTICIPANTS_PER_ROOM: 2,

  // WebSocket Heartbeat keep-alive
  SOCKET_PING_INTERVAL: 10000,
  SOCKET_PING_TIMEOUT: 5000,

  // CORS Origin
  CORS_ORIGIN: '*'
};
