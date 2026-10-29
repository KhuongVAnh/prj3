/**
 * ============================================================================
 * MODULE: CLIENT UTILS - VIRTUAL SIMULATED CAMERA STUDIO
 * ============================================================================
 * Sử dụng công nghệ HTML5 Canvas kết hợp phương thức chuẩn W3C:
 *   const mediaStream = canvas.captureStream(30); // 30 FPS
 * để biến các hoạt ảnh đồ họa toán học thời gian thực thành một luồng MediaStream
 * chuẩn. Trình duyệt coi luồng này tương đương với một webcam phần cứng thật.
 *
 * CÁC MẪU CAMERA MÔ PHỎNG TÍCH HỢP:
 *  1. 'clock': Đồng hồ kỹ thuật số chuẩn phòng thu SMPTE (mili-giây, dải màu TV, sóng âm dao động).
 *  2. 'blueprint': Mô phỏng camera tài liệu bàn làm việc (lưới CAD, la bàn đo góc, thước đo HUD).
 *  3. 'radar': Mô phỏng radar chiến thuật quân sự (quét xoay 360 độ, mục tiêu nhấp nháy).
 */

export interface VirtualCamInstance {
  stream: MediaStream;             // Luồng video chuẩn sinh ra từ Canvas
  stop: () => void;                // Hàm dừng vòng lặp requestAnimationFrame và dọn dẹp bộ nhớ
  type: 'clock' | 'blueprint' | 'radar'; // Loại mẫu hiển thị
}

/**
 * Khởi tạo một luồng Camera Ảo chạy ở độ phân giải 1280x720 (720p) @ 30 FPS
 */
