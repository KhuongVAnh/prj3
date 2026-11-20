/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - MULTI-CAMERA HUB MODAL (QUẢN LÝ ĐA CAMERA)
 * ============================================================================
 * Bảng điều khiển quản lý toàn bộ các nguồn cấp video của người dùng:
 *  1. LIỆT KÊ CAMERA PHẦN CỨNG:
 *     - Quét danh sách thiết bị videoinput từ navigator.mediaDevices.enumerateDevices().
 *     - Xử lý trạng thái tải và thông báo lỗi xung đột băng thông USB (NotReadableError).
 *  2. CHIA SẺ MÀN HÌNH (SCREEN SHARING):
 *     - Bật luồng getDisplayMedia() hoạt động như một góc camera độc lập.
 */

import React, { useState } from 'react';
import { CameraSource } from '../types';
import {
  X,
  Camera,
  Monitor,
  RefreshCw,
  Loader2,
  AlertTriangle
} from 'lucide-react';

interface CameraManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableDevices: MediaDeviceInfo[];
  activeCameras: CameraSource[];
  onTogglePhysicalCamera: (deviceId: string) => Promise<void>;
  onToggleScreenShare: () => Promise<void>;
  onRefreshDevices: () => Promise<MediaDeviceInfo[]>;
}

export const CameraManagerModal: React.FC<CameraManagerModalProps> = ({
  isOpen,
  onClose,
  availableDevices,
  activeCameras,
  onTogglePhysicalCamera,
  onToggleScreenShare,
  onRefreshDevices
}) => {
  const [loadingDeviceId, setLoadingDeviceId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<{ deviceId: string; message: string; details?: string } | null>(null);

  if (!isOpen) return null;

  const isPhysicalActive = (deviceId: string) => {
    return activeCameras.some(c => c.deviceId === deviceId || c.id === `physical-${deviceId}`);
  };

  const isScreenShareActive = activeCameras.some(c => c.type === 'screen');

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
        details = 'Nguyên nhân phổ biến: 1. Hai camera cùng dùng chip USB Sonix làm nghẽn băng thông USB 2.0; 2. Camera đang mở trong ứng dụng khác (Zoom, Teams, Zalo, Windows Camera). Giải pháp: Cắm camera USB sang cổng USB 3.0 (màu xanh), hoặc đóng các ứng dụng đang chiếm camera.';
      } else if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        message = 'Quyền truy cập camera bị từ chối.';
        details = 'Vui lòng kiểm tra cài đặt quyền camera trên trình duyệt.';
      } else if (err?.name === 'OverconstrainedError') {
        message = 'Camera không hỗ trợ độ phân giải yêu cầu (OverconstrainedError).';
        details = 'Camera phần cứng không đáp ứng thông số phân giải hoặc khung hình.';
      }

      setCameraError({ deviceId, message, details });
    } finally {
      setLoadingDeviceId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-primary/35 backdrop-blur-[2px] animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl bg-surface border border-line-subtle shadow-card overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-subtle bg-surface">
          <div>
            <h3 className="text-base font-semibold text-ink-primary flex items-center gap-2.5">
              <span>Quản lý nguồn video</span>
              <span className="text-xs px-2 py-0.5 rounded-lg bg-surface-subtle border border-line-subtle text-ink-secondary font-mono font-normal tabular-nums">
                {activeCameras.length} đang phát
              </span>
            </h3>
            <p className="text-xs text-ink-secondary mt-0.5">
              Bật song song nhiều webcam và luồng màn hình trong cùng cuộc gọi.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            className="p-1.5 rounded-xl text-ink-secondary hover:text-ink-primary hover:bg-surface-muted transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-surface-subtle">
          {cameraError && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs animate-fade-in space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-red-700">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{cameraError.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCameraError(null)}
                  className="p-1 rounded-lg text-red-600 hover:bg-red-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {cameraError.details && (
                <p className="text-red-700/90 leading-relaxed text-[11px]">
                  {cameraError.details}
                </p>
              )}
            </div>
          )}

          {/* Section 1: Physical Cameras */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-ink-secondary">
                Webcam phần cứng ({availableDevices.length})
              </h4>
              <button
                type="button"
                onClick={() => onRefreshDevices()}
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Quét lại thiết bị</span>
              </button>
            </div>

            {availableDevices.length === 0 ? (
              <div className="p-5 rounded-xl bg-surface border border-line-subtle text-center">
                <p className="text-xs text-ink-secondary">
                  Chưa phát hiện webcam phần cứng nào. Hãy kiểm tra kết nối USB hoặc cấp quyền truy cập cho trình duyệt.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {availableDevices.map((dev, idx) => {
                  const active = isPhysicalActive(dev.deviceId);
                  const isLoading = loadingDeviceId === dev.deviceId;
                  return (
                    <div
                      key={dev.deviceId || idx}
                      className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors ${
                        active
                          ? 'bg-accent-soft border-accent-border'
                          : 'bg-surface border-line-subtle hover:border-line-strong'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                            active
                              ? 'bg-accent border-accent text-white'
                              : 'bg-surface-subtle border-line-subtle text-ink-secondary'
                          }`}
                        >
                          <Camera className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink-primary flex items-center gap-2 truncate">
                            <span className="truncate">{dev.label || `Thiết bị Camera ${idx + 1}`}</span>
                            {active && (
                              <span className="text-[11px] font-medium text-accent shrink-0">
                                Đang phát
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-muted font-mono truncate">
                            {dev.deviceId ? `${dev.deviceId.slice(0, 22)}...` : 'Thiết bị mặc định'}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleTogglePhysical(dev.deviceId)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors flex items-center gap-1.5 shrink-0 ${
                          isLoading
                            ? 'bg-surface-muted border-line-subtle text-ink-muted cursor-not-allowed'
                            : active
                            ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                            : 'bg-accent border-accent hover:bg-accent-hover text-white'
                        }`}
                      >
                        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{isLoading ? 'Đang bật...' : active ? 'Tắt' : 'Bật'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Screen Share */}
          <div>
            <h4 className="text-xs font-semibold text-ink-secondary mb-3">
              Chia sẻ màn hình
            </h4>

            <div
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                isScreenShareActive
                  ? 'bg-accent-soft border-accent-border'
                  : 'bg-surface border-line-subtle hover:border-line-strong'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                    isScreenShareActive
                      ? 'bg-accent border-accent text-white'
                      : 'bg-surface-subtle border-line-subtle text-ink-secondary'
                  }`}
                >
                  <Monitor className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="text-sm font-medium text-ink-primary flex items-center gap-2">
                    <span>Luồng màn hình máy tính</span>
                    {isScreenShareActive && (
                      <span className="text-[11px] font-medium text-accent">Đang phát</span>
                    )}
                  </div>
                  <p className="text-xs text-ink-secondary mt-0.5">
                    Chia sẻ cửa sổ, tab trình duyệt hoặc toàn bộ màn hình như một khung video độc lập.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onToggleScreenShare()}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors shrink-0 ${
                  isScreenShareActive
                    ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                    : 'bg-surface-subtle border-line-subtle hover:bg-surface-muted text-ink-primary'
                }`}
              >
                {isScreenShareActive ? 'Dừng chia sẻ' : 'Chọn màn hình'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line-subtle bg-surface flex items-center justify-between gap-4">
          <span className="text-xs text-ink-muted">
            Các luồng video được tự động cập nhật mà không làm gián đoạn cuộc gọi.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface-subtle hover:bg-surface-muted border border-line-subtle text-ink-primary text-xs font-medium transition-colors shrink-0"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
