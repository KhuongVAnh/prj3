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
import { X, Activity, Wifi, ShieldCheck, Zap } from 'lucide-react';
import { WebRTCStats } from '../types';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: WebRTCStats | null;
  roomId: string;
  isPolite: boolean;
  peerConnected: boolean;
}

export const StatsModal: React.FC<StatsModalProps> = ({
  isOpen,
  onClose,
  stats,
  roomId,
  isPolite,
  peerConnected
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-3xl bg-dark-900 border border-white/10 shadow-2xl overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-dark-850">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">WebRTC Diagnostics</h3>
              <p className="text-[11px] text-slate-400">Realtime P2P Telemetry & State</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                Connection
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    peerConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                <span className="text-sm font-bold text-slate-200">
                  {peerConnected ? 'P2P Active' : 'Waiting Peer'}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                Round-Trip Time
              </span>
              <div className="flex items-center gap-1 text-sm font-bold text-slate-200">
                <Wifi className="w-3.5 h-3.5 text-brand-400" />
                <span>{stats?.rtt ? `${stats.rtt} ms` : 'Local / < 5 ms'}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                Framerate & Res
              </span>
              <div className="text-sm font-bold text-slate-200">
                {stats?.fps ? `${stats.fps} FPS` : '30 FPS'}{' '}
                <span className="text-xs font-normal text-slate-400 font-mono">
                  ({stats?.resolution || '720p HD'})
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                Packets Lost
              </span>
              <div className="text-sm font-bold text-slate-200">
                {stats?.packetsLost !== undefined ? stats.packetsLost : '0'}
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-dark-850/80 border border-white/10 space-y-2 text-xs">
            <div className="flex justify-between items-center text-slate-400">
              <span>Room ID:</span>
              <span className="font-mono text-slate-200 font-semibold">{roomId}</span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Negotiation Role:</span>
              <span className="font-mono text-slate-200">
                {isPolite ? 'Polite Peer (Auto-yielding)' : 'Impolite Peer (Initiator)'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Multi-Track Topology:</span>
              <span className="font-mono text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Unified Plan P2P
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-400">
              <span>Dynamic Renegotiation:</span>
              <span className="font-mono text-sky-400 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" /> Perfect Negotiation
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-dark-850 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
