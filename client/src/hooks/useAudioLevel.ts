/**
 * ============================================================================
 * MODULE: CLIENT HOOKS - VOICE ACTIVITY DETECTION & AUDIO LEVEL MONITOR
 * ============================================================================
 * Hook useAudioLevel sử dụng Web Audio API để phân tích phổ âm thanh thời gian thực
 * từ luồng microphone (cục bộ hoặc nhận từ remote peer) nhằm:
 *  1. Tính toán biên độ âm lượng từ 0 đến 100%.
 *  2. Phát hiện người dùng đang nói (Voice Activity Detection - VAD).
 *  3. Kích hoạt hiệu ứng phát sáng viền xanh (Speaking Indicator) quanh khung video
 *     giúp trải nghiệm tương tác trực quan giống Google Meet / Zoom.
 */

import { useEffect, useState, useRef } from 'react';
import { SPEAKING_THRESHOLD_VOLUME } from '../constants/webrtc';

export function useAudioLevel(stream: MediaStream | null, enabled: boolean = true) {
  // Biên độ âm lượng chuẩn hóa từ 0 đến 100%
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Cờ báo hiệu người này có đang nói chuyện hay không (true/false)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Các tham chiếu quản lý tài nguyên Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Nếu không có luồng âm thanh hoặc micro đang bị tắt -> Reset về 0
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      setAudioLevel(0);
      setIsSpeaking(false);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !audioTrack.enabled) {
      setAudioLevel(0);
      setIsSpeaking(false);
      return;
    }

    try {
      /**
       * BƯỚC 1: Khởi tạo Web Audio Context
       */
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      /**
       * BƯỚC 2: Tạo AnalyserNode (Bộ phân tích biến đổi Fourier nhanh FFT)
       * - fftSize = 256: Cung cấp 128 dải tần số (frequencyBinCount = 128)
       * - smoothingTimeConstant = 0.5: Làm mượt dao động giữa các khung hình liên tiếp
       */
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      /**
       * BƯỚC 3: Nối luồng microphone vào đầu vào của bộ phân tích
       */
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      // Mảng đệm chứa dữ liệu cường độ âm thanh cho từng dải tần số (0 - 255)
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      /**
       * BƯỚC 4: Vòng lặp lấy mẫu âm thanh ở tốc độ quét của màn hình (60 FPS)
       */
      const checkVolume = () => {
        if (!analyserRef.current) return;

        // Đọc dữ liệu phổ tần số âm thanh hiện tại vào buffer
        analyserRef.current.getByteFrequencyData(buffer);

        // Tính giá trị trung bình cộng của tất cả các dải tần số
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;

        // Chuẩn hóa về thang điểm 0 - 100%
        const normalized = Math.min(100, Math.round((avg / 128) * 100));

        setAudioLevel(normalized);

        // So sánh với ngưỡng để xác định xem người dùng có đang phát ra tiếng nói hay không
        setIsSpeaking(normalized > SPEAKING_THRESHOLD_VOLUME);

        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      animFrameRef.current = requestAnimationFrame(checkVolume);
    } catch (e) {
      console.warn('[useAudioLevel] Không thể khởi tạo phân tích âm thanh Web Audio:', e);
    }

    /**
     * DỌN DẸP TÀI NGUYÊN (CLEANUP):
     * Khi component unmount hoặc micro bị tắt, ngắt kết nối và đóng AudioContext
     * để tránh rò rỉ bộ nhớ (Memory Leak) hoặc chiếm dụng driver âm thanh.
     */
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch (_) {}
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { audioContextRef.current.close(); } catch (_) {}
      }
    };
  }, [stream, enabled]);

  return { audioLevel, isSpeaking };
}