export function createVirtualCameraStream(pattern: 'clock' | 'blueprint' | 'radar'): VirtualCamInstance {
  // Tạo canvas ảo nằm trong bộ nhớ (không cần gắn vào DOM)
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  let animationFrameId: number;
  let isRunning = true;
  let frameCount = 0;
  const startTime = Date.now();

  /**
   * Vòng lặp vẽ liên tục 30-60 lần mỗi giây (Game Loop)
   */
  const draw = () => {
    if (!isRunning || !ctx) return;
    frameCount++;
    const now = Date.now();
    const elapsed = (now - startTime) / 1000;

    const w = canvas.width;
    const h = canvas.height;

    // =========================================================================
    // MẪU 1: STUDIO SMPTE CLOCK & SIGNAL GENERATOR
    // =========================================================================
    if (pattern === 'clock') {
      // 1. Vẽ nền đen sâu chuyển màu
      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      bgGrad.addColorStop(0, '#0a0d14');
      bgGrad.addColorStop(1, '#05070a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. Lưới tọa độ studio mờ
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 3. Dải màu SMPTE Color Bars tiêu chuẩn truyền hình ở mép trên
      const colors = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff'];
      const barW = w / colors.length;
      for (let i = 0; i < colors.length; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillRect(i * barW, 0, barW, 24);
      }

      // 4. Đồng hồ số thời gian thực hiển thị Giờ:Phút:Giây.Mili-giây
      const date = new Date();
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      const ss = String(date.getSeconds()).padStart(2, '0');
      const ms = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0');
      const timeStr = `${hh}:${mm}:${ss}.${ms}`;

      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 84px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#10b981'; // Hiệu ứng ánh sáng neon xanh lục
      ctx.shadowBlur = 25;
      ctx.fillText(timeStr, w / 2, h / 2 - 40);
      ctx.restore();

      // 5. Nhãn thông tin Camera và Uptime
      ctx.fillStyle = '#10b981';
      ctx.font = '600 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('● VIRTUAL CAMERA 1 — STUDIO SMPTE CLOCK & SIGNAL GENERATOR', w / 2, h / 2 + 50);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 18px monospace';
      ctx.fillText(`1280x720 @ 30 FPS  |  FRAME: ${frameCount}  |  UPTIME: ${elapsed.toFixed(1)}s`, w / 2, h / 2 + 90);

      // 6. Sóng âm thanh dao động (Oscilloscope sine wave) ở đáy
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x < w; x += 4) {
        const angle = (x * 0.02) + (elapsed * 5);
        const y = h - 100 + Math.sin(angle) * 35 * Math.sin(x * 0.005);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

    // =========================================================================
    // MẪU 2: DESK BLUEPRINT & DOCUMENT CAMERA SIMULATOR
    // =========================================================================
    } else if (pattern === 'blueprint') {
      // 1. Nền xanh bản vẽ kỹ thuật (Blueprint Blue)
      ctx.fillStyle = '#081c30';
      ctx.fillRect(0, 0, w, h);

      // 2. Lưới CAD tỷ lệ
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 25) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 3. Đường viền góc khung ngắm máy quay tài liệu (Document Camera Frame)
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      const margin = 50;
      const cornerLen = 40;

      // Góc trên-trái
      ctx.beginPath();
      ctx.moveTo(margin, margin + cornerLen);
      ctx.lineTo(margin, margin);
      ctx.lineTo(margin + cornerLen, margin);
      ctx.stroke();

      // Góc trên-phải
      ctx.beginPath();
      ctx.moveTo(w - margin - cornerLen, margin);
      ctx.lineTo(w - margin, margin);
      ctx.lineTo(w - margin, margin + cornerLen);
      ctx.stroke();

      // Góc dưới-trái
      ctx.beginPath();
      ctx.moveTo(margin, h - margin - cornerLen);
      ctx.lineTo(margin, h - margin);
      ctx.lineTo(margin + cornerLen, h - margin);
      ctx.stroke();

      // Góc dưới-phải
      ctx.beginPath();
      ctx.moveTo(w - margin - cornerLen, h - margin);
      ctx.lineTo(w - margin, h - margin);
      ctx.lineTo(w - margin, h - margin - cornerLen);
      ctx.stroke();

      // 4. La bàn kỹ thuật xoay liên tục ở giữa
      ctx.save();
      ctx.translate(w / 2, h / 2 - 20);
      ctx.rotate(elapsed * 0.5);

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 110, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, 70, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-130, 0);
      ctx.lineTo(130, 0);
      ctx.moveTo(0, -130);
      ctx.lineTo(0, 130);
      ctx.stroke();
      ctx.restore();

      // 5. Tiêu đề và HUD đo đạc
      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('📐 VIRTUAL CAMERA 2 — DESK / BLUEPRINT CAD VIEW', w / 2, h - 110);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 16px monospace';
      ctx.fillText(
        `TARGET POS: [${(Math.sin(elapsed) * 100).toFixed(2)}, ${(Math.cos(elapsed) * 100).toFixed(2)}]  |  ROTATION: ${((elapsed * 30) % 360).toFixed(1)}°`,
        w / 2,
        h - 75
      );

    // =========================================================================
    // MẪU 3: TACTICAL RADAR SCANNER
    // =========================================================================
    } else if (pattern === 'radar') {
      // 1. Nền đen radar quân sự
      ctx.fillStyle = '#020d08';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const maxRadius = 260;

      // 2. Các vòng tròn cự ly radar
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)';
      ctx.lineWidth = 1.5;
      for (let r = 60; r <= maxRadius; r += 60) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Trục chữ thập
      ctx.beginPath();
      ctx.moveTo(cx - maxRadius, cy);
      ctx.lineTo(cx + maxRadius, cy);
      ctx.moveTo(cx, cy - maxRadius);
      ctx.lineTo(cx, cy + maxRadius);
      ctx.stroke();

      // 3. Tia quét Radar hình rẻ quạt xoay 360 độ
      const scanAngle = (elapsed * 1.8) % (Math.PI * 2);
      const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
      sweepGrad.addColorStop(0, 'rgba(34, 197, 94, 0.6)');
      sweepGrad.addColorStop(1, 'rgba(34, 197, 94, 0.0)');

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxRadius, scanAngle - 0.5, scanAngle);
      ctx.closePath();
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      // Kim quét sáng
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(scanAngle) * maxRadius, cy + Math.sin(scanAngle) * maxRadius);
      ctx.stroke();
      ctx.restore();

      // 4. Các chấm mục tiêu di chuyển nhấp nháy
      const blips = [
        { angle: 0.8, dist: 140, label: 'TGT-ALPHA' },
        { angle: 2.4, dist: 210, label: 'TGT-BRAVO' },
        { angle: 4.1, dist: 95, label: 'TGT-SIERRA' }
      ];

      for (const b of blips) {
        const bx = cx + Math.cos(b.angle + elapsed * 0.05) * b.dist;
        const by = cy + Math.sin(b.angle + elapsed * 0.05) * b.dist;

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#22c55e';
        ctx.font = '600 12px monospace';
        ctx.fillText(b.label, bx + 10, by + 4);
      }

      // 5. Tiêu đề
      ctx.fillStyle = '#22c55e';
      ctx.font = '700 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('📡 VIRTUAL CAMERA 3 — TACTICAL RADAR SCANNER', w / 2, 45);
    }

    animationFrameId = requestAnimationFrame(draw);
  };

  // Khởi động vòng lặp vẽ
  draw();

  /**
   * BƯỚC ĐỘT PHÁ CỦA WEBRTC:
   * Chuyển đổi toàn bộ nội dung động vẽ trên Canvas thành MediaStream chuẩn W3C ở 30 khung hình/giây.
   */
  const stream = canvas.captureStream(30);

  return {
    stream,
    stop: () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      // Dừng toàn bộ các track để giải phóng GPU và CPU
      stream.getTracks().forEach((track) => track.stop());
    },
    type: pattern
  };
}
