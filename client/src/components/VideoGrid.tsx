/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - VIDEO GRID (LƯỚI HIỂN THỊ ĐA LUỒNG VIDEO)
 * ============================================================================
 * Component điều phối bố cục hiển thị video giữa 2 người và nhiều camera:
 *  1. HỢP NHẤT TẤT CẢ CÁC LUỒNG:
 *     - Tập hợp cả luồng camera cục bộ (Local) và luồng nhận từ xa (Remote)
 *       vào một danh sách đồng nhất để render.
 *  2. BỐ CỤC LƯỚI TỰ THÍCH ỨNG (ADAPTIVE VIEWPORT-FITTING GRID):
 *     - 1 video: Toàn màn hình trung tâm, đạt kích thước lớn nhất trong viewport
 *       nhưng luôn bảo toàn đúng tỉ lệ khung hình thực tế (16:9, 4:3, v.v.).
 *     - 2 video: Chia đôi ngang (side-by-side) trên desktop hoặc dọc (stacked)
 *       trên màn hình dọc để đạt kích thước lớn nhất, không sinh thanh cuộn.
 *     - 3-4 video: Lưới cân bằng 2x2 khớp 100% không gian màn hình, không sinh thanh cuộn.
 *       (3 video thì video thứ 3 căn giữa cân xứng, cùng kích thước với 2 video trên).
 *     - 5-6 video: Lưới 3x2 (hoặc 2x3 trên màn hình dọc) vừa vặn khung nhìn.
 *     - 7+ video: Lưới responsive cuộn mượt mà.
 *  3. CHẾ ĐỘ TIÊU ĐIỂM (SPOTLIGHT / PIN MODE):
 *     - Luồng được ghim chiếm trọn khung hình chính bảo toàn tỉ lệ thực tế.
 *     - Các luồng phụ xếp thành dải thumbnail sắc nét ở cạnh phải (desktop)
 *       hoặc cạnh dưới (mobile). Nhấp vào bất kỳ thumbnail nào để chuyển tiêu điểm.
 *  4. KIẾN TRÚC MỘT WRAPPER DUY NHẤT:
 *     - containerRef luôn duy trì trên 1 phần tử DOM duy nhất, đảm bảo ResizeObserver
 *       hoạt động chuẩn xác 100% trong suốt vòng đời của component.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CameraSource, RemoteCameraStream } from '../types';
import { VideoTile } from './VideoTile';
import { Video, UserPlus, Sparkles } from 'lucide-react';

export interface VideoGridProps {
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
  roomId?: string;
  onOpenCamManager?: () => void;
  onShareRoom?: () => void;
}

/**
 * Tính toán kích thước tối đa vừa vặn vùng chứa theo tỉ lệ ratio cho trước (mặc định 16:9)
 */
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

