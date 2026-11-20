/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - CONTROL BAR (THANH ĐIỀU KHIỂN CUỘC GỌI)
 * ============================================================================
 * Thanh công cụ điều khiển cuộc gọi cố định ở cạnh dưới màn hình:
 *  - Bật/Tắt Micro (Mute / Unmute)
 *  - Bật/Tắt Camera chính
 *  - Mở Hub Quản lý Đa Camera kèm bộ đếm nguồn đang phát
 *  - Chia sẻ màn hình (Screen Share)
 *  - Bật/Tắt Bảng trắng chung (Shared Whiteboard)
 *  - Bật/Tắt ngăn kéo Chat kèm chỉ số tin nhắn chưa đọc
 *  - Bảng thống kê kỹ thuật WebRTC
 *  - Rời phòng (Leave Call)
 */

import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Layers,
  MessageSquare,
  Activity,
  PhoneOff,
  Share2,
  PenTool,
  MonitorUp
} from 'lucide-react';
import { CameraSource } from '../types';

interface ControlBarProps {
  isMuted: boolean;
  onToggleMute: () => void;
  localCameras: CameraSource[];
  onTogglePrimaryCamera: () => void;
  onOpenCamManager: () => void;
  onToggleScreenShare: () => void;
  isScreenSharing: boolean;
  isWhiteboardOpen: boolean;
  isWhiteboardOwner: boolean;
  whiteboardOwnerName: string | null;
  onToggleWhiteboard: () => void;
  onToggleChat: () => void;
  isChatOpen: boolean;
  unreadCount?: number;
  onOpenStats: () => void;
  onLeaveCall: () => void;
  onShareRoom: () => void;
  isSpeaking: boolean;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isMuted,
  onToggleMute,
  localCameras,
  onTogglePrimaryCamera,
  onOpenCamManager,
  onToggleScreenShare,
  isScreenSharing,
  isWhiteboardOpen,
  isWhiteboardOwner,
  whiteboardOwnerName,
  onToggleWhiteboard,
  onToggleChat,
  isChatOpen,
  unreadCount = 0,
  onOpenStats,
  onLeaveCall,
  onShareRoom,
  isSpeaking
}) => {
  const hasActiveCamera = localCameras.length > 0;
  const activeCameraCount = localCameras.length;
  const isWhiteboardLockedByOther = isWhiteboardOpen && !isWhiteboardOwner;

  const baseBtn =
    'relative h-10 rounded-xl border text-xs font-medium transition-colors duration-150 flex items-center justify-center gap-2 active:translate-y-[1px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <footer className="w-full px-3 sm:px-5 pb-3 pt-1 shrink-0 z-20 flex justify-center bg-canvas">
      <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-2 rounded-2xl bg-surface border border-line-subtle shadow-dock max-w-full overflow-x-auto">
        {/* Mic */}
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? 'Bật micro' : 'Tắt micro'}
          className={`${baseBtn} px-3 ${
            isMuted
              ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
              : 'bg-surface-subtle border-line-subtle text-ink-primary hover:bg-surface-muted'
          } ${isSpeaking && !isMuted ? 'ring-2 ring-accent/40 border-accent' : ''}`}
        >
          {isMuted ? (
            <MicOff className="w-4 h-4 text-red-600" strokeWidth={1.75} />
          ) : (
            <Mic className="w-4 h-4 text-ink-secondary" strokeWidth={1.75} />
          )}
          <span className="hidden md:inline">{isMuted ? 'Đang tắt mic' : 'Micro'}</span>
        </button>

        {/* Primary Camera */}
        <button
          type="button"
          onClick={onTogglePrimaryCamera}
          title={hasActiveCamera ? 'Tắt camera chính' : 'Bật camera chính'}
          className={`${baseBtn} px-3 ${
            !hasActiveCamera
              ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
              : 'bg-surface-subtle border-line-subtle text-ink-primary hover:bg-surface-muted'
          }`}
        >
          {hasActiveCamera ? (
            <Video className="w-4 h-4 text-ink-secondary" strokeWidth={1.75} />
          ) : (
            <VideoOff className="w-4 h-4 text-red-600" strokeWidth={1.75} />
          )}
          <span className="hidden md:inline">Camera</span>
        </button>

        {/* Multi-Camera Hub */}
        <button
          type="button"
          onClick={onOpenCamManager}
          title="Quản lý nhiều camera và nguồn phát"
          className={`${baseBtn} px-3 bg-surface-subtle border-line-subtle text-ink-primary hover:bg-surface-muted`}
        >
          <Layers className="w-4 h-4 text-accent" strokeWidth={1.75} />
          <span className="hidden sm:inline">Đa camera</span>
          <span className="px-1.5 py-0.5 rounded-md bg-surface border border-line-subtle font-mono text-[11px] tabular-nums text-ink-secondary">
            {activeCameraCount}
          </span>
        </button>

        <div className="w-px h-5 bg-line-subtle mx-0.5 shrink-0" />

        {/* Screen Share */}
        <button
          type="button"
          onClick={onToggleScreenShare}
          title={isScreenSharing ? 'Dừng chia sẻ màn hình' : 'Chia sẻ màn hình'}
          className={`${baseBtn} px-3 hidden sm:flex ${
            isScreenSharing
              ? 'bg-accent border-accent text-white hover:bg-accent-hover'
              : 'bg-surface-subtle border-line-subtle text-ink-primary hover:bg-surface-muted'
          }`}
        >
          <MonitorUp className="w-4 h-4" strokeWidth={1.75} />
          <span className="hidden lg:inline">{isScreenSharing ? 'Đang chia sẻ' : 'Màn hình'}</span>
        </button>

        {/* Shared Whiteboard */}
        <button
          type="button"
          onClick={onToggleWhiteboard}
          disabled={isWhiteboardLockedByOther}
          title={
            isWhiteboardLockedByOther
              ? `Bảng trắng đang được mở bởi ${whiteboardOwnerName || 'đối phương'}`
              : isWhiteboardOpen
              ? 'Đóng bảng trắng'
              : 'Mở bảng trắng chung'
          }
          className={`${baseBtn} px-3 ${
            isWhiteboardLockedByOther
              ? 'bg-surface-subtle border-line-subtle text-ink-muted cursor-not-allowed opacity-60'
              : isWhiteboardOpen && isWhiteboardOwner
              ? 'bg-accent border-accent text-white hover:bg-accent-hover'
              : 'bg-surface-subtle border-line-subtle text-ink-primary hover:bg-surface-muted'
          }`}
        >
          <PenTool className="w-4 h-4" strokeWidth={1.75} />
          <span className="hidden lg:inline">Bảng trắng</span>
          {isWhiteboardLockedByOther && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
        </button>

        {/* Chat Drawer */}
        <button
          type="button"
          onClick={onToggleChat}
          title="Tin nhắn trong phòng"
          className={`${baseBtn} px-3 ${
            isChatOpen
              ? 'bg-accent border-accent text-white hover:bg-accent-hover'
              : 'bg-surface-subtle border-line-subtle text-ink-primary hover:bg-surface-muted'
          }`}
        >
          <MessageSquare className="w-4 h-4" strokeWidth={1.75} />
          <span className="hidden lg:inline">Tin nhắn</span>
          {unreadCount > 0 && !isChatOpen && (
            <span className="px-1.5 py-0.5 rounded-md bg-accent text-[10px] font-mono font-semibold text-white leading-none">
              {unreadCount}
            </span>
          )}
        </button>

        <div className="w-px h-5 bg-line-subtle mx-0.5 shrink-0" />

        {/* Diagnostics / Stats */}
        <button
          type="button"
          onClick={onOpenStats}
          title="Thông số kết nối WebRTC"
          className={`${baseBtn} px-2.5 bg-surface-subtle border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-muted flex`}
        >
          <Activity className="w-4 h-4" strokeWidth={1.75} />
        </button>

        {/* Copy invite link on small screens */}
        <button
          type="button"
          onClick={onShareRoom}
          title="Sao chép link mời"
          className={`${baseBtn} px-2.5 bg-surface-subtle border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-muted sm:hidden`}
        >
          <Share2 className="w-4 h-4" strokeWidth={1.75} />
        </button>

        {/* Leave Call */}
        <button
          type="button"
          onClick={onLeaveCall}
          title="Rời phòng"
          className={`${baseBtn} px-3.5 bg-red-600 hover:bg-red-700 border-red-600 text-white`}
        >
          <PhoneOff className="w-4 h-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">Rời phòng</span>
        </button>
      </div>
    </footer>
  );
};
