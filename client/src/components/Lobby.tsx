/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - LOBBY VIEW (PHÒNG CHỜ TIỀN CUỘC GỌI)
 * ============================================================================
 * Màn hình chờ kiểm tra thiết bị trước khi bước vào phòng gọi:
 *  - Nhập tên hiển thị và mã phòng họp (hoặc tạo mã phòng ngẫu nhiên tự động).
 *  - Xem trước hình ảnh camera (Local Video Preview) và kiểm tra tín hiệu micro.
 *  - Bật/Tắt camera, micro trước khi tham gia.
 *  - Dọn dẹp toàn bộ luồng preview khi chuyển sang màn hình Room để giải phóng phần cứng.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface LobbyProps {
  initialRoomId: string;
  onJoinRoom: (roomId: string, userName: string, initialAudio: boolean, initialVideo: boolean) => void;
}

const generateRandomRoomCode = () =>
  `meet-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;

export const Lobby: React.FC<LobbyProps> = ({ initialRoomId, onJoinRoom }) => {
  const [roomId, setRoomId] = useState(() => initialRoomId || generateRandomRoomCode());
  const [userName, setUserName] = useState('');
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const savedName = localStorage.getItem('omnicam_user_name');
    if (savedName) {
      setUserName(savedName);
    } else {
      const defaultName = `Khách_${Math.floor(1000 + Math.random() * 9000)}`;
      setUserName(defaultName);
    }
  }, []);

  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
  }, [initialRoomId]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    if (!isAudioEnabled) {
      setAudioLevel(0);
    }

    const setupPreview = async () => {
      if (previewStream) {
        previewStream.getTracks().forEach(t => t.stop());
      }
      setDeviceError(null);

      if (isVideoEnabled || isAudioEnabled) {
        try {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: isVideoEnabled ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : false,
              audio: isAudioEnabled
            });
          } catch (_) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: isVideoEnabled ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
              audio: isAudioEnabled
            });
          }

          if (cancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          setPreviewStream(stream);

          if (isAudioEnabled && stream.getAudioTracks().length > 0) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            audioCtx = new AudioCtx();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 128;
            source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateMeter = () => {
              if (!analyser || cancelled) return;
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
              const avg = sum / dataArray.length;
              setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
              animFrameRef.current = requestAnimationFrame(updateMeter);
            };
            animFrameRef.current = requestAnimationFrame(updateMeter);
          }
        } catch (e: any) {
          console.warn('[Lobby] Camera/mic access error:', e);
          if (!cancelled) {
            if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
              setDeviceError('Trình duyệt chưa được cấp quyền sử dụng camera hoặc micro.');
            } else if (e?.name === 'NotReadableError') {
              setDeviceError('Camera đang được ứng dụng khác sử dụng.');
            } else {
              setDeviceError('Không thể truy cập thiết bị ghi hình hoặc âm thanh.');
            }
          }
        }
      } else {
        setPreviewStream(null);
      }
    };

    setupPreview();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (source) {
        try { source.disconnect(); } catch (_) {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try { audioCtx.close(); } catch (_) {}
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isVideoEnabled, isAudioEnabled]);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const finalRoom = roomId.trim().toLowerCase() || generateRandomRoomCode();
    const finalName = userName.trim() || 'Khách';
    localStorage.setItem('omnicam_user_name', finalName);

    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
    }

    onJoinRoom(finalRoom, finalName, isAudioEnabled, isVideoEnabled);
  };

  const handleCreateNewRoom = () => {
    setRoomId(generateRandomRoomCode());
  };

  return (
    <div className="min-h-[100dvh] bg-canvas flex flex-col">
      {/* Top Bar */}
      <header className="h-16 px-4 sm:px-8 border-b border-line-subtle bg-surface shrink-0">
        <div className="max-w-6xl w-full h-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white">
              <Video className="w-4 h-4" strokeWidth={2} />
            </div>
            <span className="text-base font-semibold tracking-tight text-ink-primary">
              OmniCam
            </span>
          </div>
          <span className="text-xs font-medium text-ink-secondary">
            Gọi video 1-1 đa góc quay
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left: Framed Preview Monitor */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="rounded-2xl bg-surface p-2 border border-line-subtle shadow-card">
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-surface-subtle">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-contain bg-surface-video -scale-x-100 ${
                  !isVideoEnabled ? 'hidden' : 'block'
                }`}
              />

              {!isVideoEnabled && (
                <div className="w-full h-full flex flex-col items-center justify-center px-6 text-center bg-surface-subtle">
                  <div className="w-12 h-12 rounded-xl bg-surface border border-line-subtle flex items-center justify-center mb-3 text-ink-secondary">
                    <VideoOff className="w-5 h-5" strokeWidth={1.75} />
                  </div>
                  <p className="text-sm font-medium text-ink-primary">Camera đang tắt</p>
                  <p className="text-xs text-ink-secondary mt-1 max-w-xs">
                    Bạn có thể bật lại bên dưới hoặc vào phòng chỉ với âm thanh.
                  </p>
                </div>
              )}

              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/90 border border-line-subtle text-xs font-medium text-ink-primary shadow-sm">
                Xem trước camera
              </div>
            </div>
          </div>

          {deviceError && (
            <div className="mt-3 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{deviceError}</span>
            </div>
          )}

          {/* Device Control Strip */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsAudioEnabled(!isAudioEnabled)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors active:translate-y-[1px] ${
                  isAudioEnabled
                    ? 'bg-surface border-line-subtle text-ink-primary hover:bg-surface-muted shadow-sm'
                    : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                }`}
              >
                {isAudioEnabled ? (
                  <Mic className="w-4 h-4 text-ink-secondary" strokeWidth={1.75} />
                ) : (
                  <MicOff className="w-4 h-4 text-red-600" strokeWidth={1.75} />
                )}
                <span>{isAudioEnabled ? 'Micro đang bật' : 'Micro đang tắt'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsVideoEnabled(!isVideoEnabled)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors active:translate-y-[1px] ${
                  isVideoEnabled
                    ? 'bg-surface border-line-subtle text-ink-primary hover:bg-surface-muted shadow-sm'
                    : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                }`}
              >
                {isVideoEnabled ? (
                  <Video className="w-4 h-4 text-ink-secondary" strokeWidth={1.75} />
                ) : (
                  <VideoOff className="w-4 h-4 text-red-600" strokeWidth={1.75} />
                )}
                <span>{isVideoEnabled ? 'Camera đang bật' : 'Camera đang tắt'}</span>
              </button>
            </div>

            {isAudioEnabled && (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface border border-line-subtle text-xs text-ink-secondary shadow-sm">
                <span>Tín hiệu mic</span>
                <div className="w-24 h-1.5 rounded-full bg-surface-muted overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-75 rounded-full"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] tabular-nums text-ink-muted w-8 text-right">
                  {audioLevel}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Clean White Join Card */}
        <div className="lg:col-span-5">
          <div className="p-7 sm:p-8 rounded-2xl bg-surface border border-line-subtle shadow-card">
            <h1 className="text-xl font-semibold tracking-tight text-ink-primary">
              Tham gia phòng họp
            </h1>
            <p className="text-sm text-ink-secondary mt-1.5 mb-6 leading-relaxed">
              Phát đồng thời nhiều webcam, chia sẻ màn hình và bảng trắng trong cùng cuộc gọi 1-1.
            </p>

            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label
                  htmlFor="lobby-user-name"
                  className="block text-xs font-medium text-ink-primary mb-1.5"
                >
                  Tên hiển thị
                </label>
                <input
                  id="lobby-user-name"
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Ví dụ: Minh Anh"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-subtle border border-line-subtle text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="lobby-room-id"
                    className="block text-xs font-medium text-ink-primary"
                  >
                    Mã phòng
                  </label>
                  <button
                    type="button"
                    onClick={handleCreateNewRoom}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" strokeWidth={1.75} />
                    <span>Tạo mã mới</span>
                  </button>
                </div>
                <input
                  id="lobby-room-id"
                  type="text"
                  required
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="meet-123-456"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-subtle border border-line-subtle text-sm font-mono text-ink-primary placeholder:text-ink-muted focus:outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 px-4 rounded-xl bg-accent hover:bg-accent-hover active:translate-y-[1px] text-white font-medium text-sm transition-colors mt-2 shadow-sm"
              >
                Vào phòng
              </button>
            </form>

            <p className="mt-5 pt-4 border-t border-line-subtle text-xs text-ink-muted leading-relaxed">
              Bạn có thể bật thêm webcam phụ hoặc chia sẻ màn hình ngay sau khi vào phòng.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};
