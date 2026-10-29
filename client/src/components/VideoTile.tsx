/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - VIDEO TILE (KHUNG HIỂN THỊ LUỒNG VIDEO)
 * ============================================================================
 * Component hiển thị một luồng video đơn lẻ (cục bộ hoặc từ đối phương):
 *  1. Gắn MediaStream vào thẻ HTML5 <video> với chế độ autoplay và muted
 *     (Tránh hiện tượng tự vọng tiếng Echo và vượt qua chính sách Autoplay Policy của trình duyệt).
 *  2. Lật gương hình ảnh (Mirror effect scale-x-[-1]) đối với webcam vật lý cục bộ.
 *  3. Hiệu ứng viền phát sáng xanh lục (Speaking Indicator ring) khi người này đang nói.
 *  4. Các nút tương tác nhanh: Ghim phóng to (Pin), Toàn màn hình (Fullscreen), Đóng camera phụ (Close).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pin, PinOff, X, MicOff, Video, Sparkles, Monitor, Radio } from 'lucide-react';
import { CameraType } from '../types';

interface VideoTileProps {
  id: string;                      // ID duy nhất của stream
  stream: MediaStream;             // Luồng video MediaStream
  label: string;                   // Nhãn tên hiển thị (vd: "Bạn: Facecam", "Bob: SMPTE Clock")
  isLocal: boolean;                // Luồng này là của máy mình hay nhận từ đối phương
  type: CameraType;                // 'physical' | 'virtual' | 'screen'
  isMuted?: boolean;               // Người này có đang tắt mic hay không
  isSpeaking?: boolean;            // Người này có đang phát ra tiếng nói hay không
  isPinned?: boolean;              // Khung hình có đang được ghim tiêu điểm hay không
  onTogglePin?: (id: string) => void; // Hàm ghim/bỏ ghim
  onRemove?: () => void;           // Hàm đóng luồng camera này (nếu là camera phụ của mình)
  className?: string;
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
  onTogglePin,
  onRemove,
  className = ''
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVideoActive, setIsVideoActive] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(e => {
        console.warn(`[VideoTile] Autoplay failed for ${label}:`, e);
      });
    }

    const checkTrackState = () => {
      const track = stream.getVideoTracks()[0];
      setIsVideoActive(track ? track.enabled && !track.muted : false);
    };

    checkTrackState();
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onmute = checkTrackState;
      track.onunmute = checkTrackState;
      track.onended = checkTrackState;
    }
  }, [stream, label]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.warn);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.warn);
    }
  };

  const getBadgeIcon = () => {
    switch (type) {
      case 'virtual':
        return <Sparkles className="w-3.5 h-3.5 text-amber-400" />;
      case 'screen':
        return <Monitor className="w-3.5 h-3.5 text-sky-400" />;
      default:
        return <Video className="w-3.5 h-3.5 text-brand-400" />;
    }
  };

  const getBadgeTypeLabel = () => {
    switch (type) {
      case 'virtual':
        return 'Virtual Stream';
      case 'screen':
        return 'Screen Feed';
      default:
        return isLocal ? 'You' : 'Peer';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`group relative overflow-hidden rounded-2xl bg-dark-900 border transition-all duration-300 select-none ${
        isSpeaking
          ? 'border-brand-500 shadow-[0_0_20px_-2px_rgba(16,185,129,0.5)]'
          : isPinned
          ? 'border-brand-500/70 shadow-lg'
          : 'border-white/10 hover:border-white/20'
      } ${className}`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={true} // Dedicated audio element in useWebRTC handles voice playback, avoiding double audio and autoplay block
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isVideoActive ? 'opacity-100' : 'opacity-0'
        } ${isLocal && type === 'physical' ? '-scale-x-100' : ''}`}
      />

      {/* Fallback avatar if video paused/empty */}
      {!isVideoActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-950/80 backdrop-blur-md">
          <div className="w-16 h-16 rounded-full bg-dark-800 border border-white/10 flex items-center justify-center text-slate-400 mb-2">
            <Radio className="w-8 h-8 animate-pulse text-brand-500" />
          </div>
          <span className="text-sm font-medium text-slate-300">Camera Feed Paused</span>
        </div>
      )}

      {/* Speaking Indicator Outline Glow */}
      {isSpeaking && (
        <div className="absolute inset-0 pointer-events-none rounded-2xl ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-950 animate-pulse" />
      )}

      {/* Top Overlay Bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between opacity-90 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        {/* Source Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-dark-950/80 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 pointer-events-auto shadow-md">
          {getBadgeIcon()}
          <span className="truncate max-w-[160px]">{label}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono px-1.5 py-0.5 rounded bg-white/5">
            {getBadgeTypeLabel()}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 pointer-events-auto">
          {onTogglePin && (
            <button
              onClick={() => onTogglePin(id)}
              title={isPinned ? 'Unpin camera' : 'Pin to spotlight'}
              className={`p-1.5 rounded-lg backdrop-blur-md transition-all text-xs ${
                isPinned
                  ? 'bg-brand-500 text-slate-950 font-bold shadow-md'
                  : 'bg-dark-950/70 border border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-1.5 rounded-lg bg-dark-950/70 backdrop-blur-md border border-white/10 text-slate-300 hover:bg-white/10 transition-all text-xs"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {isLocal && onRemove && (
            <button
              onClick={onRemove}
              title="Turn off this camera"
              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-all text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom Info Bar */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-2 pointer-events-auto">
          {isMuted && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-medium backdrop-blur-md">
              <MicOff className="w-3 h-3" />
              <span>Muted</span>
            </div>
          )}
          {isSpeaking && !isMuted && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-500/20 border border-brand-500/40 text-brand-400 text-xs font-semibold backdrop-blur-md animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-ping" />
              <span>Speaking</span>
            </div>
          )}
        </div>

        {/* Live indicator tag */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-dark-950/80 border border-white/10 text-[11px] font-mono text-slate-400 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>LIVE</span>
        </div>
      </div>
    </div>
  );
};
