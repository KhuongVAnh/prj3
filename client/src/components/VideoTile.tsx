/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - VIDEO TILE (KHUNG HIỂN THỊ LUỒNG VIDEO)
 * ============================================================================
 * Component hiển thị một luồng video đơn lẻ (cục bộ hoặc từ đối phương):
 *  1. Gắn MediaStream vào thẻ HTML5 <video> với chế độ autoplay và muted.
 *  2. Bảo toàn tuyệt đối tỉ lệ khung hình thực tế (True Aspect Ratio) của luồng video
 *     sử dụng object-contain kèm nền tối sang trọng (clean letterboxing/pillarboxing).
 *  3. Báo cáo tỉ lệ khung hình thực tế (aspectRatio) lên VideoGrid để đồng bộ khung chứa.
 *  4. Hỗ trợ chuyển đổi nhanh chế độ Fit (chuẩn tỉ lệ, không mất chi tiết) và Fill (tràn viền).
 *  5. Lật gương hình ảnh (Mirror effect -scale-x-100) đối với webcam vật lý cục bộ.
 *  6. Hiệu ứng viền phát sáng xanh lục (Speaking Indicator ring) khi người này đang nói.
 *  7. Các huy hiệu overlay: Nhãn tên, loại camera, huy hiệu ON AIR phát sáng, trạng thái mic,
 *     nút ghim tiêu điểm (Pin), nút toàn màn hình (Fullscreen), nút đóng camera phụ.
 *  8. Ngăn chặn triệt để click bubbling (e.stopPropagation()) trên các nút hành động.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  X,
  MicOff,
  Video,
  Monitor,
  Radio,
  Scaling
} from 'lucide-react';
import { CameraType } from '../types';