/**
 * Lấy tỉ lệ khung hình từ MediaStreamTrack nếu đã có sẵn
 */
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
  onTogglePin,
  onRemoveLocalCamera,
  peerConnected,
  peerName = 'Peer',
  roomId,
  onOpenCamManager,
  onShareRoom
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [streamRatios, setStreamRatios] = useState<Record<string, number>>({});

  // Theo dõi chính xác kích thước vùng chứa VideoGrid để tự co giãn tối ưu
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

  // Nhận báo cáo tỉ lệ thực tế từ VideoTile khi video tải metadata
  const handleAspectRatioChange = useCallback((id: string, ratio: number) => {
    if (!ratio || !isFinite(ratio) || ratio <= 0) return;
    setStreamRatios(prev => {
      if (prev[id] && Math.abs(prev[id] - ratio) < 0.02) return prev;
      return { ...prev, [id]: ratio };
    });
  }, []);

  // Hợp nhất danh sách tất cả các luồng camera đang hoạt động
  const allStreams = useMemo(() => [
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
  ], [localCameras, remoteCameras, isLocalMuted, isLocalSpeaking, isRemoteSpeaking, peerName, onRemoveLocalCamera]);

  // Hàm xác định tỉ lệ khung hình cho một stream cụ thể
  const getStreamRatio = useCallback((id: string, stream: MediaStream): number => {
    if (streamRatios[id]) return streamRatios[id];
    const fromTrack = getTrackAspectRatio(stream);
    if (fromTrack) return fromTrack;
    return 16 / 9;
  }, [streamRatios]);

  // Kiểm tra luồng đang được ghim tiêu điểm
  const pinnedStream = pinnedId ? allStreams.find(s => s.id === pinnedId) : null;
  const secondaryStreams = pinnedStream ? allStreams.filter(s => s.id !== pinnedId) : [];

  const { width: availW, height: availH } = dimensions;
  const gap = 16;
  const count = allStreams.length;
  const isLandscape = availW >= availH;
  const hasDimensions = availW > 0 && availH > 0;

  // ==========================================================================
  // RENDER NỘI DUNG LƯỚI BÊN TRONG WRAPPER DUY NHẤT
  // ==========================================================================
  const renderContent = () => {
    // ------------------------------------------------------------------------
    // [TRƯỜNG HỢP 0]: Không có luồng nào đang bật
    // ------------------------------------------------------------------------
    if (count === 0) {
      return (
        <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center p-6 text-center select-none animate-fade-in">
          <div className="w-20 h-20 rounded-3xl bg-dark-900 border border-white/10 flex items-center justify-center mb-5 text-slate-400 shadow-2xl">
            <Video className="w-10 h-10 text-brand-500 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-slate-100 mb-2">Chưa có luồng camera nào</h3>
          <p className="text-slate-400 text-sm max-w-md mb-6">
            Bật webcam vật lý của bạn hoặc kích hoạt camera mô phỏng từ thanh công cụ bên dưới để bắt đầu phát sóng.
          </p>
          {onOpenCamManager && (
            <button
              onClick={onOpenCamManager}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-brand-500/25"
            >
              <Sparkles className="w-4 h-4" />
              <span>Mở Hub Quản lý Camera</span>
            </button>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------------
    // [CHẾ ĐỘ TIÊU ĐIỂM (SPOTLIGHT / PIN MODE)]: Ghim 1 camera làm màn hình chính
    // ------------------------------------------------------------------------
    if (pinnedStream) {
      const pinnedRatio = getStreamRatio(pinnedStream.id, pinnedStream.stream);

      // Nếu chỉ có 1 camera duy nhất và camera đó đang được ghim
      if (secondaryStreams.length === 0) {
        const target = fitBox(availW, availH, pinnedRatio);
        return (
          <div className="flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden">
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
              onAspectRatioChange={handleAspectRatioChange}
              style={
                hasDimensions
                  ? { width: `${target.width}px`, height: `${target.height}px` }
                  : { aspectRatio: `${pinnedRatio}`, maxWidth: '100%', maxHeight: '100%' }
              }
            />
          </div>
        );
      }

      // Khi có thêm camera phụ:
      // Màn hình ngang (Desktop / Landscape): Cột chính bên trái, dải thumbnail dọc bên phải
      if (availW >= 800 && isLandscape) {
        const sidebarW = Math.min(280, Math.max(190, Math.floor(availW * 0.22)));
        const mainAvailW = availW - sidebarW - gap;
        const mainAvailH = availH;
        const mainSize = fitBox(mainAvailW, mainAvailH, pinnedRatio);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-row items-center justify-center gap-4 overflow-hidden">
            {/* Màn hình chính ghim tiêu điểm */}
            <div className="flex-1 h-full min-h-0 flex items-center justify-center">
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
                onAspectRatioChange={handleAspectRatioChange}
                style={
                  hasDimensions
                    ? { width: `${mainSize.width}px`, height: `${mainSize.height}px` }
                    : { aspectRatio: `${pinnedRatio}`, maxWidth: '100%', maxHeight: '100%' }
                }
              />
            </div>

            {/* Dải thumbnail phụ bên phải */}
            <div
              style={{ width: `${sidebarW}px` }}
              className="h-full shrink-0 flex flex-col gap-3 overflow-y-auto pr-1 py-1"
            >
              {secondaryStreams.map(item => (
                <div
                  key={item.id}
                  onClick={() => onTogglePin(item.id)}
                  title="Nhấp để chuyển tiêu điểm sang camera này"
                  className="w-full aspect-video shrink-0 rounded-2xl overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-brand-500/60 shadow-md"
                >
                  <VideoTile
                    id={item.id}
                    stream={item.stream}
                    label={item.label}
                    isLocal={item.isLocal}
                    type={item.type}
                    isMuted={item.isMuted}
                    isSpeaking={item.isSpeaking}
                    isPinned={false}
                    isThumbnail={true}
                    onTogglePin={onTogglePin}
                    onRemove={item.onRemove}
                    onAspectRatioChange={handleAspectRatioChange}
                    className="w-full h-full"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      } else {
        // Màn hình hẹp / dọc (Mobile / Portrait): Màn hình chính ở trên, dải thumbnail cuộn ngang ở dưới
        const stripH = Math.min(120, Math.max(85, Math.floor(availH * 0.2)));
        const mainAvailW = availW;
        const mainAvailH = availH - stripH - gap;
        const mainSize = fitBox(mainAvailW, mainAvailH, pinnedRatio);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-between gap-3 overflow-hidden">
            {/* Màn hình chính ghim tiêu điểm */}
            <div className="flex-1 w-full min-h-0 flex items-center justify-center">
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
                onAspectRatioChange={handleAspectRatioChange}
                style={
                  hasDimensions
                    ? { width: `${mainSize.width}px`, height: `${mainSize.height}px` }
                    : { aspectRatio: `${pinnedRatio}`, maxWidth: '100%', maxHeight: '100%' }
                }
              />
            </div>

            {/* Dải thumbnail cuộn ngang bên dưới */}
            <div
              style={{ height: `${stripH}px` }}
              className="w-full shrink-0 flex flex-row items-center justify-center gap-2.5 overflow-x-auto py-1"
            >
              {secondaryStreams.map(item => (
                <div
                  key={item.id}
                  onClick={() => onTogglePin(item.id)}
                  title="Nhấp để chuyển tiêu điểm"
                  className="h-full aspect-video shrink-0 rounded-xl overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-brand-500/60 shadow-md"
                >
                  <VideoTile
                    id={item.id}
                    stream={item.stream}
                    label={item.label}
                    isLocal={item.isLocal}
                    type={item.type}
                    isMuted={item.isMuted}
                    isSpeaking={item.isSpeaking}
                    isPinned={false}
                    isThumbnail={true}
                    onTogglePin={onTogglePin}
                    onRemove={item.onRemove}
                    onAspectRatioChange={handleAspectRatioChange}
                    className="w-full h-full"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      }
    }

    // ------------------------------------------------------------------------
    // [1 VIDEO]: Căn giữa tuyệt đối, tối đa hóa trong viewport, chuẩn 16:9 / 4:3
    // ------------------------------------------------------------------------
    if (count === 1) {
      const single = allStreams[0];
      const singleRatio = getStreamRatio(single.id, single.stream);
      const target = fitBox(availW, availH, singleRatio);

      return (
        <div className="flex-1 w-full h-full min-h-0 flex items-center justify-center overflow-hidden">
          <VideoTile
            key={single.id}
            id={single.id}
            stream={single.stream}
            label={single.label}
            isLocal={single.isLocal}
            type={single.type}
            isMuted={single.isMuted}
            isSpeaking={single.isSpeaking}
            isPinned={false}
            onTogglePin={onTogglePin}
            onRemove={single.onRemove}
            onAspectRatioChange={handleAspectRatioChange}
            style={
              hasDimensions
                ? { width: `${target.width}px`, height: `${target.height}px` }
                : { aspectRatio: `${singleRatio}`, maxWidth: '100%', maxHeight: '100%' }
            }
          />
        </div>
      );
    }

    // ------------------------------------------------------------------------
    // [2 VIDEO]: Side-by-side (2 cột) trên landscape hoặc Stacked (2 hàng) trên portrait
    // ------------------------------------------------------------------------
    if (count === 2) {
      const useSideBySide = isLandscape;
      const target = useSideBySide
        ? fitBox((availW - gap) / 2, availH, 16 / 9)
        : fitBox(availW, (availH - gap) / 2, 16 / 9);

      return (
        <div
          className={`flex-1 w-full h-full min-h-0 flex items-center justify-center gap-3 sm:gap-4 overflow-hidden ${
            useSideBySide ? 'flex-row' : 'flex-col'
          }`}
        >
          {allStreams.map(item => (
            <div
              key={item.id}
              style={
                hasDimensions
                  ? { width: `${target.width}px`, height: `${target.height}px` }
                  : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
              }
              className="shrink-0 flex items-center justify-center"
            >
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
                onAspectRatioChange={handleAspectRatioChange}
                className="w-full h-full"
              />
            </div>
          ))}
        </div>
      );
    }

    // ------------------------------------------------------------------------
    // [3-4 VIDEO]: Lưới cân bằng 2x2 vừa khít trong viewport, không cuộn dọc
    // (Đối với 3 video trên màn dọc, tự động xếp dọc nếu cho kích thước lớn hơn)
    // ------------------------------------------------------------------------
    if (count === 3 || count === 4) {
      // Kiểm tra xem trên mobile portrait thì xếp 1 cột 3 hàng có lớn hơn 2 cột không
      const isMobilePortrait = !isLandscape && count === 3;
      const stack3Target = isMobilePortrait ? fitBox(availW, (availH - gap * 2) / 3, 16 / 9) : null;
      const grid2x2Target = fitBox((availW - gap) / 2, (availH - gap) / 2, 16 / 9);

      const useStack3 = isMobilePortrait && stack3Target && (stack3Target.width * stack3Target.height > grid2x2Target.width * grid2x2Target.height);

      if (useStack3 && stack3Target) {
        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-2.5 overflow-hidden">
            {allStreams.map(item => (
              <div
                key={item.id}
                style={
                  hasDimensions
                    ? { width: `${stack3Target.width}px`, height: `${stack3Target.height}px` }
                    : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
                }
                className="shrink-0 flex items-center justify-center"
              >
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
                  onAspectRatioChange={handleAspectRatioChange}
                  className="w-full h-full"
                />
              </div>
            ))}
          </div>
        );
      }

      // Chuẩn 2x2: Hàng 1 (2 video), Hàng 2 (1 hoặc 2 video căn giữa)
      const target = grid2x2Target;
      const row1 = allStreams.slice(0, 2);
      const row2 = allStreams.slice(2, count);

      return (
        <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-3 sm:gap-4 overflow-hidden">
          {/* Hàng 1 (2 video) */}
          <div className="flex flex-row items-center justify-center gap-3 sm:gap-4 w-full">
            {row1.map(item => (
              <div
                key={item.id}
                style={
                  hasDimensions
                    ? { width: `${target.width}px`, height: `${target.height}px` }
                    : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
                }
                className="shrink-0 flex items-center justify-center"
              >
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
                  onAspectRatioChange={handleAspectRatioChange}
                  className="w-full h-full"
                />
              </div>
            ))}
          </div>

          {/* Hàng 2 (1 hoặc 2 video căn giữa, kích thước hoàn toàn đồng nhất) */}
          <div className="flex flex-row items-center justify-center gap-3 sm:gap-4 w-full">
            {row2.map(item => (
              <div
                key={item.id}
                style={
                  hasDimensions
                    ? { width: `${target.width}px`, height: `${target.height}px` }
                    : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
                }
                className="shrink-0 flex items-center justify-center"
              >
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
                  onAspectRatioChange={handleAspectRatioChange}
                  className="w-full h-full"
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ------------------------------------------------------------------------
    // [5-6 VIDEO]: Lưới 3x2 (hoặc 2x3 trên màn dọc) vừa vặn khung nhìn
    // ------------------------------------------------------------------------
    if (count === 5 || count === 6) {
      if (isLandscape) {
        // 3 cột, 2 hàng
        const target = fitBox((availW - gap * 2) / 3, (availH - gap) / 2, 16 / 9);
        const row1 = allStreams.slice(0, 3);
        const row2 = allStreams.slice(3, count);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-3 sm:gap-4 overflow-hidden">
            {/* Hàng 1 (3 video) */}
            <div className="flex flex-row items-center justify-center gap-3 sm:gap-4 w-full">
              {row1.map(item => (
                <div
                  key={item.id}
                  style={
                    hasDimensions
                      ? { width: `${target.width}px`, height: `${target.height}px` }
                      : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
                  }
                  className="shrink-0 flex items-center justify-center"
                >
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
                    onAspectRatioChange={handleAspectRatioChange}
                    className="w-full h-full"
                  />
                </div>
              ))}
            </div>

            {/* Hàng 2 (2 hoặc 3 video căn giữa) */}
            <div className="flex flex-row items-center justify-center gap-3 sm:gap-4 w-full">
              {row2.map(item => (
                <div
                  key={item.id}
                  style={
                    hasDimensions
                      ? { width: `${target.width}px`, height: `${target.height}px` }
                      : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
                  }
                  className="shrink-0 flex items-center justify-center"
                >
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
                    onAspectRatioChange={handleAspectRatioChange}
                    className="w-full h-full"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      } else {
        // Màn hình dọc: 2 cột, 3 hàng
        const target = fitBox((availW - gap) / 2, (availH - gap * 2) / 3, 16 / 9);

        return (
          <div className="flex-1 w-full h-full min-h-0 flex flex-col items-center justify-center gap-2.5 overflow-hidden">
            {[0, 2, 4].map(startIdx => {
              const rowItems = allStreams.slice(startIdx, Math.min(startIdx + 2, count));
              if (rowItems.length === 0) return null;
              return (
                <div key={startIdx} className="flex flex-row items-center justify-center gap-2.5 w-full">
                  {rowItems.map(item => (
                    <div
                      key={item.id}
                      style={
                        hasDimensions
                          ? { width: `${target.width}px`, height: `${target.height}px` }
                          : { aspectRatio: '16/9', maxWidth: '100%', maxHeight: '100%' }
                      }
                      className="shrink-0 flex items-center justify-center"
                    >
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
                        onAspectRatioChange={handleAspectRatioChange}
                        className="w-full h-full"
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      }
    }

    // ------------------------------------------------------------------------
    // [7+ VIDEO]: Lưới nhiều camera cuộn mượt mà
    // ------------------------------------------------------------------------
    return (
      <div className="flex-1 w-full h-full min-h-0 overflow-y-auto flex items-center justify-center py-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 w-full max-w-7xl mx-auto py-2">
          {allStreams.map(item => (
            <div key={item.id} className="w-full aspect-video rounded-2xl overflow-hidden shadow-md">
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
                onAspectRatioChange={handleAspectRatioChange}
                className="w-full h-full"
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ==========================================================================
  // KHUNG BAO NGOÀI DUY NHẤT (PERSISTENT WRAPPER CONTAINER)
  // Giữ vững containerRef không bao giờ bị unmount khi số lượng camera thay đổi
  // ==========================================================================
  return (
    <div
      ref={containerRef}
      className="flex-1 w-full h-full min-h-0 relative overflow-hidden flex flex-col items-center justify-center p-3 sm:p-5 select-none bg-dark-950"
    >
      {renderContent()}

      {/* Thông báo thanh lịch khi đối phương chưa vào phòng (hiển thị khi có luồng phát) */}
      {!peerConnected && count > 0 && (
        <div className="absolute top-4 sm:top-5 z-20 flex items-center gap-2.5 px-4 py-2 rounded-full glass-pill border border-brand-500/30 text-xs text-slate-200 shadow-2xl animate-fade-in pointer-events-auto">
          <UserPlus className="w-4 h-4 text-brand-400 animate-pulse" />
          <span className="font-medium">Đang chờ đối phương tham gia...</span>
          {roomId && (
            <span className="text-[11px] font-mono font-bold text-slate-300 px-2 py-0.5 rounded bg-white/5">
              {roomId}
            </span>
          )}
          {onShareRoom && (
            <button
              onClick={onShareRoom}
              className="px-2.5 py-1 rounded-full bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold text-[11px] transition-all ml-1 shadow-md shadow-brand-500/20"
            >
              Sao chép link mời
            </button>
          )}
        </div>
      )}
    </div>
  );
};
