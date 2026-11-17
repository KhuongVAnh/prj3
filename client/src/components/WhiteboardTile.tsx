/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - SHARED WHITEBOARD TILE (BẢNG TRẮNG TƯƠNG TÁC)
 * ============================================================================
 * Hiển thị như một khung tương tác ngang hàng với các luồng camera trong VideoGrid:
 *  - Hỗ trợ ghim tiêu điểm (Spotlight Pin) hoặc xem ở dạng lưới / thumbnail.
 *  - Chỉ 1 trong 2 người được bật/tắt bảng, nhưng CẢ 2 người đều vẽ song song được.
 *  - Chuẩn hóa tọa độ (0..1) trên không gian logic 16:9 (1920x1080) giúp nét vẽ
 *    khớp chính xác tuyệt đối bất kể kích thước màn hình hay chế độ phóng to/thu nhỏ.
 *  - Tẩy sử dụng lớp mực trong suốt (destination-out) để không xóa mất nền kẻ ô.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  PenTool,
  Eraser,
  Undo2,
  Trash2,
  Grid3X3,
  Download,
  Pin,
  PinOff,
  Maximize2,
  Minimize2,
  X
} from 'lucide-react';
import {
  WhiteboardLiveDraw,
  WhiteboardPoint,
  WhiteboardStroke,
  WhiteboardTool
} from '../types';

const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;

const PEN_COLORS = [
  { name: 'Đen', value: '#0f172a' },
  { name: 'Đỏ', value: '#ef4444' },
  { name: 'Xanh dương', value: '#2563eb' },
  { name: 'Xanh lá', value: '#16a34a' }
];

const STROKE_SIZES = [
  { label: 'Mảnh', value: 0.0022, dotClass: 'w-1.5 h-1.5' },
  { label: 'Vừa', value: 0.0042, dotClass: 'w-2.5 h-2.5' },
  { label: 'Đậm', value: 0.0082, dotClass: 'w-3.5 h-3.5' }
];

export interface WhiteboardTileProps {
  roomId?: string;
  strokes: WhiteboardStroke[];
  showGrid: boolean;
  ownerName: string | null;
  isOwner: boolean;
  isPinned?: boolean;
  isThumbnail?: boolean;
  onTogglePin?: (id: string) => void;
  onCloseWhiteboard?: () => void;
  onLiveDraw: (payload: {
    strokeId: string;
    tool: WhiteboardTool;
    color: string;
    size: number;
    points: WhiteboardPoint[];
  }) => void;
  onCommitStroke: (stroke: Omit<WhiteboardStroke, 'authorId' | 'authorName'>) => void;
  onUndo: () => void;
  onClear: () => void;
  onToggleGrid: () => void;
  registerLiveHandler: (handler: ((draw: WhiteboardLiveDraw) => void) | null) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Vẽ một nét mượt mà bằng đường cong bậc 2 (Quadratic Bezier) lên Canvas 1920x1080
 */
function renderStrokeOnContext(
  ctx: CanvasRenderingContext2D,
  tool: WhiteboardTool,
  color: string,
  size: number,
  points: WhiteboardPoint[]
) {
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = Math.max(8, size * LOGICAL_WIDTH * 3.4);
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, size * LOGICAL_WIDTH);
  }

  if (points.length === 1) {
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x * LOGICAL_WIDTH, p.y * LOGICAL_HEIGHT, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x * LOGICAL_WIDTH, points[0].y * LOGICAL_HEIGHT);

  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = ((curr.x + next.x) / 2) * LOGICAL_WIDTH;
    const midY = ((curr.y + next.y) / 2) * LOGICAL_HEIGHT;
    ctx.quadraticCurveTo(curr.x * LOGICAL_WIDTH, curr.y * LOGICAL_HEIGHT, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x * LOGICAL_WIDTH, last.y * LOGICAL_HEIGHT);
  ctx.stroke();
  ctx.restore();
}

