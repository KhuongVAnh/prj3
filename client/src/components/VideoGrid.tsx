/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - VIDEO GRID (LƯỚI HIỂN THỊ ĐA LUỒNG VIDEO)
 * ============================================================================
 * Component điều phối bố cục hiển thị video giữa 2 người và nhiều camera:
 *  - Tự động tính toán kích thước vừa khít viewport theo tỉ lệ thực tế của từng luồng.
 *  - Hỗ trợ chế độ tiêu điểm (Spotlight / Pin) và dải thumbnail phụ.
 *  - Duy trì 1 wrapper DOM cố định để ResizeObserver hoạt động ổn định.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CameraSource,
  RemoteCameraStream,
  VideoQualityMode,
  WhiteboardLiveDraw,
  WhiteboardPoint,
  WhiteboardState,
  WhiteboardStroke,
  WhiteboardTool
} from '../types';
import { VideoTile } from './VideoTile';
import { WhiteboardTile } from './WhiteboardTile';
import { Video, SlidersHorizontal } from 'lucide-react';

export interface VideoGridProps {
  localCameras: CameraSource[];
  remoteCameras: RemoteCameraStream[];
  isLocalSpeaking: boolean;
  isRemoteSpeaking?: boolean;
  isLocalMuted: boolean;
  pinnedId: string | null;
  localQualityModes?: Record<string, VideoQualityMode>;
  onTogglePin: (id: string) => void;
  onRemoveLocalCamera: (id: string) => void;
  peerConnected: boolean;
  peerName?: string;
  roomId?: string;
  onOpenCamManager?: () => void;
  onShareRoom?: () => void;
  whiteboardState?: WhiteboardState;
  isWhiteboardOwner?: boolean;
  onCloseWhiteboard?: () => void;
  onWhiteboardLiveDraw?: (payload: {
    strokeId: string;
    tool: WhiteboardTool;
    color: string;
    size: number;
    points: WhiteboardPoint[];
  }) => void;
  onWhiteboardCommitStroke?: (stroke: Omit<WhiteboardStroke, 'authorId' | 'authorName'>) => void;
  onWhiteboardUndo?: () => void;
  onWhiteboardClear?: () => void;
  onWhiteboardToggleGrid?: () => void;
  registerWhiteboardLiveHandler?: (handler: ((draw: WhiteboardLiveDraw) => void) | null) => void;
}

type GridItem =
  | {
      kind: 'video';
      id: string;
      stream: MediaStream;
      label: string;
      isLocal: boolean;
      type: CameraSource['type'];
      isMuted?: boolean;
      isSpeaking: boolean;
      onRemove?: () => void;
    }
  | {
      kind: 'whiteboard';
      id: 'whiteboard';
    };

export function fitBox(availW: number, availH: number, ratio: number = 16 / 9): { width: number; height: number } {
  const safeW = Math.max(10, availW);
  const safeH = Math.max(10, availH);
  const r = ratio > 0 && isFinite(ratio) ? ratio : 16 / 9;

  let w = safeW;
  let h = safeW / r;
  if (h > safeH) {
    h = safeH;
    w = safeH * r;
  }
  return { width: Math.floor(w), height: Math.floor(h) };
}

