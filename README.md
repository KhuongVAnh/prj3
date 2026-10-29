# OmniCam — Multi-Camera 1-on-1 WebRTC Video Call Platform

> **Nền tảng gọi video 1-1 hỗ trợ bật nhiều camera cùng lúc trong thời gian thực qua WebRTC.**
> **Kiến trúc Backend: NestJS WebSocket Gateway kết hợp kỹ thuật phục vụ Single Artifact.**

OmniCam cho phép 2 người kết nối video call trực tiếp (P2P), đồng thời mỗi người có thể bật cùng lúc nhiều góc camera (Facecam, Desk/Overhead Cam, Screen Share, hoặc Virtual Simulated Feeds) mà không làm gián đoạn cuộc gọi.

---

## 🚀 Tính năng nổi bật

1. **Gọi Video 1-on-1 Trực tiếp (P2P WebRTC):**
   - Kết nối trực tiếp giữa 2 người qua Google STUN & NestJS Signaling Server (Socket.io Gateway).
   - Tự động giới hạn phòng 1-1 (tối đa 2 người tham gia), bảo mật riêng tư.
   - Chia sẻ phòng dễ dàng bằng mã phòng hoặc đường link mời (`/?room=meet-xxx-xxx`).

2. **Đa Camera Đồng thời (Simultaneous Multi-Camera):**
   - Tự động quét và liệt kê tất cả camera vật lý gắn vào máy tính (`navigator.mediaDevices.enumerateDevices()`).
   - Bật/tắt thêm camera bất kỳ lúc nào trong cuộc gọi qua **Dynamic WebRTC Renegotiation** (Unified Plan) mà không bị rớt mạng hay load lại trang.
   - Cơ chế **Fallback Đa Tầng** (720p $\rightarrow$ 480p $\rightarrow$ 360p $\rightarrow$ Native) chống nghẽn băng thông bus USB 2.0 khi chạy 2 webcam cùng lúc.
   - Hub quản lý đa camera (`Multi-Camera Hub`) trực quan, hiển thị trạng thái ON AIR của từng góc quay.

3. **Virtual Simulated Camera Studio (Thử nghiệm đa camera ngay lập tức):**
   - Không cần mua nhiều webcam vật lý để test! OmniCam tích hợp sẵn 3 luồng camera ảo chuẩn studio thời gian thực:
     - 🕒 **Studio SMPTE Pattern:** Đồng hồ kỹ thuật số mili-giây, dải màu SMPTE chuẩn truyền hình và sóng âm thanh dao động.
     - 📐 **Desk / Blueprint Simulator:** Mô phỏng camera tài liệu bàn làm việc với lưới CAD, la bàn đo góc quay và tọa độ HUD.
     - 📡 **Radar Scanner Cam:** Quét radar 360° với tọa độ mục tiêu chuyển động.
   - Chia sẻ màn hình (Screen Share) hoạt động như một góc camera riêng biệt.

4. **Đóng gói Độc lập Single Artifact (Monolith Deployment):**
   - Khi chạy `npm run build`, client Vite xuất trực tiếp gói bundle vào `server/frontend`.
   - Máy chủ NestJS sử dụng `@nestjs/serve-static` phục vụ toàn bộ Web Application tĩnh lẫn WebSocket Signaling Gateway trên **duy nhất 1 cổng (Port 3001)**.
   - Khi deploy lên Server/VPS/Docker: **Chỉ cần copy duy nhất thư mục `server/`** và chạy 1 tiến trình duy nhất.

5. **Giao diện Tinh tế (Dark Obsidian Glass & Adaptive Layout):**
   - **Chế độ Lưới Tự Thích Ứng (Adaptive Grid):** Tự động chia 1, 2, 4, 6 ô video cân đối hoàn hảo.
   - **Chế độ Tiêu Điểm (Spotlight / Pin Mode):** Bấm ghim (Pin) bất kỳ camera nào để phóng to trung tâm.
   - **Chỉ Báo Giọng Nói (Speaking Indicator):** Tự động phát hiện âm lượng micro (Web Audio API) và phát sáng viền xanh lục quanh người đang nói.
   - **Bảng đo kiểm thông số mạng WebRTC:** RTT latency, FPS, phân giải, packet loss.

