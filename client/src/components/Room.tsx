/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - ROOM VIEW (GIAO DIỆN PHÒNG GỌI CHÍNH)
 * ============================================================================
 * Màn hình phòng gọi video 1-1 trực tiếp:
 *  - Tích hợp hook useWebRTC để đàm phán P2P và truyền phát đa camera.
 *  - Thanh điều khiển trên cùng (Meeting Header): mã phòng, đồng hồ đếm giờ, số lượng luồng video, sao chép link.
 *  - Khu vực chính: Lưới video thích ứng (VideoGrid) tự sắp xếp luồng local và remote.
 *  - Thanh điều khiển dưới (ControlBar) và các Modal (CameraManagerModal, ChatDrawer, StatsModal).
 */

import React, { useState, useEffect, useRef } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useAudioLevel } from '../hooks/useAudioLevel';
import { VideoGrid } from './VideoGrid';
import { ControlBar } from './ControlBar';
import { CameraManagerModal } from './CameraManagerModal';
import { ChatDrawer } from './ChatDrawer';
import { StatsModal } from './StatsModal';
import {
  Copy,
  Check,
  Users,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Radio
} from 'lucide-react';

interface RoomProps {
  roomId: string;
  userName: string;
  initialAudio: boolean;
  initialVideo: boolean;
  useVirtualCam: boolean;
  onLeaveRoom: () => void;
}