function getTrackAspectRatio(stream?: MediaStream | null): number | null {
  if (!stream) return null;
  const track = stream.getVideoTracks()[0];
  if (!track || !track.getSettings) return null;
  const s = track.getSettings();
  if (s.aspectRatio && s.aspectRatio > 0) return s.aspectRatio;
  if (s.width && s.height && s.width > 0 && s.height > 0) return s.width / s.height;
  return null;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  localCameras,
  remoteCameras,
  isLocalSpeaking,
  isRemoteSpeaking = false,
  isLocalMuted,
  pinnedId,
  localQualityModes,
  onTogglePin,
  onRemoveLocalCamera,
  peerConnected,
  peerName = 'Đối phương',
  roomId,
  onOpenCamManager,
  onShareRoom,
  whiteboardState,
  isWhiteboardOwner = false,
  onCloseWhiteboard,
  onWhiteboardLiveDraw,
  onWhiteboardCommitStroke,
  onWhiteboardUndo,
  onWhiteboardClear,
  onWhiteboardToggleGrid,
  registerWhiteboardLiveHandler
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [streamRatios, setStreamRatios] = useState<Record<string, number>>({});

  const getQuality = useCallback((id: string, isPinnedTile: boolean, isThumbTile: boolean): VideoQualityMode => {
    if (isPinnedTile) return 'high';
    if (isThumbTile) return 'low';
    if (pinnedId && id !== pinnedId) return 'low';
    if (localQualityModes && localQualityModes[id]) return localQualityModes[id];
    return 'grid';
  }, [pinnedId, localQualityModes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleAspectRatioChange = useCallback((id: string, ratio: number) => {
    if (!ratio || !isFinite(ratio) || ratio <= 0) return;
    setStreamRatios(prev => {
      if (prev[id] && Math.abs(prev[id] - ratio) < 0.02) return prev;
      return { ...prev, [id]: ratio };
    });
  }, []);

  const allStreams = useMemo<GridItem[]>(() => {
    const items: GridItem[] = [
      ...localCameras.map(cam => ({
        kind: 'video' as const,
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
        kind: 'video' as const,
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

    if (whiteboardState?.isOpen) {
      items.push({ kind: 'whiteboard', id: 'whiteboard' });
    }
    return items;
  }, [
    localCameras,
    remoteCameras,
    isLocalMuted,
    isLocalSpeaking,
    isRemoteSpeaking,
    peerName,
    onRemoveLocalCamera,
    whiteboardState?.isOpen
  ]);

  const getItemRatio = useCallback(
    (item: GridItem): number => {
      if (item.kind === 'whiteboard') return 16 / 9;
      if (streamRatios[item.id]) return streamRatios[item.id];
      const fromTrack = getTrackAspectRatio(item.stream);
      if (fromTrack) return fromTrack;
      return 16 / 9;
    },
    [streamRatios]
  );

  const pinnedStream = pinnedId ? allStreams.find(s => s.id === pinnedId) : null;
  const secondaryStreams = pinnedStream ? allStreams.filter(s => s.id !== pinnedId) : [];

  const renderTile = (
    item: GridItem,
    opts: {
      isPinned: boolean;
      isThumbnail: boolean;
      className?: string;
      style?: React.CSSProperties;
    }
  ) => {
    if (item.kind === 'whiteboard') {
      return (
        <WhiteboardTile
          key={item.id}
          roomId={roomId}
          strokes={whiteboardState?.strokes || []}
          showGrid={Boolean(whiteboardState?.showGrid)}
          ownerName={whiteboardState?.ownerName || null}
          isOwner={isWhiteboardOwner}
          isPinned={opts.isPinned}
          isThumbnail={opts.isThumbnail}
          onTogglePin={onTogglePin}
          onCloseWhiteboard={onCloseWhiteboard}
          onLiveDraw={onWhiteboardLiveDraw || (() => {})}
          onCommitStroke={onWhiteboardCommitStroke || (() => {})}
          onUndo={onWhiteboardUndo || (() => {})}
          onClear={onWhiteboardClear || (() => {})}
          onToggleGrid={onWhiteboardToggleGrid || (() => {})}
          registerLiveHandler={registerWhiteboardLiveHandler || (() => {})}
          className={opts.className}
          style={opts.style}
        />
      );
    }

    return (
      <VideoTile
        key={item.id}
        id={item.id}
        stream={item.stream}
        label={item.label}
        isLocal={item.isLocal}
        type={item.type}
        isMuted={item.isMuted}
        isSpeaking={item.isSpeaking}
        isPinned={opts.isPinned}
        isThumbnail={opts.isThumbnail}
        qualityMode={getQuality(item.id, opts.isPinned, opts.isThumbnail)}
        onTogglePin={onTogglePin}
        onRemove={item.onRemove}
        onAspectRatioChange={handleAspectRatioChange}
        className={opts.className}
        style={opts.style}
      />
    );
  };

  const { width: availW, height: availH } = dimensions;
  const gap = 14;
  const count = allStreams.length;
  const isLandscape = availW >= availH;
  const hasDimensions = availW > 0 && availH > 0;

  const renderContent = () => {
    if (count === 0) {
      return (
        <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center p-6 text-center select-none animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-surface border border-line-subtle shadow-card flex items-center justify-center mb-4 text-ink-secondary">
            <Video className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <h3 className="text-base font-semibold text-ink-primary mb-1.5">Chưa có nguồn video nào</h3>
          <p className="text-ink-secondary text-sm max-w-sm mb-5">
            Bật webcam hoặc chia sẻ màn hình từ thanh công cụ bên dưới để bắt đầu phát.
          </p>
          {onOpenCamManager && (
            <button
              type="button"
              onClick={onOpenCamManager}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-xs transition-colors shadow-sm"
            >
              <SlidersHorizontal className="w-4 h-4" strokeWidth={1.75} />
              <span>Chọn nguồn video</span>
            </button>
          )}
        </div>
      );
    }

    const renderSizedSlot = (item: GridItem, target: { width: number; height: number }, fallbackAspect = '16/9') => (
      <div
        key={item.id}
        style={
          hasDimensions
            ? { width: `${target.width}px`, height: `${target.height}px` }
            : { aspectRatio: fallbackAspect, maxWidth: '100%', maxHeight: '100%' }
        }
        className="shrink-0 flex items-center justify-center"
      >
        {renderTile(item, { isPinned: false, isThumbnail: false, className: 'w-full h-full' })}
      </div>
    );

    if (pinnedStream) {
      const pinnedRatio = getItemRatio(pinnedStream);

      if (secondaryStreams.length === 0) {
        const target = fitBox(availW, availH, pinnedRatio);
        return (
          <div className="flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden">
            {renderTile(pinnedStream, {
              isPinned: true,
              isThumbnail: false,
              style: hasDimensions
                ? { width: `${target.width}px`, height: `${target.height}px` }
                : { aspectRatio: `${pinnedRatio}`, maxWidth: '100%', maxHeight: '100%' }
            })}
          </div>
        );
      }

      if (availW >= 800 && isLandscape) {
        const sidebarW = Math.min(280, Math.max(190, Math.floor(availW * 0.22)));
        const mainSize = fitBox(availW - sidebarW - gap, availH, pinnedRatio);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-row items-center justify-center gap-3.5 overflow-hidden">
            <div className="flex-1 h-full min-h-0 flex items-center justify-center">
              {renderTile(pinnedStream, {
                isPinned: true,
                isThumbnail: false,
                style: hasDimensions
                  ? { width: `${mainSize.width}px`, height: `${mainSize.height}px` }
                  : { aspectRatio: `${pinnedRatio}`, maxWidth: '100%', maxHeight: '100%' }
              })}
            </div>

            <div
              style={{ width: `${sidebarW}px` }}
              className="h-full shrink-0 flex flex-col gap-2.5 overflow-y-auto pr-1 py-1"
            >
              {secondaryStreams.map(item => (
                <div
                  key={item.id}
                  onClick={() => onTogglePin(item.id)}
                  title="Nhấp để đưa lên khung chính"
                  className="w-full aspect-video shrink-0 rounded-2xl overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-accent"
                >
                  {renderTile(item, { isPinned: false, isThumbnail: true, className: 'w-full h-full' })}
                </div>
              ))}
            </div>
          </div>
        );
      } else {
        const stripH = Math.min(120, Math.max(85, Math.floor(availH * 0.2)));
        const mainSize = fitBox(availW, availH - stripH - gap, pinnedRatio);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-between gap-3 overflow-hidden">
            <div className="flex-1 w-full min-h-0 flex items-center justify-center">
              {renderTile(pinnedStream, {
                isPinned: true,
                isThumbnail: false,
                style: hasDimensions
                  ? { width: `${mainSize.width}px`, height: `${mainSize.height}px` }
                  : { aspectRatio: `${pinnedRatio}`, maxWidth: '100%', maxHeight: '100%' }
              })}
            </div>

            <div
              style={{ height: `${stripH}px` }}
              className="w-full shrink-0 flex flex-row items-center justify-center gap-2.5 overflow-x-auto py-1"
            >
              {secondaryStreams.map(item => (
                <div
                  key={item.id}
                  onClick={() => onTogglePin(item.id)}
                  title="Nhấp để đưa lên khung chính"
                  className="h-full aspect-video shrink-0 rounded-2xl overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-accent"
                >
                  {renderTile(item, { isPinned: false, isThumbnail: true, className: 'w-full h-full' })}
                </div>
              ))}
            </div>
          </div>
        );
      }
    }

    if (count === 1) {
      const single = allStreams[0];
      const singleRatio = getItemRatio(single);
      const target = fitBox(availW, availH, singleRatio);

      return (
        <div className="flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden">
          {renderTile(single, {
            isPinned: false,
            isThumbnail: false,
            style: hasDimensions
              ? { width: `${target.width}px`, height: `${target.height}px` }
              : { aspectRatio: `${singleRatio}`, maxWidth: '100%', maxHeight: '100%' }
          })}
        </div>
      );
    }

    if (count === 2) {
      const useSideBySide = isLandscape;
      const target = useSideBySide
        ? fitBox((availW - gap) / 2, availH, 16 / 9)
        : fitBox(availW, (availH - gap) / 2, 16 / 9);

      return (
        <div
          className={`flex-1 w-full h-full min-h-0 flex items-center justify-center gap-3 sm:gap-3.5 overflow-hidden ${
            useSideBySide ? 'flex-row' : 'flex-col'
          }`}
        >
          {allStreams.map(item => renderSizedSlot(item, target))}
        </div>
      );
    }

    if (count === 3 || count === 4) {
      const isMobilePortrait = !isLandscape && count === 3;
      const stack3Target = isMobilePortrait ? fitBox(availW, (availH - gap * 2) / 3, 16 / 9) : null;
      const grid2x2Target = fitBox((availW - gap) / 2, (availH - gap) / 2, 16 / 9);
      const useStack3 =
        isMobilePortrait &&
        stack3Target &&
        stack3Target.width * stack3Target.height > grid2x2Target.width * grid2x2Target.height;

      if (useStack3 && stack3Target) {
        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-2.5 overflow-hidden">
            {allStreams.map(item => renderSizedSlot(item, stack3Target))}
          </div>
        );
      }

      const row1 = allStreams.slice(0, 2);
      const row2 = allStreams.slice(2, count);

      return (
        <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-3 sm:gap-3.5 overflow-hidden">
          <div className="flex flex-row items-center justify-center gap-3 sm:gap-3.5 w-full">
            {row1.map(item => renderSizedSlot(item, grid2x2Target))}
          </div>
          <div className="flex flex-row items-center justify-center gap-3 sm:gap-3.5 w-full">
            {row2.map(item => renderSizedSlot(item, grid2x2Target))}
          </div>
        </div>
      );
    }

    if (count === 5 || count === 6) {
      if (isLandscape) {
        const target = fitBox((availW - gap * 2) / 3, (availH - gap) / 2, 16 / 9);
        const row1 = allStreams.slice(0, 3);
        const row2 = allStreams.slice(3, count);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-3 sm:gap-3.5 overflow-hidden">
            <div className="flex flex-row items-center justify-center gap-3 sm:gap-3.5 w-full">
              {row1.map(item => renderSizedSlot(item, target))}
            </div>
            <div className="flex flex-row items-center justify-center gap-3 sm:gap-3.5 w-full">
              {row2.map(item => renderSizedSlot(item, target))}
            </div>
          </div>
        );
      } else {
        const target = fitBox((availW - gap) / 2, (availH - gap * 2) / 3, 16 / 9);
        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-2.5 overflow-hidden">
            {[0, 2, 4].map(startIdx => {
              const rowItems = allStreams.slice(startIdx, Math.min(startIdx + 2, count));
              if (rowItems.length === 0) return null;
              return (
                <div key={startIdx} className="flex flex-row items-center justify-center gap-2.5 w-full">
                  {rowItems.map(item => renderSizedSlot(item, target))}
                </div>
              );
            })}
          </div>
        );
      }
    }

    return (
      <div className="flex-1 w-full h-full min-h-0 overflow-y-auto flex items-center justify-center py-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 w-full max-w-7xl mx-auto py-2">
          {allStreams.map(item => (
            <div key={item.id} className="w-full aspect-video rounded-2xl overflow-hidden">
              {renderTile(item, { isPinned: false, isThumbnail: false, className: 'w-full h-full' })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full h-full min-h-0 relative overflow-hidden flex flex-col items-center justify-center p-3 sm:p-4 select-none bg-canvas"
    >
      {renderContent()}

      {!peerConnected && count > 0 && (
        <div className="absolute top-3.5 sm:top-4 z-20 flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-surface border border-line-subtle shadow-dock text-xs text-ink-secondary pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span>Đang chờ đối phương vào phòng</span>
          {roomId && (
            <span className="font-mono font-medium text-ink-primary hidden sm:inline">
              {roomId}
            </span>
          )}
          {onShareRoom && (
            <button
              type="button"
              onClick={onShareRoom}
              className="text-accent hover:text-accent-hover font-medium transition-colors pl-2 border-l border-line-subtle"
            >
              Sao chép link mời
            </button>
          )}
        </div>
      )}
    </div>
  );
};