---

## 🛠️ Cài đặt & Hướng dẫn Chạy

### 1. Cài đặt các gói phụ thuộc
Ở thư mục gốc dự án:
```bash
npm run install:all
```

### 2. Khởi chạy môi trường phát triển (Dev)
Chạy đồng thời cả NestJS Server (cổng `3001`) và Frontend Vite HMR (cổng `5173`):
```bash
npm run dev
```

Sau khi chạy lệnh:
- **Web App (Vite Dev HMR):** [http://localhost:5173](http://localhost:5173)
- **NestJS Server & Gateway:** Đang lắng nghe tại [http://localhost:3001](http://localhost:3001)

### 3. Đóng gói & Triển khai Sản phẩm (Production Single Artifact)
Chỉ cần 1 lệnh build toàn bộ:
```bash
npm run build
```
Lệnh này sẽ:
1. Build frontend React bằng Vite $\rightarrow$ xuất trực tiếp vào `server/frontend/`.
2. Biên dịch NestJS TypeScript $\rightarrow$ xuất vào `server/dist/`.

Để chạy ứng dụng ở chế độ Single Artifact (chỉ 1 cổng duy nhất):
```bash
npm run start:prod
```
Truy cập: **[http://localhost:3001](http://localhost:3001)** — Cả giao diện Web và kết nối WebRTC Signaling đều chạy mượt mà trên cổng `3001`!

### 4. Chạy kiểm thử tự động (Automated Tests)
Hệ thống đã tích hợp bộ test kiểm thử tự động trên nền tảng NestJS Gateway:
```bash
npm test
```
Toàn bộ 8 kịch bản (kết nối, phân quyền polite/impolite, giới hạn phòng 1-1, đa camera metadata, offer/answer, ICE candidates, chat, ngắt kết nối) đều được kiểm chứng tự động.

---

## 📂 Cấu trúc thư mục

```
project 3/
├── package.json              # Điều phối build client -> server, chạy dev & test
├── server/                   # NestJS Backend & Host phục vụ Frontend
│   ├── frontend/             # Nơi chứa sản phẩm build của client (Single Artifact)
│   ├── dist/                 # Mã nguồn NestJS đã biên dịch
│   ├── src/
│   │   ├── main.ts           # Khởi động ứng dụng NestJS (Port, CORS, Static)
│   │   ├── app.module.ts     # Root Module tích hợp ServeStaticModule
│   │   ├── config/           # Cấu hình PORT, CORS, Heartbeat
│   │   ├── health/           # REST API GET /health
│   │   ├── signaling/
│   │   │   ├── signaling.gateway.ts # @WebSocketGateway() xử lý đàm phán WebRTC
│   │   │   ├── room.service.ts     # Quản lý trạng thái phòng 1-1, W3C Perfect Negotiation
│   │   │   └── signaling.module.ts
│   │   ├── types/            # Định nghĩa kiểu dữ liệu WebRTC Signaling
│   │   └── test-signaling.ts # Test suite kiểm thử tự động NestJS Gateway
│   ├── tsconfig.json
│   └── package.json
└── client/                   # React + TypeScript + Vite + Tailwind CSS
    ├── src/
    │   ├── components/       # Lobby, Room, VideoGrid, VideoTile, ControlBar, CameraManagerModal
    │   ├── hooks/            # useWebRTC, useAudioLevel
    │   ├── utils/            # virtualCamera (Canvas 30 FPS stream generator)
    │   └── constants/        # STUN/TURN, Video Constraint Tiers
    ├── vite.config.ts        # Cấu hình outDir sang ../server/frontend
    └── package.json
```
