/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - ROOM VIEW (GIAO DIỆN PHÒNG GỌI CHÍNH)
 * ============================================================================
 * Màn hình phòng gọi video 1-1 trực tiếp:
 *  - Tích hợp hook useWebRTC để đàm phán P2P và truyền phát đa camera.
 *  - Thanh điều khiển trên cùng: mã phòng, sao chép link, trạng thái đối phương, đồng hồ.
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
  AlertTriangle,
  Video,
  SlidersHorizontal
} from 'lucide-react';

interface RoomProps {
  roomId: string;
  userName: string;
  initialAudio: boolean;
  initialVideo: boolean;
  onLeaveRoom: () => void;
}

export const Room: React.FC<RoomProps> = ({
  roomId,
  userName,
  initialAudio,
  initialVideo,
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
    addScreenShare,
    removeCamera,
    chatMessages,
    sendMessage,
    stats,
    hasTurnServer,
    iceConnectionState,
    connectionState,
    debugLogs,
    localQualityModes,
    sendPinStateUpdate,
    whiteboardState,
    toggleWhiteboard,
    emitWhiteboardLive,
    commitWhiteboardStroke,
    undoWhiteboard,
    clearWhiteboard,
    toggleWhiteboardGrid,
    registerWhiteboardLiveHandler
  } = useWebRTC(roomId, userName, initialAudio);

  const { isSpeaking: isLocalSpeaking } = useAudioLevel(localAudioStream, !isMuted);
  const { isSpeaking: isRemoteSpeaking } = useAudioLevel(remoteAudioStream, !peerInfo?.isMuted);

  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isCamManagerOpen, setIsCamManagerOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isIceStalled, setIsIceStalled] = useState(false);

  const prevMessagesLength = useRef(chatMessages.length);
  useEffect(() => {
    if (!isChatOpen && chatMessages.length > prevMessagesLength.current) {
      setUnreadChatCount(prev => prev + (chatMessages.length - prevMessagesLength.current));
    } else if (isChatOpen) {
      setUnreadChatCount(0);
    }
    prevMessagesLength.current = chatMessages.length;
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    if (pinnedId === 'whiteboard' && !whiteboardState.isOpen) {
      setPinnedId(null);
      sendPinStateUpdate(null);
    }
  }, [pinnedId, whiteboardState.isOpen, sendPinStateUpdate]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!peerInfo || connectionState === 'connected') {
      setIsIceStalled(false);
      return;
    }
    if (iceConnectionState === 'failed' || connectionState === 'failed') {
      setIsIceStalled(true);
      return;
    }
    const timer = setTimeout(() => {
      setIsIceStalled(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [peerInfo, iceConnectionState, connectionState]);

  useEffect(() => {
    const setupInitialMedia = async () => {
      const devices = await refreshDevices();

      if (initialAudio) {
        await initAudio();
      }

      if (initialVideo) {
        try {
          const firstDeviceId = devices && devices.length > 0 ? devices[0].deviceId : undefined;
          await addPhysicalCamera(firstDeviceId);
        } catch (err) {
          console.warn('[Room] Không thể mở webcam vật lý:', err);
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
    const nextPinnedId = pinnedId === id ? null : id;
    setPinnedId(nextPinnedId);

    if (!nextPinnedId) {
      sendPinStateUpdate(null);
    } else {
      const remoteCam = remoteCameras.find(rc => rc.id === nextPinnedId);
      if (remoteCam) {
        sendPinStateUpdate(remoteCam.cameraId);
      } else {
        sendPinStateUpdate(nextPinnedId);
      }
    }
  };

  const handleRemoveLocalCamera = (id: string) => {
    if (pinnedId === id) {
      setPinnedId(null);
      sendPinStateUpdate(null);
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
        console.warn('[Room] Lỗi khi bật lại camera chính:', e);
      }
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

  const handleToggleScreenShareInModal = async () => {
    const screenCam = localCameras.find(c => c.type === 'screen');
    if (screenCam) {
      handleRemoveLocalCamera(screenCam.id);
    } else {
      await addScreenShare();
    }
  };

  if (isRoomFull) {
    return (
      <div className="min-h-[100dvh] bg-canvas flex items-center justify-center p-6">
        <div className="max-w-md w-full p-7 rounded-2xl bg-surface border border-line-subtle shadow-card">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mb-4">
            <AlertTriangle className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <h2 className="text-lg font-semibold text-ink-primary mb-1.5">Phòng đã đủ người</h2>
          <p className="text-sm text-ink-secondary mb-6 leading-relaxed">
            Phòng họp 1-1 này hiện đã có 2 người tham gia. Vui lòng tạo mã phòng khác hoặc quay lại sảnh chờ.
          </p>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="w-full py-2.5 px-4 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm transition-colors"
          >
            Quay lại sảnh chờ
          </button>
        </div>
      </div>
    );
  }

  const isPeerConnected = Boolean(peerInfo);
  const isWhiteboardOwner = Boolean(
    whiteboardState.isOpen && whiteboardState.ownerId && socket?.id && whiteboardState.ownerId === socket.id
  );

  return (
    <div className="h-[100dvh] w-screen bg-canvas flex flex-col overflow-hidden select-none">
      {/* Top Light Header */}
      <header className="h-14 px-4 sm:px-5 border-b border-line-subtle bg-surface flex items-center justify-between shrink-0 z-20 gap-3">
        {/* Left: Wordmark & Room ID */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white">
              <Video className="w-3.5 h-3.5" strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold tracking-tight text-ink-primary">OmniCam</span>
          </div>

          <div className="hidden md:block w-px h-4 bg-line-subtle shrink-0" />

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-surface-subtle border border-line-subtle min-w-0">
            <span className="text-xs font-mono font-medium text-ink-primary truncate">{roomId}</span>
            <button
              type="button"
              onClick={handleCopyLink}
              title="Sao chép đường dẫn phòng"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs text-ink-secondary hover:text-ink-primary hover:bg-surface-muted transition-colors shrink-0"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={2} />
                  <span className="hidden sm:inline text-emerald-700 font-medium">Đã chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                  <span className="hidden sm:inline">Sao chép</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Center: Peer Status & Timer */}
        <div className="hidden sm:flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-surface-subtle border border-line-subtle text-ink-secondary">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isPeerConnected ? 'bg-emerald-600' : 'bg-amber-500'
              }`}
            />
            <span className="truncate max-w-[200px] font-medium text-ink-primary">
              {isPeerConnected ? `Đang gọi với ${peerInfo?.peerName}` : 'Đang chờ đối phương'}
            </span>
          </div>

          <span className="font-mono tabular-nums text-ink-secondary">
            {formatDuration(callDuration)}
          </span>
        </div>

        {/* Right: Sources & Participant Count */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsCamManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-subtle hover:bg-surface-muted border border-line-subtle text-xs font-medium text-ink-primary transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-accent" strokeWidth={1.75} />
            <span className="hidden xs:inline">Nguồn phát</span>
            <span className="font-mono text-ink-secondary tabular-nums">({localCameras.length})</span>
          </button>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-subtle border border-line-subtle text-xs font-mono tabular-nums text-ink-secondary">
            <Users className="w-3.5 h-3.5 text-ink-muted" strokeWidth={1.75} />
            <span>{isPeerConnected ? '2/2' : '1/2'}</span>
          </div>
        </div>
      </header>

      {/* Signaling Disconnect Banner */}
      {!isConnected && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs flex items-center justify-center gap-2 shrink-0 z-10">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Mất kết nối tới máy chủ Signaling. Đang thử kết nối lại...</span>
        </div>
      )}

      {/* ICE Failure / Stalled Banner */}
      {isPeerConnected && (iceConnectionState === 'failed' || isIceStalled) && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs flex items-center justify-center gap-2 shrink-0 z-10 text-center">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>
            {hasTurnServer
              ? 'Kết nối mạng P2P/TURN đang bị gián đoạn. Đang tự động thử kết nối lại...'
              : 'Chưa nối được luồng hình ảnh qua mạng khác nhau (4G hoặc Wifi khác) do server chưa cấu hình TURN Server.'}
          </span>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        <VideoGrid
          localCameras={localCameras}
          remoteCameras={remoteCameras}
          isLocalSpeaking={isLocalSpeaking}
          isRemoteSpeaking={isRemoteSpeaking}
          isLocalMuted={isMuted}
          pinnedId={pinnedId}
          localQualityModes={localQualityModes}
          onTogglePin={handleTogglePin}
          onRemoveLocalCamera={handleRemoveLocalCamera}
          peerConnected={isPeerConnected}
          peerName={peerInfo?.peerName}
          roomId={roomId}
          onOpenCamManager={() => setIsCamManagerOpen(true)}
          onShareRoom={handleCopyLink}
          whiteboardState={whiteboardState}
          isWhiteboardOwner={isWhiteboardOwner}
          onCloseWhiteboard={toggleWhiteboard}
          onWhiteboardLiveDraw={emitWhiteboardLive}
          onWhiteboardCommitStroke={commitWhiteboardStroke}
          onWhiteboardUndo={undoWhiteboard}
          onWhiteboardClear={clearWhiteboard}
          onWhiteboardToggleGrid={toggleWhiteboardGrid}
          registerWhiteboardLiveHandler={registerWhiteboardLiveHandler}
        />

        <ChatDrawer
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          messages={chatMessages}
          currentUserId={socket?.id}
          onSendMessage={sendMessage}
        />
      </div>

      {/* Control Dock */}
      <ControlBar
        isMuted={isMuted}
        onToggleMute={toggleMute}
        localCameras={localCameras}
        onTogglePrimaryCamera={handleTogglePrimaryCamera}
        onOpenCamManager={() => setIsCamManagerOpen(true)}
        onToggleScreenShare={handleToggleScreenShareInModal}
        isScreenSharing={localCameras.some(c => c.type === 'screen')}
        isWhiteboardOpen={whiteboardState.isOpen}
        isWhiteboardOwner={isWhiteboardOwner}
        whiteboardOwnerName={whiteboardState.ownerName}
        onToggleWhiteboard={toggleWhiteboard}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        isChatOpen={isChatOpen}
        unreadCount={unreadChatCount}
        onOpenStats={() => setIsStatsOpen(true)}
        onLeaveCall={onLeaveRoom}
        onShareRoom={handleCopyLink}
        isSpeaking={isLocalSpeaking}
      />

      {/* Modals */}
      <CameraManagerModal
        isOpen={isCamManagerOpen}
        onClose={() => setIsCamManagerOpen(false)}
        availableDevices={availableVideoDevices}
        activeCameras={localCameras}
        onTogglePhysicalCamera={handleTogglePhysicalCameraInModal}
        onToggleScreenShare={handleToggleScreenShareInModal}
        onRefreshDevices={refreshDevices}
      />

      <StatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={stats}
        roomId={roomId}
        isPolite={isPolite}
        peerConnected={isPeerConnected}
        hasTurnServer={hasTurnServer}
        iceConnectionState={iceConnectionState}
        connectionState={connectionState}
        debugLogs={debugLogs}
      />
    </div>
  );
};