export interface VideoTileProps {
  id: string;                         // ID duy nhất của stream
  stream: MediaStream;                // Luồng video MediaStream
  label: string;                      // Nhãn tên hiển thị (vd: "Bạn: Facecam", "Bob: Webcam")
  isLocal: boolean;                   // Luồng này là của máy mình hay nhận từ đối phương
  type: CameraType;                   // 'physical' | 'screen'
  isMuted?: boolean;                  // Người này có đang tắt mic hay không
  isSpeaking?: boolean;               // Người này có đang phát ra tiếng nói hay không
  isPinned?: boolean;                 // Khung hình có đang được ghim tiêu điểm hay không
  isThumbnail?: boolean;              // Có phải đang hiển thị ở dải thumbnail thu nhỏ hay không
  qualityMode?: 'high' | 'low';       // Chế độ chất lượng phát ('high': HD | 'low': 360p tiết kiệm)
  onTogglePin?: (id: string) => void; // Hàm ghim/bỏ ghim
  onRemove?: () => void;              // Hàm đóng luồng camera này (nếu là camera phụ của mình)
  onAspectRatioChange?: (id: string, ratio: number) => void; // Báo cáo tỉ lệ thực tế của video
  className?: string;
  style?: React.CSSProperties;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  id,
  stream,
  label,
  isLocal,
  type,
  isMuted = false,
  isSpeaking = false,
  isPinned = false,
  isThumbnail = false,
  qualityMode = 'high',
  onTogglePin,
  onRemove,
  onAspectRatioChange,
  className = '',
  style
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVideoActive, setIsVideoActive] = useState(true);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);

  // Gắn MediaStream vào video element & theo dõi track & độ phân giải
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(e => {
        console.warn(`[VideoTile] Autoplay failed for ${label}:`, e);
      });
    }

    const track = stream ? stream.getVideoTracks()[0] : null;

    const checkTrackState = () => {
      if (track) {
        setIsVideoActive(track.enabled && !track.muted);
      } else {
        setIsVideoActive(false);
      }
    };

    // Kiểm tra tỉ lệ ngay từ settings của track nếu có
    if (track && track.getSettings) {
      const s = track.getSettings();
      if (s.width && s.height && s.width > 0 && s.height > 0) {
        const r = s.width / s.height;
        setResolution({ width: s.width, height: s.height });
        onAspectRatioChange?.(id, r);
      }
    }

    const updateResolution = () => {
      if (video && video.videoWidth && video.videoHeight) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        setResolution({ width: w, height: h });
        onAspectRatioChange?.(id, w / h);
      }
    };

    checkTrackState();
    if (video) {
      video.addEventListener('loadedmetadata', updateResolution);
      video.addEventListener('resize', updateResolution);
      if (video.videoWidth && video.videoHeight) {
        updateResolution();
      }
    }

    if (track) {
      track.onmute = checkTrackState;
      track.onunmute = checkTrackState;
      track.onended = checkTrackState;
    }

    return () => {
      if (video) {
        video.removeEventListener('loadedmetadata', updateResolution);
        video.removeEventListener('resize', updateResolution);
        video.srcObject = null;
      }
      if (track) {
        track.onmute = null;
        track.onunmute = null;
        track.onended = null;
      }
    };
  }, [stream, label, id, onAspectRatioChange]);

  // Đồng bộ trạng thái toàn màn hình (kể cả khi ấn phím ESC ngoài trình duyệt)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.warn);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.warn);
    }
  }, []);

  const getBadgeIcon = () => {
    switch (type) {
      case 'screen':
        return <Monitor className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
      default:
        return <Video className="w-3.5 h-3.5 text-brand-400 shrink-0" />;
    }
  };

  const getBadgeTypeLabel = () => {
    switch (type) {
      case 'screen':
        return 'Screen Feed';
      default:
        return isLocal ? 'You' : 'Peer';
    }
  };

  return (
    <div
      ref={containerRef}
      style={style}
      className={`group relative overflow-hidden rounded-2xl bg-[#090b0e] border select-none flex items-center justify-center transition-[border-color,box-shadow,background-color] duration-200 ${
        isSpeaking
          ? 'border-brand-500 shadow-[0_0_24px_-2px_rgba(16,185,129,0.55)]'
          : isPinned
          ? 'border-brand-500/80 shadow-lg shadow-brand-500/10'
          : 'border-white/10 hover:border-white/25'
      } ${className}`}
    >
      {/* Video Element - Luôn hiển thị đúng tỉ lệ thực tế bằng object-contain (mặc định) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={true} // Dedicated audio element in useWebRTC handles voice playback, avoiding double audio and autoplay block
        className={`w-full h-full ${
          fitMode === 'cover' ? 'object-cover' : 'object-contain'
        } transition-opacity duration-200 ${
          isVideoActive ? 'opacity-100' : 'opacity-0'
        } ${isLocal && type === 'physical' ? '-scale-x-100' : ''}`}
      />

      {/* Fallback placeholder nếu video tạm dừng hoặc chưa có tín hiệu */}
      {!isVideoActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-950/85 backdrop-blur-md z-0">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-dark-850 border border-white/10 flex items-center justify-center text-slate-400 mb-2 shadow-xl">
            <Radio className="w-6 h-6 sm:w-8 sm:h-8 animate-pulse text-brand-500" />
          </div>
          <span className="text-xs sm:text-sm font-medium text-slate-300">Camera Feed Paused</span>
        </div>
      )}

      {/* Speaking Indicator Outline Glow */}
      {isSpeaking && (
        <div className="absolute inset-0 pointer-events-none rounded-2xl ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-950 animate-pulse z-10" />
      )}

      {/* ==================================================================== */}
      {/* OVERLAY: CHẾ ĐỘ THUMBNAIL NHỎ GỌN TRONG SPOTLIGHT SIDEBAR / STRIP   */}
      {/* ==================================================================== */}
      {isThumbnail ? (
        <>
          {/* Top thumbnail overlay */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10 gap-1.5">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-dark-950/85 backdrop-blur-md border border-white/10 text-[11px] font-medium text-slate-200 pointer-events-auto shadow-sm max-w-[calc(100%-28px)]">
              {getBadgeIcon()}
              <span className="truncate max-w-[90px]">{label}</span>
              {qualityMode === 'low' ? (
                <span className="text-[9px] font-mono px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {resolution && resolution.height > 0 ? `${resolution.height}p` : '360p'}
                </span>
              ) : (
                <span className="text-[9px] font-mono font-bold px-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {resolution && resolution.width >= 1920 ? '1080p' : 'HD'}
                </span>
              )}
            </div>

            {isLocal && onRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Tắt camera này"
                className="p-1 rounded-md bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30 transition-all pointer-events-auto"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Bottom thumbnail overlay */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
            <div className="pointer-events-auto">
              {isMuted && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px]">
                  <MicOff className="w-2.5 h-2.5" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-dark-950/85 border border-white/10 text-[9px] font-mono text-emerald-400 shadow-sm pointer-events-auto">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold">LIVE</span>
            </div>
          </div>
        </>
      ) : (
        /* ==================================================================== */
        /* OVERLAY: CHẾ ĐỘ TIÊU CHUẨN ĐẦY ĐỦ CHO TOÀN BỘ CÁC KHUNG VIDEO CHÍNH  */
        /* ==================================================================== */
        <>
          {/* Top Overlay Bar */}
          <div className="absolute top-2.5 sm:top-3 left-2.5 sm:left-3 right-2.5 sm:right-3 flex items-center justify-between pointer-events-none z-10 gap-2 transition-opacity duration-200 opacity-90 group-hover:opacity-100">
            {/* Source Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-dark-950/85 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 pointer-events-auto shadow-md max-w-[calc(100%-110px)] sm:max-w-none">
              {getBadgeIcon()}
              <span className="truncate max-w-[110px] sm:max-w-[170px] font-medium">{label}</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono px-1.5 py-0.5 rounded bg-white/5 shrink-0 hidden xs:inline-block">
                {getBadgeTypeLabel()}
              </span>

              {/* Quality Indicator Badge */}
              {qualityMode === 'low' ? (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  {resolution && resolution.height > 0 ? `${resolution.height}p • Tiết kiệm` : '360p • Tiết kiệm'}
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {resolution && resolution.width >= 1920 ? '1080p FHD' : 'HD'}
                </span>
              )}
            </div>

            {/* Action Controls */}
            <div className="flex items-center gap-1 pointer-events-auto shrink-0">
              {/* Nút chuyển đổi tỉ lệ hình ảnh: Fit (chuẩn) vs Cover (tràn) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFitMode(prev => (prev === 'contain' ? 'cover' : 'contain'));
                }}
                title={
                  fitMode === 'contain'
                    ? 'Chuẩn tỉ lệ (Fit) - Nhấp để chuyển sang Phóng to tràn ô (Fill)'
                    : 'Phóng to tràn ô (Fill) - Nhấp để về Chuẩn tỉ lệ gốc (Fit)'
                }
                className={`p-1.5 rounded-lg backdrop-blur-md transition-all text-xs ${
                  fitMode === 'cover'
                    ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'bg-dark-950/75 border border-white/10 text-slate-300 hover:bg-white/15'
                }`}
              >
                <Scaling className="w-3.5 h-3.5" />
              </button>

              {/* Nút ghim phóng to tiêu điểm */}
              {onTogglePin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(id);
                  }}
                  title={isPinned ? 'Bỏ ghim (Unpin)' : 'Ghim phóng to (Pin spotlight)'}
                  className={`p-1.5 rounded-lg backdrop-blur-md transition-all text-xs ${
                    isPinned
                      ? 'bg-brand-500 text-slate-950 font-bold shadow-md'
                      : 'bg-dark-950/75 border border-white/10 text-slate-300 hover:bg-white/15'
                  }`}
                >
                  {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              )}

              {/* Nút toàn màn hình */}
              <button
                onClick={(e) => toggleFullscreen(e)}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
                className="p-1.5 rounded-lg bg-dark-950/75 backdrop-blur-md border border-white/10 text-slate-300 hover:bg-white/15 transition-all text-xs"
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              {/* Nút đóng camera phụ của máy mình */}
              {isLocal && onRemove && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  title="Tắt camera này"
                  className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-all text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Bottom Info Bar */}
          <div className="absolute bottom-2.5 sm:bottom-3 left-2.5 sm:left-3 right-2.5 sm:right-3 flex items-center justify-between pointer-events-none z-10 gap-2">
            <div className="flex items-center gap-1.5 pointer-events-auto">
              {isMuted && (
                <div className="flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-medium backdrop-blur-md shadow-sm">
                  <MicOff className="w-3 h-3" />
                  <span>Muted</span>
                </div>
              )}
              {isSpeaking && !isMuted && (
                <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 rounded-md bg-brand-500/20 border border-brand-500/40 text-brand-400 text-xs font-semibold backdrop-blur-md animate-pulse shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-ping" />
                  <span>Speaking</span>
                </div>
              )}
            </div>

            {/* ON AIR badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-dark-950/85 border border-white/10 text-[11px] font-mono text-emerald-400 backdrop-blur-md shadow-sm pointer-events-auto">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              <span className="font-semibold tracking-wider text-[10px]">ON AIR</span>
              {resolution && (
                <span className="text-[10px] text-slate-400 font-mono ml-0.5 border-l border-white/10 pl-1.5 hidden sm:inline">
                  {resolution.width >= 1920
                    ? '1080p'
                    : resolution.width >= 1280
                    ? '720p'
                    : `${resolution.width}x${resolution.height}`}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
