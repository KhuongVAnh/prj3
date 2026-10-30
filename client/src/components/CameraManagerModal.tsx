/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - MULTI-CAMERA HUB MODAL (QUẢN LÝ ĐA CAMERA)
 * ============================================================================
 * Bảng điều khiển quản lý toàn bộ các nguồn cấp video của người dùng:
 *  1. LIỆT KÊ CAMERA PHẦN CỨNG:
 *     - Quét danh sách thiết bị videoinput từ navigator.mediaDevices.enumerateDevices().
 *     - Nhận diện các webcam cắm ngoài, camera tích hợp hoặc camera ảo từ driver.
 *     - Xử lý trạng thái tải (Loading state) và thông báo lỗi xung đột băng thông USB (NotReadableError).
 *  2. KHỞI TẠO CAMERA MÔ PHỎNG (VIRTUAL STUDIO):
 *     - Cho phép bật 3 luồng video đồ họa (SMPTE Clock, Blueprint, Radar) sinh từ Canvas.
 *  3. CHIA SẺ MÀN HÌNH (SCREEN SHARING):
 *     - Bật luồng getDisplayMedia() hoạt động như một góc camera độc lập.
 */

import React, { useState } from 'react';
import { CameraSource } from '../types';
import {
  X,
  Camera,
  Sparkles,
  Monitor,
  RefreshCw,
  Clock,
  Compass,
  Radar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  AlertTriangle
} from 'lucide-react';

interface CameraManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableDevices: MediaDeviceInfo[];
  activeCameras: CameraSource[];
  onTogglePhysicalCamera: (deviceId: string) => Promise<void>;
  onToggleVirtualCamera: (pattern: 'clock' | 'blueprint' | 'radar') => void;
  onToggleScreenShare: () => Promise<void>;
  onRefreshDevices: () => Promise<MediaDeviceInfo[]>;
}

