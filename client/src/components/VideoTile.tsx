/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - VIDEO TILE (KHUNG HIỂN THỊ LUỒNG VIDEO)
 * ============================================================================
 * Component hiển thị một luồng video đơn lẻ (cục bộ hoặc từ đối phương):
 *  - Gắn MediaStream vào thẻ HTML5 <video> với chế độ autoplay và muted.
 *  - Bảo toàn tỉ lệ khung hình thực tế bằng object-contain (có thể chuyển Fill).
 *  - Lật gương đối với webcam vật lý cục bộ.
 *  - Viền Cobalt sắc nét khi người dùng đang nói (Speaking Indicator).
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
  VideoOff,
  Monitor,
  Scaling
} from 'lucide-react';
import { CameraType, VideoQualityMode } from '../types';

export interface VideoTileProps {
  id: string;
  stream: MediaStream;
  label: string;
  isLocal: boolean;
  type: CameraType;
  isMuted?: boolean;
  isSpeaking?: boolean;
  isPinned?: boolean;
  isThumbnail?: boolean;
  qualityMode?: VideoQualityMode;
  onTogglePin?: (id: string) => void;
  onRemove?: () => void;
  onAspectRatioChange?: (id: string, ratio: number) => void;
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
  qualityMode = 'grid',
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
  const [hasFrame, setHasFrame] = useState<boolean>(isLocal);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setHasFrame(isLocal);
    setResolution(null);
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(e => {
        if (e?.name !== 'AbortError') {
          console.warn(`[VideoTile] Autoplay failed for ${label}:`, e);
        }
      });
    }

    const track = stream ? stream.getVideoTracks()[0] : null;

    const checkTrackState = () => {
      if (track) {
        const active = track.enabled && !track.muted && track.readyState !== 'ended';
        setIsVideoActive(active);
        if (!active && !isLocal) {
          setHasFrame(false);
        }
      } else {
        setIsVideoActive(false);
        setHasFrame(false);
      }
    };

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
        setHasFrame(true);
        onAspectRatioChange?.(id, w / h);
      }
    };

    const handleVideoPlaying = () => {
      updateResolution();
      if (track && track.enabled && track.readyState !== 'ended') {
        setIsVideoActive(true);
      }
    };

    checkTrackState();
    if (video) {
      video.addEventListener('loadedmetadata', updateResolution);
      video.addEventListener('resize', updateResolution);
      video.addEventListener('playing', handleVideoPlaying);
      video.addEventListener('loadeddata', handleVideoPlaying);
      if (video.videoWidth && video.videoHeight) {
        updateResolution();
      }
    }

    if (track) {
      track.addEventListener('mute', checkTrackState);
      track.addEventListener('unmute', checkTrackState);
      track.addEventListener('ended', checkTrackState);
    }

    return () => {
      if (video) {
        video.removeEventListener('loadedmetadata', updateResolution);
        video.removeEventListener('resize', updateResolution);
        video.removeEventListener('playing', handleVideoPlaying);
        video.removeEventListener('loadeddata', handleVideoPlaying);
        video.srcObject = null;
      }
      if (track) {
        track.removeEventListener('mute', checkTrackState);
        track.removeEventListener('unmute', checkTrackState);
        track.removeEventListener('ended', checkTrackState);
      }
    };
  }, [stream, label, id, isLocal, onAspectRatioChange]);

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
    if (type === 'screen') {
      return <Monitor className="w-3.5 h-3.5 text-ink-secondary shrink-0" strokeWidth={1.75} />;
    }
    return <Video className="w-3.5 h-3.5 text-ink-secondary shrink-0" strokeWidth={1.75} />;
  };

  const getResolutionTag = () => {
    if (!isLocal && !resolution) {
      return 'Chờ khung hình';
    }
    if (qualityMode === 'low') {
      return resolution && resolution.height > 0 && resolution.height <= 540
        ? `${resolution.height}p`
        : '360p';
    }
    if (qualityMode === 'grid') {
      return resolution && resolution.height > 0 && resolution.height < 720
        ? `${resolution.height}p`
        : '720p';
    }
    return resolution && resolution.width >= 1920 ? '1080p' : 'HD';
  };

  const showVideo = isVideoActive && hasFrame;

  return (
    <div
      ref={containerRef}
      style={style}
      className={`group relative overflow-hidden rounded-2xl border select-none flex items-center justify-center shadow-tile transition-[border-color,box-shadow] duration-150 ${
        showVideo ? 'bg-surface-video' : 'bg-surface-muted'
      } ${
        isSpeaking
          ? 'border-accent ring-2 ring-accent ring-offset-2 ring-offset-canvas'
          : isPinned
          ? 'border-line-strong'
          : 'border-line-subtle hover:border-line-strong'
      } ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={true}
        className={`w-full h-full ${
          fitMode === 'cover' ? 'object-cover' : 'object-contain'
        } transition-opacity duration-150 ${
          showVideo ? 'opacity-100' : 'opacity-0'
        } ${isLocal && type === 'physical' ? '-scale-x-100' : ''}`}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-subtle z-0 px-4 text-center">
          <div className="w-11 h-11 rounded-xl bg-surface border border-line-subtle flex items-center justify-center mb-2.5 text-ink-secondary shadow-sm">
            <VideoOff className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <span className="text-xs font-medium text-ink-secondary">
            {isVideoActive ? 'Đang chờ nhận hình ảnh P2P...' : 'Tín hiệu camera tạm dừng'}
          </span>
        </div>
      )}

      {isThumbnail ? (
        <>
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10 gap-1.5">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/95 border border-line-subtle text-[11px] font-medium text-ink-primary shadow-sm pointer-events-auto max-w-[calc(100%-28px)]">
              <span className="truncate">{label}</span>
              <span className="text-[10px] font-mono text-ink-muted shrink-0">
                {getResolutionTag()}
              </span>
            </div>

            {isLocal && onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Tắt nguồn này"
                className="p-1 rounded-lg bg-white/95 hover:bg-red-50 text-ink-secondary hover:text-red-600 border border-line-subtle shadow-sm transition-colors pointer-events-auto"
              >
                <X className="w-3 h-3" strokeWidth={2} />
              </button>
            )}
          </div>

          {isMuted && (
            <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-lg bg-red-50 border border-red-200 text-red-600 shadow-sm z-10">
              <MicOff className="w-3 h-3" strokeWidth={1.75} />
            </div>
          )}
        </>
      ) : (
        <>
          {/* Top Overlay */}
          <div className="absolute top-2.5 sm:top-3 left-2.5 sm:left-3 right-2.5 sm:right-3 flex items-center justify-between pointer-events-none z-10 gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/95 border border-line-subtle text-xs text-ink-primary shadow-sm pointer-events-auto max-w-[calc(100%-130px)] sm:max-w-none">
              {getBadgeIcon()}
              <span className="truncate max-w-[140px] sm:max-w-[200px] font-medium">
                {label}
              </span>
              <span className="text-[11px] font-mono text-ink-secondary shrink-0 border-l border-line-subtle pl-2">
                {getResolutionTag()}
              </span>
            </div>

            <div
              className={`flex items-center gap-1 pointer-events-auto shrink-0 transition-opacity duration-150 ${
                isPinned
                  ? 'opacity-100'
                  : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFitMode(prev => (prev === 'contain' ? 'cover' : 'contain'));
                }}
                title={fitMode === 'contain' ? 'Phóng to tràn khung' : 'Hiển thị đúng tỉ lệ gốc'}
                className={`p-1.5 rounded-lg border shadow-sm transition-colors ${
                  fitMode === 'cover'
                    ? 'bg-accent border-accent text-white'
                    : 'bg-white/95 border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface'
                }`}
              >
                <Scaling className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>

              {onTogglePin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(id);
                  }}
                  title={isPinned ? 'Bỏ ghim' : 'Ghim khung này'}
                  className={`p-1.5 rounded-lg border shadow-sm transition-colors ${
                    isPinned
                      ? 'bg-accent border-accent text-white'
                      : 'bg-white/95 border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface'
                  }`}
                >
                  {isPinned ? (
                    <PinOff className="w-3.5 h-3.5" strokeWidth={1.75} />
                  ) : (
                    <Pin className="w-3.5 h-3.5" strokeWidth={1.75} />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={(e) => toggleFullscreen(e)}
                title={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
                className="p-1.5 rounded-lg bg-white/95 border border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface shadow-sm transition-colors"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                )}
              </button>

              {isLocal && onRemove && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  title="Tắt nguồn video này"
                  className="p-1.5 rounded-lg bg-white/95 border border-line-subtle text-ink-secondary hover:text-red-600 hover:bg-red-50 hover:border-red-200 shadow-sm transition-colors"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>

          {isMuted && (
            <div className="absolute bottom-2.5 sm:bottom-3 left-2.5 sm:left-3 z-10 pointer-events-none">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50/95 border border-red-200 text-red-700 text-xs font-medium shadow-sm">
                <MicOff className="w-3 h-3" strokeWidth={1.75} />
                <span>Đang tắt mic</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
