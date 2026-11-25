/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - WEBRTC STATS & DIAGNOSTICS MODAL
 * ============================================================================
 * Bảng hiển thị thông số đo kiểm chất lượng mạng và trạng thái P2P:
 *  - Độ trễ khứ hồi Round-Trip Time (RTT latency tính bằng ms).
 *  - Tỷ lệ mất gói tin (Packet Loss).
 *  - Tốc độ khung hình (FPS) và độ phân giải thực tế của luồng nhận.
 *  - Vai trò đàm phán trong Perfect Negotiation (Polite hay Impolite).
 *  - Loại kết nối ICE Candidate pair (Host / Server Reflexive STUN / Relay TURN).
 */

import React, { useState } from 'react';
import { X, Activity, Copy, Check } from 'lucide-react';
import { WebRTCStats } from '../types';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: WebRTCStats | null;
  roomId: string;
  isPolite: boolean;
  peerConnected: boolean;
  hasTurnServer?: boolean;
  iceConnectionState?: RTCIceConnectionState;
  connectionState?: RTCPeerConnectionState;
  debugLogs?: string[];
}

export const StatsModal: React.FC<StatsModalProps> = ({
  isOpen,
  onClose,
  stats,
  roomId,
  isPolite,
  peerConnected,
  hasTurnServer = false,
  iceConnectionState = 'new',
  connectionState = 'new',
  debugLogs = []
}) => {
  const [copiedLogs, setCopiedLogs] = useState(false);

  if (!isOpen) return null;

  const handleCopyLogs = () => {
    const header = `Room=${roomId} | Role=${isPolite ? 'Polite' : 'Impolite'} | ICE=${iceConnectionState} | Conn=${connectionState} | TURN=${hasTurnServer}`;
    const text = [header, ...debugLogs].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    }).catch(console.warn);
  };

  const formatCandidateType = (type?: string, protocol?: string) => {
    if (!type) return peerConnected ? 'Đang thiết lập...' : 'Chờ kết nối';
    const protoSuffix = protocol ? ` (${protocol.toUpperCase()})` : '';
    switch (type) {
      case 'host':
        return `Host LAN${protoSuffix}`;
      case 'srflx':
        return `STUN Direct${protoSuffix}`;
      case 'prflx':
        return `Peer Reflexive${protoSuffix}`;
      case 'relay':
        return `TURN Relay${protoSuffix}`;
      default:
        return `${type}${protoSuffix}`;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-primary/35 backdrop-blur-[2px] animate-fade-in">
      <div className="relative w-full max-w-lg max-h-[90dvh] flex flex-col rounded-2xl bg-surface border border-line-subtle shadow-card overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle bg-surface">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-accent" strokeWidth={1.75} />
            <div>
              <h3 className="text-sm font-semibold text-ink-primary">Thông số kết nối WebRTC</h3>
              <p className="text-xs text-ink-secondary">Giám sát đường truyền P2P theo thời gian thực</p>
            </div>
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
        <div className="p-5 space-y-4 bg-surface-subtle overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-surface border border-line-subtle">
              <span className="text-xs text-ink-secondary block mb-1">Trạng thái</span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    peerConnected ? 'bg-emerald-600' : 'bg-amber-500'
                  }`}
                />
                <span className="text-sm font-semibold text-ink-primary">
                  {peerConnected ? 'Đang kết nối' : 'Đang chờ'}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface border border-line-subtle">
              <span className="text-xs text-ink-secondary block mb-1">Độ trễ RTT</span>
              <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                {stats && stats.rtt > 0
                  ? `${stats.rtt} ms`
                  : connectionState === 'connected'
                  ? 'Dưới 5 ms'
                  : 'Đang đo...'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface border border-line-subtle">
              <span className="text-xs text-ink-secondary block mb-1">Khung hình</span>
              <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                {stats?.fps ? `${stats.fps} FPS` : '—'}{' '}
                <span className="text-xs font-normal text-ink-secondary">
                  {stats?.resolution ? `(${stats.resolution})` : ''}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface border border-line-subtle">
              <span className="text-xs text-ink-secondary block mb-1">Gói tin mất</span>
              <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                {stats?.packetsLost !== undefined ? stats.packetsLost : '0'}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-surface border border-line-subtle divide-y divide-line-subtle text-xs">
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Mã phòng</span>
              <span className="font-mono text-ink-primary font-medium">{roomId}</span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Vai trò đàm phán</span>
              <span className="font-mono text-ink-primary">
                {isPolite ? 'Polite Peer' : 'Impolite Peer'}
              </span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Cơ chế SDP</span>
              <span className="font-mono text-ink-primary">Unified Plan</span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Trạng thái ICE</span>
              <span
                className={`font-mono font-medium ${
                  iceConnectionState === 'connected' || iceConnectionState === 'completed'
                    ? 'text-emerald-700'
                    : iceConnectionState === 'failed'
                    ? 'text-red-600'
                    : 'text-amber-700'
                }`}
              >
                {iceConnectionState}
              </span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Kết nối DTLS/Peer</span>
              <span
                className={`font-mono font-medium ${
                  connectionState === 'connected'
                    ? 'text-emerald-700'
                    : connectionState === 'failed'
                    ? 'text-red-600'
                    : 'text-amber-700'
                }`}
              >
                {stats?.dtlsState ? `${connectionState} (${stats.dtlsState})` : connectionState}
              </span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Đường truyền</span>
              <span className="font-mono text-ink-primary">
                {formatCandidateType(stats?.candidateType, stats?.candidateProtocol)}
              </span>
            </div>
            <div className="flex justify-between items-center px-3.5 py-2.5 text-ink-secondary">
              <span>Máy chủ TURN</span>
              <span className={`font-mono ${hasTurnServer ? 'text-emerald-700' : 'text-amber-700'}`}>
                {hasTurnServer ? 'Đã cấu hình' : 'Chỉ dùng STUN'}
              </span>
            </div>
          </div>

          {!hasTurnServer && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
              Chưa cấu hình TURN Server. Kết nối trong cùng mạng hoặc NAT mở vẫn hoạt động bình thường, nhưng kết nối giữa WiFi và 4G hoặc mạng có tường lửa chặt có thể bị chặn.
            </div>
          )}

          {/* Nhật ký WebRTC / Socket để chẩn đoán lỗi trên cả điện thoại */}
          <div className="rounded-xl bg-surface border border-line-subtle overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-line-subtle">
              <span className="text-xs font-medium text-ink-secondary">
                Nhật ký kết nối ({debugLogs.length})
              </span>
              <button
                type="button"
                onClick={handleCopyLogs}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover transition-colors"
              >
                {copiedLogs ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép log</span>
                  </>
                )}
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto p-3 bg-surface-subtle font-mono text-[11px] leading-relaxed text-ink-secondary space-y-1 select-text">
              {debugLogs.length === 0 ? (
                <div className="text-ink-muted">Chưa có log kết nối.</div>
              ) : (
                debugLogs.map((line, idx) => (
                  <div
                    key={idx}
                    className={
                      line.includes('[ERR]')
                        ? 'text-red-600 break-all'
                        : line.includes('[WARN]')
                        ? 'text-amber-700 break-all'
                        : 'text-ink-primary break-all'
                    }
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line-subtle bg-surface flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface-subtle hover:bg-surface-muted border border-line-subtle text-xs font-medium text-ink-primary transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