export const CameraManagerModal: React.FC<CameraManagerModalProps> = ({
  isOpen,
  onClose,
  availableDevices,
  activeCameras,
  onTogglePhysicalCamera,
  onToggleVirtualCamera,
  onToggleScreenShare,
  onRefreshDevices
}) => {
  const [loadingDeviceId, setLoadingDeviceId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<{ deviceId: string; message: string; details?: string } | null>(null);

  if (!isOpen) return null;

  // Kiểm tra xem camera vật lý có đang hoạt động hay không
  const isPhysicalActive = (deviceId: string) => {
    return activeCameras.some(c => c.deviceId === deviceId || c.id === `physical-${deviceId}`);
  };

  // Kiểm tra xem camera ảo có đang hoạt động hay không
  const isVirtualActive = (pattern: string) => {
    return activeCameras.some(c => c.id === `virtual-${pattern}`);
  };

  // Kiểm tra trạng thái chia sẻ màn hình
  const isScreenShareActive = activeCameras.some(c => c.type === 'screen');

  // Xử lý bật/tắt camera vật lý và bắt lỗi phần cứng USB (NotReadableError)
  const handleTogglePhysical = async (deviceId: string) => {
    try {
      setLoadingDeviceId(deviceId);
      setCameraError(null);
      await onTogglePhysicalCamera(deviceId);
    } catch (err: any) {
      console.error('[CameraManagerModal] Lỗi khi bật/tắt camera:', err);
      let message = 'Không thể bật camera này.';
      let details = err?.message || '';

      if (err?.name === 'NotReadableError' || details.includes('Could not start video source') || details.includes('xung đột phần cứng')) {
        message = 'Xung đột phần cứng USB hoặc camera đang bị ứng dụng khác chiếm (NotReadableError).';
        details = 'Nguyên nhân phổ biến: 1. Hai camera cùng dùng chip USB Sonix làm nghẽn băng thông USB 2.0; 2. Camera đang mở trong ứng dụng khác (Zoom, Teams, Zalo, Windows Camera). Giải pháp: Cắm camera USB sang cổng USB 3.0 (màu xanh), hoặc dùng Camera ảo bên dưới.';
      } else if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        message = 'Quyền truy cập camera bị từ chối.';
        details = 'Vui lòng kiểm tra cài đặt quyền camera trên trình duyệt.';
      } else if (err?.name === 'OverconstrainedError') {
        message = 'Camera không hỗ trợ độ phân giải yêu cầu (OverconstrainedError).';
        details = 'Camera phần cứng không đáp ứng thông số phân giải/khung hình.';
      }

      setCameraError({ deviceId, message, details });
    } finally {
      setLoadingDeviceId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl bg-dark-900 border border-white/10 shadow-2xl overflow-hidden animate-scale-in">
        {/* Tiêu đề modal (Header) */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-dark-850/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Hub Quản lý Đa Camera
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 font-mono font-medium border border-brand-500/30">
                  {activeCameras.length} Đang phát
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Bật cùng lúc nhiều nguồn video. Tất cả các luồng sẽ được truyền song song sang máy đối phương.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nội dung danh sách camera (Body) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Thông báo lỗi phần cứng USB nếu có */}
          {cameraError && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs animate-fade-in space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{cameraError.message}</span>
                </div>
                <button
                  onClick={() => setCameraError(null)}
                  className="p-1 rounded text-rose-400 hover:bg-rose-500/20"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {cameraError.details && (
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  {cameraError.details}
                </p>
              )}
            </div>
          )}

          {/* Phần 1: Camera phần cứng vật lý */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-brand-400" />
                Webcam Phần Cứng ({availableDevices.length})
              </span>
              <button
                onClick={() => onRefreshDevices()}
                className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Quét lại thiết bị</span>
              </button>
            </div>

            {availableDevices.length === 0 ? (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-slate-400 mb-2">Chưa phát hiện webcam phần cứng nào.</p>
                <p className="text-xs text-slate-500">
                  Bạn có thể sử dụng các Camera ảo mô phỏng bên dưới để thử nghiệm tính năng phát đa luồng ngay lập tức!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {availableDevices.map((dev, idx) => {
                  const active = isPhysicalActive(dev.deviceId);
                  const isLoading = loadingDeviceId === dev.deviceId;
                  return (
                    <div
                      key={dev.deviceId || idx}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                        active
                          ? 'bg-brand-500/10 border-brand-500/30 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]'
                          : 'bg-dark-850/50 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                            active ? 'bg-brand-500 text-slate-950 font-bold' : 'bg-white/5 text-slate-400'
                          }`}
                        >
                          <Camera className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                            {dev.label || `Thiết bị Camera ${idx + 1}`}
                            {active && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-brand-400">
                                <CheckCircle2 className="w-3 h-3" /> ĐANG PHÁT (ON AIR)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono truncate max-w-xs">
                            ID: {dev.deviceId ? `${dev.deviceId.slice(0, 18)}...` : 'Default System Video'}
                          </div>
                        </div>
                      </div>

                      <button
                        disabled={isLoading}
                        onClick={() => handleTogglePhysical(dev.deviceId)}
                        className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                          isLoading
                            ? 'bg-white/10 text-slate-400 cursor-not-allowed'
                            : active
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                            : 'bg-brand-500 hover:bg-brand-600 text-slate-950 shadow-md shadow-brand-500/20'
                        }`}
                      >
                        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{isLoading ? 'Đang bật...' : active ? 'Tắt camera' : 'Bật camera'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {availableDevices.length === 1 && (
              <div className="mt-3 flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300/90 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>Mẹo:</strong> Máy của bạn chỉ có 1 webcam vật lý. Bạn có thể bật thêm các <strong>Camera ảo mô phỏng</strong> bên dưới để trải nghiệm truyền nhiều góc camera cùng lúc!
                </span>
              </div>
            )}
          </div>

          {/* Phần 2: Các nguồn Camera Ảo mô phỏng (Virtual Simulated Cameras) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Camera Mô Phỏng Ảo (Mở nhanh nhiều góc camera)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Mẫu 1: Studio SMPTE Clock */}
              <div
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isVirtualActive('clock')
                    ? 'bg-brand-500/10 border-brand-500/30 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]'
                    : 'bg-dark-850/50 border-white/5 hover:border-white/10'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <Clock className="w-4 h-4" />
                    </div>
                    {isVirtualActive('clock') && (
                      <span className="text-[10px] font-mono text-brand-400 bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 rounded-full">
                        ĐANG PHÁT
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">Đồng hồ Studio SMPTE</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-3">
                    Đồng hồ kỹ thuật số chuẩn phòng thu hiển thị mili-giây, dải màu truyền hình và sóng âm dao động.
                  </p>
                </div>
                <button
                  onClick={() => onToggleVirtualCamera('clock')}
                  className={`w-full py-2 rounded-xl text-xs font-semibold transition-all ${
                    isVirtualActive('clock')
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200'
                  }`}
                >
                  {isVirtualActive('clock') ? 'Dừng phát' : 'Bật luồng này'}
                </button>
              </div>

              {/* Mẫu 2: Blueprint / Desk Simulator */}
              <div
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isVirtualActive('blueprint')
                    ? 'bg-sky-500/10 border-sky-500/30 shadow-[0_0_15px_-3px_rgba(56,189,248,0.2)]'
                    : 'bg-dark-850/50 border-white/5 hover:border-white/10'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                      <Compass className="w-4 h-4" />
                    </div>
                    {isVirtualActive('blueprint') && (
                      <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">
                        ĐANG PHÁT
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">Bản Vẽ Bàn Làm Việc (CAD)</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-3">
                    Mô phỏng camera tài liệu chiếu bàn với lưới CAD, la bàn đo góc xoay liên tục và tọa độ.
                  </p>
                </div>
                <button
                  onClick={() => onToggleVirtualCamera('blueprint')}
                  className={`w-full py-2 rounded-xl text-xs font-semibold transition-all ${
                    isVirtualActive('blueprint')
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200'
                  }`}
                >
                  {isVirtualActive('blueprint') ? 'Dừng phát' : 'Bật luồng này'}
                </button>
              </div>

              {/* Mẫu 3: Radar Scanner */}
              <div
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isVirtualActive('radar')
                    ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]'
                    : 'bg-dark-850/50 border-white/5 hover:border-white/10'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <Radar className="w-4 h-4" />
                    </div>
                    {isVirtualActive('radar') && (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        ĐANG PHÁT
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">Radar Quét Cảm Biến</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-3">
                    Mô phỏng radar quét 360 độ phát hiện mục tiêu và hiển thị thông số viễn trắc tọa độ.
                  </p>
                </div>
                <button
                  onClick={() => onToggleVirtualCamera('radar')}
                  className={`w-full py-2 rounded-xl text-xs font-semibold transition-all ${
                    isVirtualActive('radar')
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200'
                  }`}
                >
                  {isVirtualActive('radar') ? 'Dừng phát' : 'Bật luồng này'}
                </button>
              </div>

              {/* Chia sẻ màn hình như một góc camera */}
              <div
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isScreenShareActive
                    ? 'bg-indigo-500/10 border-indigo-500/30 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]'
                    : 'bg-dark-850/50 border-white/5 hover:border-white/10'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <Monitor className="w-4 h-4" />
                    </div>
                    {isScreenShareActive && (
                      <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                        ĐANG PHÁT
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">Chia Sẻ Màn Hình</h4>
                  <p className="text-xs text-slate-400 mt-1 mb-3">
                    Chia sẻ cửa sổ, tab trình duyệt hoặc toàn bộ màn hình desktop như một kênh video riêng.
                  </p>
                </div>
                <button
                  onClick={() => onToggleScreenShare()}
                  className={`w-full py-2 rounded-xl text-xs font-semibold transition-all ${
                    isScreenShareActive
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200'
                  }`}
                >
                  {isScreenShareActive ? 'Dừng chia sẻ' : 'Bật chia sẻ màn hình'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Chân trang modal (Footer) */}
        <div className="px-6 py-4 border-t border-white/10 bg-dark-850/80 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Các luồng video tự động cập nhật qua cơ chế tái đàm phán WebRTC mà không làm gián đoạn cuộc gọi.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-semibold transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
