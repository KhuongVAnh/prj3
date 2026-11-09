/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - CONTROL BAR (THANH ĐIỀU KHIỂN NỔI BÊN DƯỚI)
 * ============================================================================
 * Thanh công cụ điều khiển cuộc gọi cố định ở cạnh dưới màn hình:
 *  - Bật/Tắt Micro (Mute / Unmute)
 *  - Bật/Tắt Camera chính
 *  - Mở Hub Quản lý Đa Camera (Multi-Camera Hub) kèm huy hiệu đếm số camera ON AIR
 *  - Phím tắt nhanh kích hoạt Camera ảo (Quick Virtual Cam)
 *  - Chia sẻ màn hình (Screen Share)
 *  - Bật/Tắt ngăn kéo Chat kèm chỉ số tin nhắn chưa đọc (Unread badge)
 *  - Bảng thống kê kỹ thuật WebRTC (Stats & Network Latency)
 *  - Chia sẻ liên kết phòng họp (Copy invite link)
 *  - Kết thúc / Rời cuộc gọi (Leave Call)
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
  Share2
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

  return (
    <div className="flex items-center justify-center p-4 z-20">
      <div className="flex items-center gap-2 sm:gap-3 px-4 py-2.5 rounded-full glass-pill border border-white/10 shadow-2xl">
        {/* Mic Button */}
        <div className="relative">
          <button
            onClick={onToggleMute}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={`relative p-3.5 rounded-full transition-all duration-200 ${
              isMuted
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                : 'bg-white/10 text-slate-100 hover:bg-white/20'
            } ${isSpeaking && !isMuted ? 'ring-2 ring-brand-500' : ''}`}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        </div>

        {/* Quick Camera Toggle */}
        <button
          onClick={onTogglePrimaryCamera}
          title={hasActiveCamera ? 'Turn off primary camera' : 'Turn on primary camera'}
          className={`p-3.5 rounded-full transition-all duration-200 ${
            !hasActiveCamera
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-white/10 text-slate-100 hover:bg-white/20'
          }`}
        >
          {hasActiveCamera ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        <div className="w-[1px] h-6 bg-white/10 mx-0.5" />

        {/* Multi-Camera Hub Button with Counter Badge */}
        <button
          onClick={onOpenCamManager}
          title="Multi-Camera Hub (Add & Manage multiple cameras)"
          className="relative flex items-center gap-2 px-4 py-3 rounded-full bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold transition-all shadow-lg shadow-brand-500/20 group"
        >
          <Layers className="w-5 h-5" />
          <span className="text-xs hidden sm:inline">Multi-Cam</span>
          <span className="px-1.5 py-0.5 rounded-full bg-slate-950/30 text-[10px] font-mono">
            {activeCameraCount}
          </span>
        </button>

        {/* Screen Share */}
        <button
          onClick={onToggleScreenShare}
          title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen as Feed'}
          className={`p-3.5 rounded-full transition-all duration-200 hidden sm:flex items-center justify-center ${
            isScreenSharing
              ? 'bg-sky-500 text-slate-950 font-bold'
              : 'bg-white/10 text-slate-100 hover:bg-white/20'
          }`}
        >
          <Share2 className="w-5 h-5" />
        </button>

        {/* Chat Drawer Toggle */}
        <button
          onClick={onToggleChat}
          title="In-call Chat"
          className={`relative p-3.5 rounded-full transition-all duration-200 ${
            isChatOpen
              ? 'bg-white/20 text-brand-400'
              : 'bg-white/10 text-slate-100 hover:bg-white/20'
          }`}
        >
          <MessageSquare className="w-5 h-5" />
          {unreadCount > 0 && !isChatOpen && (
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center animate-bounce">
              {unreadCount}
            </span>
          )}
        </button>

        {/* WebRTC Stats */}
        <button
          onClick={onOpenStats}
          title="WebRTC Connection Stats"
          className="p-3.5 rounded-full bg-white/10 text-slate-100 hover:bg-white/20 transition-all hidden lg:flex items-center justify-center"
        >
          <Activity className="w-5 h-5" />
        </button>

        <div className="w-[1px] h-6 bg-white/10 mx-0.5" />

        {/* End Call Button */}
        <button
          onClick={onLeaveCall}
          title="Leave Call"
          className="p-3.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