export const WhiteboardTile: React.FC<WhiteboardTileProps> = ({
  roomId,
  strokes,
  showGrid,
  ownerName,
  isOwner,
  isPinned = false,
  isThumbnail = false,
  onTogglePin,
  onCloseWhiteboard,
  onLiveDraw,
  onCommitStroke,
  onUndo,
  onClear,
  onToggleGrid,
  registerLiveHandler,
  className = '',
  style
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState<string>(PEN_COLORS[0].value);
  const [size, setSize] = useState<number>(STROKE_SIZES[1].value);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Tham chiếu phục vụ vẽ tức thời 60fps không gây re-render React
  const activeStrokeRef = useRef<{
    id: string;
    tool: WhiteboardTool;
    color: string;
    size: number;
    points: WhiteboardPoint[];
    unsentPoints: WhiteboardPoint[];
    lastEmitAt: number;
  } | null>(null);

  const remoteLiveStrokesRef = useRef<Map<string, WhiteboardLiveDraw>>(new Map());

  /**
   * Vẽ lại toàn bộ các nét đã lưu + các nét đang vẽ dở
   */
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    for (const s of strokes) {
      renderStrokeOnContext(ctx, s.tool, s.color, s.size, s.points);
    }

    // Vẽ thêm các nét live từ đối phương chưa kịp commit
    remoteLiveStrokesRef.current.forEach(live => {
      renderStrokeOnContext(ctx, live.tool, live.color, live.size, live.points);
    });

    // Vẽ nét hiện tại của chính máy mình (nếu đang giữ bút)
    if (activeStrokeRef.current) {
      const a = activeStrokeRef.current;
      renderStrokeOnContext(ctx, a.tool, a.color, a.size, a.points);
    }
  }, [strokes]);

  useEffect(() => {
    // Khi danh sách strokes đã commit cập nhật, dọn các nét live đã commit xong
    const committedIds = new Set(strokes.map(s => s.id));
    remoteLiveStrokesRef.current.forEach((_, strokeId) => {
      if (committedIds.has(strokeId)) {
        remoteLiveStrokesRef.current.delete(strokeId);
      }
    });
    redrawCanvas();
  }, [strokes, redrawCanvas]);

  // Đăng ký lắng nghe nét vẽ thời gian thực từ đối phương
  useEffect(() => {
    const handleRemoteLive = (draw: WhiteboardLiveDraw) => {
      const existing = remoteLiveStrokesRef.current.get(draw.strokeId);
      if (existing) {
        existing.points.push(...draw.points);
      } else {
        remoteLiveStrokesRef.current.set(draw.strokeId, {
          ...draw,
          points: [...draw.points]
        });
      }

      // Vẽ ngay đoạn mới lên canvas để người xem thấy mượt theo từng chuyển động bút
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const live = remoteLiveStrokesRef.current.get(draw.strokeId);
      if (ctx && live) {
        // Vẽ lại toàn bộ đoạn live của stroke đó để đảm bảo đường cong liên tục
        const tail = live.points.slice(-Math.max(draw.points.length + 2, 3));
        renderStrokeOnContext(ctx, live.tool, live.color, live.size, tail);
      }
    };

    registerLiveHandler(handleRemoteLive);
    return () => registerLiveHandler(null);
  }, [registerLiveHandler]);

  // Theo dõi trạng thái Fullscreen
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

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): WhiteboardPoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isThumbnail || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const pt = getNormalizedPoint(e);
    const strokeId = `wb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    activeStrokeRef.current = {
      id: strokeId,
      tool,
      color,
      size,
      points: [pt],
      unsentPoints: [pt],
      lastEmitAt: performance.now()
    };

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      renderStrokeOnContext(ctx, tool, color, size, [pt]);
    }
    onLiveDraw({ strokeId, tool, color, size, points: [pt] });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isThumbnail || !activeStrokeRef.current) return;
    e.stopPropagation();

    const active = activeStrokeRef.current;
    const pt = getNormalizedPoint(e);
    const prev = active.points[active.points.length - 1];

    // Lọc bớt các điểm quá sát nhau để giảm nhiễu và tiết kiệm băng thông
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.0015) {
      return;
    }

    active.points.push(pt);
    active.unsentPoints.push(pt);

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      const tail = active.points.slice(-3);
      renderStrokeOnContext(ctx, active.tool, active.color, active.size, tail);
    }

    const now = performance.now();
    if (now - active.lastEmitAt >= 24 && active.unsentPoints.length > 0) {
      onLiveDraw({
        strokeId: active.id,
        tool: active.tool,
        color: active.color,
        size: active.size,
        points: active.unsentPoints
      });
      active.unsentPoints = [];
      active.lastEmitAt = now;
    }
  };

  const finishActiveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeStrokeRef.current) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}

    const finished = activeStrokeRef.current;
    activeStrokeRef.current = null;

    if (finished.unsentPoints.length > 0) {
      onLiveDraw({
        strokeId: finished.id,
        tool: finished.tool,
        color: finished.color,
        size: finished.size,
        points: finished.unsentPoints
      });
    }

    onCommitStroke({
      id: finished.id,
      tool: finished.tool,
      color: finished.color,
      size: finished.size,
      points: finished.points
    });
  };

  const handleDownloadPng = (e: React.MouseEvent) => {
    e.stopPropagation();
    const inkCanvas = canvasRef.current;
    if (!inkCanvas) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = LOGICAL_WIDTH;
    exportCanvas.height = LOGICAL_HEIGHT;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // 1. Nền trắng
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // 2. Kẻ ô ly nếu đang bật
    if (showGrid) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      const step = 48;
      for (let x = 0; x <= LOGICAL_WIDTH; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, LOGICAL_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y <= LOGICAL_HEIGHT; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(LOGICAL_WIDTH, y);
        ctx.stroke();
      }
    }

    // 3. Chồng lớp nét vẽ lên trên
    ctx.drawImage(inkCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = `whiteboard-${roomId || 'omnicam'}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div
      ref={containerRef}
      style={style}
      className={`group relative overflow-hidden rounded-2xl bg-white border select-none flex items-center justify-center transition-[border-color,box-shadow] duration-200 ${
        isPinned
          ? 'border-brand-500/90 shadow-lg shadow-brand-500/15'
          : 'border-white/20 hover:border-brand-400/50 shadow-xl'
      } ${className}`}
    >
      {/* Lớp nền kẻ ô ly (CSS tách biệt để tẩy mực không làm mất ô kẻ) */}
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.22) 1px, transparent 1px)',
            backgroundSize: isThumbnail ? '12px 12px' : '28px 28px'
          }}
        />
      )}

      {/* Lớp Canvas vẽ tương tác độ phân giải logic 1920x1080 */}
      <canvas
        ref={canvasRef}
        width={LOGICAL_WIDTH}
        height={LOGICAL_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishActiveStroke}
        onPointerCancel={finishActiveStroke}
        className={`relative z-10 w-full h-full touch-none ${
          isThumbnail
            ? 'pointer-events-none'
            : tool === 'eraser'
            ? 'cursor-cell'
            : 'cursor-crosshair'
        }`}
      />

      {isThumbnail ? (
        <>
          {/* Header gọn trong chế độ thumbnail */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-20 gap-1.5">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-dark-950/85 backdrop-blur-md border border-white/15 text-[11px] font-medium text-slate-100 pointer-events-auto shadow-sm max-w-[calc(100%-28px)]">
              <PenTool className="w-3 h-3 text-brand-400 shrink-0" />
              <span className="truncate">Bảng trắng</span>
            </div>
            {isOwner && onCloseWhiteboard && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseWhiteboard();
                }}
                title="Tắt bảng trắng"
                className="p-1 rounded-md bg-rose-500/90 hover:bg-rose-600 text-white transition-all pointer-events-auto shadow-sm"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-full bg-dark-950/85 text-[9px] font-mono text-brand-400 pointer-events-none z-20">
            Click để ghim
          </div>
        </>
      ) : (
        <>
          {/* Thanh tiêu đề trên cùng */}
          <div className="absolute top-2.5 sm:top-3 left-2.5 sm:left-3 right-2.5 sm:right-3 flex items-center justify-between pointer-events-none z-20 gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-dark-950/85 backdrop-blur-md border border-white/15 text-xs font-medium text-slate-100 pointer-events-auto shadow-md">
              <PenTool className="w-3.5 h-3.5 text-brand-400 shrink-0" />
              <span className="font-semibold">Bảng trắng</span>
              <span className="text-[10px] text-slate-300 font-mono px-1.5 py-0.5 rounded bg-white/10 hidden sm:inline-block">
                {isOwner ? 'Bạn mở' : `Mở bởi ${ownerName || 'Đối phương'}`}
              </span>
            </div>

            <div className="flex items-center gap-1 pointer-events-auto shrink-0">
              {onTogglePin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin('whiteboard');
                  }}
                  title={isPinned ? 'Bỏ ghim (Unpin)' : 'Ghim phóng to bảng trắng'}
                  className={`p-1.5 rounded-lg backdrop-blur-md transition-all text-xs shadow-sm ${
                    isPinned
                      ? 'bg-brand-500 text-slate-950 font-bold'
                      : 'bg-dark-950/80 border border-white/15 text-slate-200 hover:bg-dark-900'
                  }`}
                >
                  {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              )}

              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
                className="p-1.5 rounded-lg bg-dark-950/80 border border-white/15 text-slate-200 hover:bg-dark-900 backdrop-blur-md transition-all text-xs shadow-sm"
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              {isOwner && onCloseWhiteboard && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWhiteboard();
                  }}
                  title="Tắt bảng trắng"
                  className="p-1.5 rounded-lg bg-rose-500/90 hover:bg-rose-600 text-white transition-all text-xs shadow-sm"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Thanh công cụ vẽ nổi phía dưới */}
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-2.5 sm:bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-1 sm:gap-1.5 px-2.5 py-1.5 rounded-2xl bg-dark-950/90 backdrop-blur-md border border-white/15 shadow-2xl max-w-[95%]"
          >
            {/* Chọn màu bút */}
            <div className="flex items-center gap-1 pr-1 border-r border-white/15">
              {PEN_COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  title={`Bút màu ${c.name}`}
                  onClick={() => {
                    setTool('pen');
                    setColor(c.value);
                  }}
                  className={`w-5 h-5 rounded-full border-2 transition-transform ${
                    tool === 'pen' && color === c.value
                      ? 'border-white scale-110 ring-2 ring-brand-400/60'
                      : 'border-white/30 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>

            {/* Tẩy */}
            <button
              type="button"
              title="Tẩy"
              onClick={() => setTool('eraser')}
              className={`p-1.5 rounded-lg transition-all ${
                tool === 'eraser'
                  ? 'bg-brand-500 text-slate-950 font-bold'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>

            {/* Độ dày nét */}
            <div className="flex items-center gap-1 px-1 border-x border-white/15">
              {STROKE_SIZES.map(s => (
                <button
                  key={s.label}
                  type="button"
                  title={`Nét ${s.label}`}
                  onClick={() => setSize(s.value)}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                    size === s.value
                      ? 'bg-white/20 text-white ring-1 ring-brand-400'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span className={`rounded-full bg-current ${s.dotClass}`} />
                </button>
              ))}
            </div>

            {/* Hoàn tác nét của mình */}
            <button
              type="button"
              title="Hoàn tác nét vẽ gần nhất của bạn"
              onClick={onUndo}
              className="p-1.5 rounded-lg text-slate-200 hover:bg-white/10 transition-all"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>

            {/* Nền kẻ ô */}
            <button
              type="button"
              title={showGrid ? 'Ẩn kẻ ô' : 'Hiện nền kẻ ô ly'}
              onClick={onToggleGrid}
              className={`p-1.5 rounded-lg transition-all ${
                showGrid
                  ? 'bg-sky-500/25 text-sky-300 border border-sky-500/40'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
            </button>

            {/* Xóa sạch */}
            <button
              type="button"
              title="Xóa toàn bộ bảng trắng"
              onClick={onClear}
              className="p-1.5 rounded-lg text-rose-300 hover:bg-rose-500/20 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Tải ảnh PNG */}
            <button
              type="button"
              title="Tải bảng trắng về dạng ảnh PNG"
              onClick={handleDownloadPng}
              className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/20 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};
