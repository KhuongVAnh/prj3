/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - VIDEO GRID (LƯỚI HIỂN THỊ ĐA LUỒNG VIDEO)
 * ============================================================================
 * Component điều phối bố cục hiển thị video giữa 2 người và nhiều camera:
 *  1. HỢP NHẤT TẤT CẢ CÁC LUỒNG:
 *     - Tập hợp cả luồng camera cục bộ (Local) và luồng nhận từ xa (Remote)
 *       vào một danh sách đồng nhất để render.
 *  2. BỐ CỤC LƯỚI TỰ THÍCH ỨNG (ADAPTIVE GRID):
 *     - 1 video: Toàn màn hình trung tâm.
 *     - 2 video: Chia đôi ngang/dọc (Split view 1-1 cân đối).
 *     - 3-4 video: Lưới 2x2.
 *     - 5-6 video: Lưới 2x3.
 *  3. CHẾ ĐỘ TIÊU ĐIỂM (SPOTLIGHT / PIN MODE):
 *     - Khi người dùng ghim 1 camera bất kỳ (vd: góc chiếu tài liệu bàn làm việc),
 *       camera đó phóng to làm màn hình chính, các camera còn lại xếp thành
 *       dải thumbnail bên cạnh.
 */

import React from 'react';
import { CameraSource, RemoteCameraStream } from '../types';
import { VideoTile } from './VideoTile';
import { Video, UserPlus, Sparkles } from 'lucide-react';

interface VideoGridProps {
  localCameras: CameraSource[];
  remoteCameras: RemoteCameraStream[];
  isLocalSpeaking: boolean;
  isRemoteSpeaking?: boolean;
  isLocalMuted: boolean;
  pinnedId: string | null;
  onTogglePin: (id: string) => void;
  onRemoveLocalCamera: (id: string) => void;
  peerConnected: boolean;
  peerName?: string;
  onOpenCamManager?: () => void;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  localCameras,
  remoteCameras,
  isLocalSpeaking,
  isRemoteSpeaking = false,
  isLocalMuted,
  pinnedId,
  onTogglePin,
  onRemoveLocalCamera,
  peerConnected,
  peerName = 'Peer',
  onOpenCamManager
}) => {
  // Combine all active streams into unified list for display
  const allStreams = [
    ...localCameras.map(cam => ({
      id: cam.id,
      stream: cam.stream,
      label: cam.label,
      isLocal: true,
      type: cam.type,
      isMuted: isLocalMuted,
      isSpeaking: isLocalSpeaking,
      onRemove: () => onRemoveLocalCamera(cam.id)
    })),
    ...remoteCameras.map(cam => ({
      id: cam.id,
      stream: cam.stream,
      label: `${peerName}: ${cam.label}`,
      isLocal: false,
      type: cam.type,
      isMuted: cam.isMuted,
      isSpeaking: isRemoteSpeaking && !cam.isMuted,
      onRemove: undefined
    }))
  ];

  // Pinned stream check
  const pinnedStream = pinnedId ? allStreams.find(s => s.id === pinnedId) : null;
  const secondaryStreams = pinnedStream ? allStreams.filter(s => s.id !== pinnedId) : [];

  // If no streams at all
  if (allStreams.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-3xl bg-dark-900 border border-white/10 flex items-center justify-center mb-5 text-slate-400 shadow-2xl">
          <Video className="w-10 h-10 text-brand-500 animate-pulse" />
        </div>
        <h3 className="text-xl font-bold text-slate-100 mb-2">No Active Cameras</h3>
        <p className="text-slate-400 text-sm max-w-md mb-6">
          Turn on your physical webcam or launch an instant virtual camera stream from the bottom control bar to start broadcasting.
        </p>
        {onOpenCamManager && (
          <button
            onClick={onOpenCamManager}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-brand-500/25"
          >
            <Sparkles className="w-4 h-4" />
            <span>Open Multi-Camera Hub</span>
          </button>
        )}
      </div>
    );
  }

  // Pinned / Spotlight Layout
  if (pinnedStream) {
    return (
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 min-h-0 overflow-hidden">
        {/* Main Spotlight Video */}
        <div className="flex-1 min-h-[300px] h-full flex items-center justify-center">
          <VideoTile
            key={pinnedStream.id}
            id={pinnedStream.id}
            stream={pinnedStream.stream}
            label={pinnedStream.label}
            isLocal={pinnedStream.isLocal}
            type={pinnedStream.type}
            isMuted={pinnedStream.isMuted}
            isSpeaking={pinnedStream.isSpeaking}
            isPinned={true}
            onTogglePin={onTogglePin}
            onRemove={pinnedStream.onRemove}
            className="w-full h-full max-h-[82vh]"
          />
        </div>

        {/* Side thumbnail strip */}
        {secondaryStreams.length > 0 && (
          <div className="lg:w-80 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto max-h-[82vh] pr-1">
            {secondaryStreams.map(item => (
              <div key={item.id} className="w-64 lg:w-full h-44 shrink-0">
                <VideoTile
                  id={item.id}
                  stream={item.stream}
                  label={item.label}
                  isLocal={item.isLocal}
                  type={item.type}
                  isMuted={item.isMuted}
                  isSpeaking={item.isSpeaking}
                  isPinned={false}
                  onTogglePin={onTogglePin}
                  onRemove={item.onRemove}
                  className="w-full h-full cursor-pointer hover:border-brand-500/50"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Adaptive Grid Layout based on count
  const count = allStreams.length;

  let gridColsClass = 'grid-cols-1';
  if (count === 2) {
    gridColsClass = 'grid-cols-1 md:grid-cols-2';
  } else if (count === 3) {
    gridColsClass = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  } else if (count === 4) {
    gridColsClass = 'grid-cols-1 sm:grid-cols-2';
  } else if (count >= 5 && count <= 6) {
    gridColsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  } else if (count > 6) {
    gridColsClass = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  }

  return (
    <div className="flex-1 p-4 min-h-0 overflow-y-auto flex items-center justify-center">
      <div className={`grid gap-4 w-full h-full max-h-[82vh] max-w-7xl mx-auto ${gridColsClass}`}>
        {allStreams.map(item => (
          <VideoTile
            key={item.id}
            id={item.id}
            stream={item.stream}
            label={item.label}
            isLocal={item.isLocal}
            type={item.type}
            isMuted={item.isMuted}
            isSpeaking={item.isSpeaking}
            isPinned={false}
            onTogglePin={onTogglePin}
            onRemove={item.onRemove}
            className="w-full h-full min-h-[220px]"
          />
        ))}

        {/* If remote peer hasn't joined yet, show a clean invitation card */}
        {!peerConnected && (
          <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-dark-900/40 border border-dashed border-white/10 text-center min-h-[220px]">
            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400 mb-3">
              <UserPlus className="w-6 h-6 text-brand-400 animate-pulse" />
            </div>
            <h4 className="font-semibold text-slate-200 text-sm mb-1">Waiting for Peer</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              Share your room link or code. Once they join, their video streams will appear here automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
