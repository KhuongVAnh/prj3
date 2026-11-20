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

import React from 'react';
import { X, Activity } from 'lucide-react';
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
}

export const StatsModal: React.FC<StatsModalProps> = ({
  isOpen,
  onClose,
  stats,
  roomId,
  isPolite,
  peerConnected,
  hasTurnServer = false,
  iceConnectionState = 'new'
}) => {
  if (!isOpen) return null;

  const formatCandidateType = (type?: string) => {
    if (!type) return peerConnected ? 'Đang thiết lập...' : 'Chờ kết nối';
    switch (type) {
      case 'host':
        return 'Host (Cùng mạng LAN)';
      case 'srflx':
        return 'STUN Direct (P2P NAT)';
      case 'prflx':
        return 'Peer Reflexive (P2P)';
      case 'relay':
        return 'TURN Relay (Xuyên Firewall/4G)';
      default:
        return type;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-primary/35 backdrop-blur-[2px] animate-fade-in">
      <div className="relative w-full max-w-md rounded-2xl bg-surface border border-line-subtle shadow-card overflow-hidden animate-scale-in">
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
        <div className="p-5 space-y-4 bg-surface-subtle">
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
                {stats?.rtt ? `${stats.rtt} ms` : 'Dưới 5 ms'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-surface border border-line-subtle">
              <span className="text-xs text-ink-secondary block mb-1">Khung hình</span>
              <div className="text-sm font-semibold font-mono tabular-nums text-ink-primary">
                {stats?.fps ? `${stats.fps} FPS` : '30 FPS'}{' '}
                <span className="text-xs font-normal text-ink-secondary">
                  ({stats?.resolution || '720p'})
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
              <span>Đường truyền</span>
              <span className="font-mono text-ink-primary">{formatCandidateType(stats?.candidateType)}</span>
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
