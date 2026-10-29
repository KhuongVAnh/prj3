/**
 * ============================================================================
 * MODULE: CLIENT COMPONENTS - LOBBY VIEW (PHÒNG CHỜ TIỀN CUỘC GỌI)
 * ============================================================================
 * Màn hình chờ kiểm tra thiết bị trước khi bước vào phòng gọi:
 *  - Nhập tên hiển thị và mã phòng họp (hoặc tạo mã phòng ngẫu nhiên tự động).
 *  - Xem trước hình ảnh camera (Local Video Preview) và kiểm tra tín hiệu micro.
 *  - Bật/Tắt camera, micro, hoặc chọn chế độ Camera Ảo trước khi tham gia.
 *  - Dọn dẹp toàn bộ luồng preview khi chuyển sang màn hình Room để giải phóng phần cứng.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  ArrowRight,
  Sparkles,
  Layers,
  Shield,
  Zap,
  Users
} from 'lucide-react';
import { createVirtualCameraStream, VirtualCamInstance } from '../utils/virtualCamera';

interface LobbyProps {
  initialRoomId: string;
  onJoinRoom: (roomId: string, userName: string, initialAudio: boolean, initialVideo: boolean, useVirtualCam: boolean) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ initialRoomId, onJoinRoom }) => {
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [userName, setUserName] = useState('');
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [useVirtualCam, setUseVirtualCam] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const virtualInstRef = useRef<VirtualCamInstance | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Initialize random default name if empty
  useEffect(() => {
    const savedName = localStorage.getItem('omnicam_user_name');
    if (savedName) {
      setUserName(savedName);
    } else {
      const defaultName = `User_${Math.floor(1000 + Math.random() * 9000)}`;
      setUserName(defaultName);
    }
  }, []);

  // Set initial room id or generate one
  useEffect(() => {
    if (!roomId) {
      const randomCode = `meet-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
      setRoomId(randomCode);
    }
  }, [roomId]);

  // Handle local video & audio preview
  useEffect(() => {
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    const setupPreview = async () => {
      // Cleanup previous
      if (virtualInstRef.current) {
        virtualInstRef.current.stop();
        virtualInstRef.current = null;
      }
      if (previewStream) {
        previewStream.getTracks().forEach(t => t.stop());
      }

      if (useVirtualCam) {
        const vInst = createVirtualCameraStream('clock');
        virtualInstRef.current = vInst;
        stream = vInst.stream;
        setPreviewStream(stream);
      } else if (isVideoEnabled || isAudioEnabled) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: isVideoEnabled ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
            audio: isAudioEnabled
          });
          setPreviewStream(stream);

          // Audio meter
          if (isAudioEnabled && stream.getAudioTracks().length > 0) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            audioCtx = new AudioCtx();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 128;
            source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateMeter = () => {
              if (!analyser) return;
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
              const avg = sum / dataArray.length;
              setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
              animFrameRef.current = requestAnimationFrame(updateMeter);
            };
            animFrameRef.current = requestAnimationFrame(updateMeter);
          }
        } catch (e) {
          console.warn('[Lobby] Camera/mic access fallback:', e);
          // If physical webcam is blocked or unavailable, automatically offer virtual cam
          setUseVirtualCam(true);
        }
      } else {
        setPreviewStream(null);
      }
    };

    setupPreview();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (source) {
        try { source.disconnect(); } catch (_) {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try { audioCtx.close(); } catch (_) {}
      }
      if (virtualInstRef.current) {
        virtualInstRef.current.stop();
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isVideoEnabled, isAudioEnabled, useVirtualCam]);

  // Bind video element
  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const finalRoom = roomId.trim().toLowerCase();
    const finalName = userName.trim() || 'Guest';
    localStorage.setItem('omnicam_user_name', finalName);

    // Stop lobby stream before entering room
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
    }
    if (virtualInstRef.current) {
      virtualInstRef.current.stop();
    }

    onJoinRoom(finalRoom, finalName, isAudioEnabled, isVideoEnabled, useVirtualCam);
  };

  const handleCreateNewRoom = () => {
    const randomCode = `meet-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
    setRoomId(randomCode);
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-between p-4 sm:p-8">
      {/* Top Navbar */}
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-100 flex items-center gap-2">
              OmniCam <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 font-mono">Multi-Cam WebRTC</span>
            </h1>
            <p className="text-xs text-slate-400">1-on-1 Multi-Camera Video Collaboration</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
            <Shield className="w-3.5 h-3.5 text-brand-400" /> End-to-End P2P
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl w-full mx-auto my-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Side: Camera Preview */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="relative w-full aspect-video rounded-3xl bg-dark-900 border border-white/10 shadow-2xl overflow-hidden group">
            {/* Video element */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${
                !useVirtualCam ? '-scale-x-100' : ''
              } ${!isVideoEnabled && !useVirtualCam ? 'hidden' : 'block'}`}
            />

            {/* Video off placeholder */}
            {!isVideoEnabled && !useVirtualCam && (
              <div className="w-full h-full flex flex-col items-center justify-center bg-dark-900">
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 mb-3">
                  <VideoOff className="w-8 h-8" />
                </div>
                <span className="text-sm font-medium text-slate-300">Camera is turned off</span>
                <span className="text-xs text-slate-500 mt-1">You can turn it on below or join without camera</span>
              </div>
            )}

            {/* Top badges */}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-dark-950/80 backdrop-blur-md border border-white/10 text-xs font-semibold text-slate-200">
                {useVirtualCam ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Studio Clock [Virtual Preview]</span>
                  </>
                ) : (
                  <>
                    <Video className="w-3.5 h-3.5 text-brand-400" />
                    <span>Webcam Preview</span>
                  </>
                )}
              </span>
            </div>

            {/* Audio Volume Bar (Bottom overlay) */}
            {isAudioEnabled && (
              <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-dark-950/80 backdrop-blur-md border border-white/10 text-xs text-slate-300">
                <Mic className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                <span className="text-[11px] font-mono shrink-0">Mic Level:</span>
                <div className="flex-1 h-2 rounded-full bg-dark-800 overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-all duration-75 rounded-full"
                    style={{ width: `${audioLevel}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-slate-400 w-8 text-right">{audioLevel}%</span>
              </div>
            )}
          </div>

          {/* Quick Toggles */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => setIsAudioEnabled(!isAudioEnabled)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold border transition-all ${
                isAudioEnabled
                  ? 'bg-white/10 text-slate-200 border-white/10 hover:bg-white/15'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              }`}
            >
              {isAudioEnabled ? <Mic className="w-4 h-4 text-brand-400" /> : <MicOff className="w-4 h-4" />}
              <span>{isAudioEnabled ? 'Mic Active' : 'Mic Muted'}</span>
            </button>

            <button
              onClick={() => {
                if (useVirtualCam) {
                  setUseVirtualCam(false);
                  setIsVideoEnabled(true);
                } else {
                  setIsVideoEnabled(!isVideoEnabled);
                }
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold border transition-all ${
                isVideoEnabled && !useVirtualCam
                  ? 'bg-white/10 text-slate-200 border-white/10 hover:bg-white/15'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              }`}
            >
              {isVideoEnabled && !useVirtualCam ? <Video className="w-4 h-4 text-brand-400" /> : <VideoOff className="w-4 h-4" />}
              <span>{isVideoEnabled && !useVirtualCam ? 'Webcam Active' : 'Webcam Off'}</span>
            </button>

            <button
              onClick={() => setUseVirtualCam(!useVirtualCam)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold border transition-all ${
                useVirtualCam
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-white/5 text-slate-300 border-white/5 hover:bg-white/10'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>{useVirtualCam ? 'Using Virtual Cam' : 'Preview Virtual Cam'}</span>
            </button>
          </div>
        </div>

        {/* Right Side: Join / Create Form */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="p-7 rounded-3xl bg-dark-900 border border-white/10 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-100 mb-1">Join or Create Video Room</h2>
            <p className="text-xs text-slate-400 mb-6">
              Connect 1-on-1 and stream multiple camera angles (facecam + desk cam + screen) at the same time.
            </p>

            <form onSubmit={handleJoin} className="space-y-4">
              {/* Name Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                  Your Display Name
                </label>
                <input
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. Alex Hunter"
                  className="w-full px-4 py-3 rounded-2xl bg-dark-950 border border-white/10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500/50"
                />
              </div>

              {/* Room Code Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Room Code / ID
                  </label>
                  <button
                    type="button"
                    onClick={handleCreateNewRoom}
                    className="text-xs text-brand-400 hover:text-brand-300 font-medium"
                  >
                    Generate New Code
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="e.g. meet-812-493"
                  className="w-full px-4 py-3 rounded-2xl bg-dark-950 border border-white/10 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500/50"
                />
              </div>

              {/* Join Button */}
              <button
                type="submit"
                className="w-full py-3.5 px-6 rounded-2xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold text-sm transition-all shadow-xl shadow-brand-500/20 flex items-center justify-center gap-2 group mt-2"
              >
                <span>Enter Room Now</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>

            {/* Feature Highlights */}
            <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-2 gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-400 shrink-0" />
                <span>Private 1-on-1 Call</span>
              </div>
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-brand-400 shrink-0" />
                <span>Simultaneous Multi-Cam</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-400 shrink-0" />
                <span>Simulated Virtual Feeds</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-brand-400 shrink-0" />
                <span>Zero Latency P2P</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto text-center py-4 border-t border-white/5 text-xs text-slate-500 font-mono">
        OmniCam WebRTC Engine • Multi-Camera Unified Plan Dynamic Renegotiation
      </footer>
    </div>
  );
};