export const Room: React.FC<RoomProps> = ({
  roomId,
  userName,
  initialAudio,
  initialVideo,
  useVirtualCam,
  onLeaveRoom
}) => {
  const {
    socket,
    isConnected,
    isRoomFull,
    peerInfo,
    isPolite,
    localAudioStream,
    remoteAudioStream,
    isMuted,
    toggleMute,
    initAudio,
    localCameras,
    remoteCameras,
    availableVideoDevices,
    refreshDevices,
    addPhysicalCamera,
    addVirtualCamera,
    addScreenShare,
    removeCamera,
    chatMessages,
    sendMessage,
    stats
  } = useWebRTC(roomId, userName);

  // Audio level monitoring for local and remote users
  const { isSpeaking: isLocalSpeaking } = useAudioLevel(localAudioStream, !isMuted);
  const { isSpeaking: isRemoteSpeaking } = useAudioLevel(remoteAudioStream, !peerInfo?.isMuted);

  // UI state
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isCamManagerOpen, setIsCamManagerOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Keep track of unread messages when chat drawer is closed
  const prevMessagesLength = useRef(chatMessages.length);
  useEffect(() => {
    if (!isChatOpen && chatMessages.length > prevMessagesLength.current) {
      setUnreadChatCount(prev => prev + (chatMessages.length - prevMessagesLength.current));
    } else if (isChatOpen) {
      setUnreadChatCount(0);
    }
    prevMessagesLength.current = chatMessages.length;
  }, [chatMessages, isChatOpen]);

  // Call duration counter
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize media according to lobby choices
  useEffect(() => {
    const setupInitialMedia = async () => {
      const devices = await refreshDevices();

      if (initialAudio) {
        await initAudio();
      }

      if (useVirtualCam) {
        addVirtualCamera('clock');
      } else if (initialVideo) {
        try {
          // Explicitly pass the first detected camera device ID so it maps cleanly to hardware
          const firstDeviceId = devices && devices.length > 0 ? devices[0].deviceId : undefined;
          await addPhysicalCamera(firstDeviceId);
        } catch (err) {
          console.warn('[Room] Falling back to virtual camera as physical webcam is unavailable:', err);
          addVirtualCamera('clock');
        }
      }
    };

    setupInitialMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleCopyLink = () => {
    const shareUrl = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }).catch(console.warn);
  };

  const handleTogglePin = (id: string) => {
    setPinnedId(prev => (prev === id ? null : id));
  };

  const handleRemoveLocalCamera = (id: string) => {
    if (pinnedId === id) {
      setPinnedId(null);
    }
    removeCamera(id);
  };

  const handleTogglePrimaryCamera = async () => {
    const primaryPhysical = localCameras.find(c => c.type === 'physical');
    if (primaryPhysical) {
      handleRemoveLocalCamera(primaryPhysical.id);
    } else {
      try {
        await addPhysicalCamera();
      } catch (e) {
        addVirtualCamera('clock');
      }
    }
  };

  const handleQuickAddVirtualCam = () => {
    // If clock virtual cam is already running, toggle blueprint, otherwise add clock
    const hasClock = localCameras.some(c => c.id === 'virtual-clock');
    if (hasClock) {
      addVirtualCamera('blueprint');
    } else {
      addVirtualCamera('clock');
    }
  };

  const handleTogglePhysicalCameraInModal = async (deviceId: string) => {
    const cameraId = `physical-${deviceId}`;
    const exists = localCameras.some(c => c.deviceId === deviceId || c.id === cameraId);
    if (exists) {
      const target = localCameras.find(c => c.deviceId === deviceId || c.id === cameraId);
      if (target) handleRemoveLocalCamera(target.id);
    } else {
      await addPhysicalCamera(deviceId);
    }
  };

  const handleToggleVirtualCameraInModal = (pattern: 'clock' | 'blueprint' | 'radar') => {
    const cameraId = `virtual-${pattern}`;
    const exists = localCameras.some(c => c.id === cameraId);
    if (exists) {
      handleRemoveLocalCamera(cameraId);
    } else {
      addVirtualCamera(pattern);
    }
  };

  const handleToggleScreenShareInModal = async () => {
    const screenCam = localCameras.find(c => c.type === 'screen');
    if (screenCam) {
      handleRemoveLocalCamera(screenCam.id);
    } else {
      await addScreenShare();
    }
  };

  // If room is full (more than 2 participants attempted to enter 1-1 room)
  if (isRoomFull) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full p-8 rounded-3xl bg-dark-900 border border-white/10 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">Room is Full</h2>
          <p className="text-sm text-slate-400 mb-6">
            This room already has 2 participants in a private 1-on-1 call. Please create a new room or use a different code.
          </p>
          <button
            onClick={onLeaveRoom}
            className="w-full py-3 rounded-2xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-brand-500/20"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  const isPeerConnected = Boolean(peerInfo);
  const totalActiveStreams = localCameras.length + remoteCameras.length;

  return (
    <div className="h-screen w-screen bg-dark-950 flex flex-col overflow-hidden select-none">
      {/* Top Meeting Bar */}
      <header className="h-16 px-4 sm:px-6 border-b border-white/10 bg-dark-900/80 backdrop-blur-md flex items-center justify-between shrink-0 z-20">
        {/* Left: Room Info & Copy Link */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-850 border border-white/10">
            <Radio className="w-3.5 h-3.5 text-brand-400 animate-pulse" />
            <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wide">
              {roomId}
            </span>
            <button
              onClick={handleCopyLink}
              title="Copy Meeting Link"
              className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors ml-1"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-brand-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {copiedLink && (
            <span className="text-xs text-brand-400 font-medium animate-fade-in hidden sm:inline">
              Link copied!
            </span>
          )}
        </div>

        {/* Center: Duration & Status */}
        <div className="hidden sm:flex items-center gap-3 font-mono text-xs">
          <div className="px-3 py-1 rounded-full bg-dark-850 border border-white/10 text-slate-300">
            {formatDuration(callDuration)}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-dark-850 border border-white/10">
            <span
              className={`w-2 h-2 rounded-full ${
                isPeerConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span className="text-slate-300">
              {isPeerConnected ? `Connected with ${peerInfo?.peerName}` : 'Waiting for Peer'}
            </span>
          </div>
        </div>

        {/* Right: Multi-Cam stats badge & Participants */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCamManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/20 text-xs font-semibold transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{localCameras.length} Local Feeds</span>
          </button>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dark-850 border border-white/10 text-xs text-slate-300 font-mono">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>{isPeerConnected ? '2/2' : '1/2'}</span>
          </div>
        </div>
      </header>

      {/* Main Workspace (Video Grid + Optional Chat Drawer) */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        <VideoGrid
          localCameras={localCameras}
          remoteCameras={remoteCameras}
          isLocalSpeaking={isLocalSpeaking}
          isRemoteSpeaking={isRemoteSpeaking}
          isLocalMuted={isMuted}
          pinnedId={pinnedId}
          onTogglePin={handleTogglePin}
          onRemoveLocalCamera={handleRemoveLocalCamera}
          peerConnected={isPeerConnected}
          peerName={peerInfo?.peerName}
          onOpenCamManager={() => setIsCamManagerOpen(true)}
        />

        {/* In-Call Chat Drawer */}
        <ChatDrawer
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          messages={chatMessages}
          currentUserId={socket?.id}
          onSendMessage={sendMessage}
        />
      </div>

      {/* Floating Bottom Control Bar */}
      <ControlBar
        isMuted={isMuted}
        onToggleMute={toggleMute}
        localCameras={localCameras}
        onTogglePrimaryCamera={handleTogglePrimaryCamera}
        onOpenCamManager={() => setIsCamManagerOpen(true)}
        onQuickAddVirtualCam={handleQuickAddVirtualCam}
        onToggleScreenShare={handleToggleScreenShareInModal}
        isScreenSharing={localCameras.some(c => c.type === 'screen')}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        isChatOpen={isChatOpen}
        unreadCount={unreadChatCount}
        onOpenStats={() => setIsStatsOpen(true)}
        onLeaveCall={onLeaveRoom}
        onShareRoom={handleCopyLink}
        isSpeaking={isLocalSpeaking}
      />

      {/* Multi-Camera Management Hub Modal */}
      <CameraManagerModal
        isOpen={isCamManagerOpen}
        onClose={() => setIsCamManagerOpen(false)}
        availableDevices={availableVideoDevices}
        activeCameras={localCameras}
        onTogglePhysicalCamera={handleTogglePhysicalCameraInModal}
        onToggleVirtualCamera={handleToggleVirtualCameraInModal}
        onToggleScreenShare={handleToggleScreenShareInModal}
        onRefreshDevices={refreshDevices}
      />

      {/* WebRTC Diagnostics & Stats Modal */}
      <StatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={stats}
        roomId={roomId}
        isPolite={isPolite}
        peerConnected={isPeerConnected}
      />
    </div>
  );
};
