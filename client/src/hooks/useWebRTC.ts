/**
 * ============================================================================
 * MODULE: CLIENT HOOKS - WEBRTC MULTI-CAMERA CORE ENGINE (useWebRTC)
 * ============================================================================
 * Hook này là trái tim của toàn bộ ứng dụng, thực thi đầy đủ các tiêu chuẩn
 * WebRTC 1.0 (Unified Plan) và Perfect Negotiation Pattern:
 *
 * 1. QUẢN LÝ KẾT NỐI WEBRTC P2P:
 *    - Khởi tạo RTCPeerConnection với danh sách máy chủ Google STUN.
 *    - Thu thập và trao đổi ứng viên mạng ICE Candidates qua Socket.io.
 *    - Xử lý xung đột đàm phán (Glare Collision) bằng chuẩn W3C Perfect Negotiation:
 *      * Impolite Peer: Giữ vững Offer của mình, bỏ qua Offer từ đối phương khi xảy ra xung đột.
 *      * Polite Peer: Tự động rollback trạng thái 'have-local-offer' và chấp nhận Offer của đối phương.
 *
 * 2. HỖ TRỢ ĐA CAMERA ĐỒNG THỜI (DYNAMIC MULTI-TRACK):
 *    - Cho phép bật nhiều camera phần cứng + camera ảo + chia sẻ màn hình cùng lúc.
 *    - Mỗi camera tương ứng với một RTCRtpSender độc lập trong RTCPeerConnection.
 *    - Khi thêm/bớt camera, sự kiện 'onnegotiationneeded' tự động kích hoạt tạo Offer
 *      mới để tái thương lượng (Dynamic Renegotiation) mà KHÔNG làm gián đoạn cuộc gọi.
 *
 * 3. ĐỒNG BỘ METADATA CAMERA:
 *    - Gửi kèm danh sách nhãn tên, trackId, streamId trong từng gói tin Offer/Answer.
 *    - Remote peer tự động map đúng track video vào nhãn camera tương ứng trên UI.
 *
 * 4. ĐO KIỂM THÔNG SỐ MẠNG (METRICS POLLING):
 *    - Định kỳ 2 giây gọi pc.getStats() để đo độ trễ RTT, packet loss, FPS, bitrate.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { CameraSource, RemoteCameraStream, CameraMeta, PeerInfo, ChatMessage, WebRTCStats } from '../types';
import { createVirtualCameraStream, VirtualCamInstance } from '../utils/virtualCamera';
import { ICE_SERVERS } from '../constants/webrtc';

export function useWebRTC(roomId: string, userName: string) {
  // Trạng thái kết nối WebSocket tới Signaling Server
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isRoomFull, setIsRoomFull] = useState<boolean>(false);

  // Thông tin về người đối diện trong phòng họp (Remote Peer)
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);

  // Vai trò Perfect Negotiation của máy cục bộ (true: nhường, false: chủ động)
  const [isPolite, setIsPolite] = useState<boolean>(false);

  // Trạng thái media của máy cục bộ
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Danh sách các luồng camera đang hoạt động
  const [localCameras, setLocalCameras] = useState<CameraSource[]>([]);       // Camera cục bộ
  const [remoteCameras, setRemoteCameras] = useState<RemoteCameraStream[]>([]); // Camera nhận từ đối phương
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]); // Danh sách camera phần cứng quét được

  // Tin nhắn chat và thông số đo kiểm mạng
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [stats, setStats] = useState<WebRTCStats | null>(null);

  /**
   * CÁC THAM CHIẾU (REFS) QUẢN LÝ TÀI NGUYÊN BẤT ĐỒNG BỘ:
   * Giúp truy cập dữ liệu mới nhất trong các hàm callback WebRTC / Socket mà
   * KHÔNG kích hoạt re-render React không cần thiết.
   */
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localCamerasRef = useRef<CameraSource[]>([]);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const cameraSendersRef = useRef<Map<string, RTCRtpSender>>(new Map()); // Map cameraId -> RTCRtpSender
  const virtualCamInstancesRef = useRef<Map<string, VirtualCamInstance>>(new Map());
  const remoteAudioElemRef = useRef<HTMLAudioElement | null>(null);
  const peerInfoRef = useRef<PeerInfo | null>(null);

  // Các biến cờ trạng thái theo chuẩn W3C Perfect Negotiation
  const isPoliteRef = useRef<boolean>(false);
  const makingOfferRef = useRef<boolean>(false);
  const ignoreOfferRef = useRef<boolean>(false);
  const isSettingRemoteAnswerPendingRef = useRef<boolean>(false);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteCameraMetaRef = useRef<CameraMeta[]>([]);

  // Keep peerInfoRef synchronized
  useEffect(() => {
    peerInfoRef.current = peerInfo;
  }, [peerInfo]);

  // Enumerate physical video devices
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableVideoDevices(videoDevices);
      return videoDevices;
    } catch (err) {
      console.warn('[Devices] Failed to enumerate devices:', err);
      return [];
    }
  }, []);

  // Prepare Camera Metadata for signaling
  const getLocalCamerasMeta = useCallback((): CameraMeta[] => {
    return localCamerasRef.current.map(cam => {
      const track = cam.stream.getVideoTracks()[0];
      return {
        cameraId: cam.id,
        trackId: track ? track.id : '',
        streamId: cam.stream.id,
        label: cam.label,
        type: cam.type
      };
    });
  }, []);

  // Broadcast camera state to peer
  const broadcastCameraState = useCallback(() => {
    if (!socketRef.current) return;
    const meta = getLocalCamerasMeta();
    socketRef.current.emit('camera-state-update', { cameras: meta });
  }, [getLocalCamerasMeta]);

  // Update Remote Camera Metadata & Reconcile Remote Streams
  const updateRemoteCameraMeta = useCallback((cameras: CameraMeta[]) => {
    remoteCameraMetaRef.current = cameras;
    setRemoteCameras(prev => {
      // If peer has no cameras left, empty the list
      if (cameras.length === 0) return [];

      const activeStreamIds = new Set(cameras.map(c => c.streamId).filter(Boolean));
      const activeTrackIds = new Set(cameras.map(c => c.trackId).filter(Boolean));
      const activeCameraIds = new Set(cameras.map(c => c.cameraId).filter(Boolean));

      // Filter out ended tracks or unmapped streams when metadata is active
      const filtered = prev.filter(rc => {
        const track = rc.stream.getVideoTracks()[0];
        if (track && track.readyState === 'ended') return false;

        const matches =
          activeTrackIds.has(rc.id) ||
          activeStreamIds.has(rc.stream.id) ||
          activeCameraIds.has(rc.cameraId);

        // Keep existing if matched, or keep temporarily until next update
        return matches || activeCameraIds.size === 0;
      });

      // Update metadata on existing streams
      return filtered.map((rc, idx) => {
        let matched = cameras.find(
          m =>
            (m.trackId && m.trackId === rc.id) ||
            (m.streamId && m.streamId === rc.stream.id) ||
            (m.cameraId && m.cameraId === rc.cameraId)
        );

        if (!matched && cameras.length === filtered.length) {
          matched = cameras[idx];
        }

        if (matched) {
          return {
            ...rc,
            cameraId: matched.cameraId,
            label: matched.label,
            type: matched.type
          };
        }
        return rc;
      });
    });
  }, []);

  // Initialize Microphone Audio Track
  const initAudio = useCallback(async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localAudioStreamRef.current = audioStream;
      setLocalAudioStream(audioStream);

      const track = audioStream.getAudioTracks()[0];
      localAudioTrackRef.current = track;

      if (pcRef.current && track) {
        if (!audioSenderRef.current) {
          audioSenderRef.current = pcRef.current.addTrack(track, audioStream);
        }
      }
      return audioStream;
    } catch (err) {
      console.warn('[Audio] Failed to acquire microphone stream:', err);
      return null;
    }
  }, []);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    if (localAudioTrackRef.current) {
      const newEnabled = !localAudioTrackRef.current.enabled;
      localAudioTrackRef.current.enabled = newEnabled;
      setIsMuted(!newEnabled);
      if (socketRef.current) {
        socketRef.current.emit('mic-state-update', { isMuted: !newEnabled });
      }
    }
  }, []);

  // Add a Physical Camera with robust multi-tier fallback (resolves USB bandwidth & hardware locks)
  const addPhysicalCamera = useCallback(async (deviceId?: string, customLabel?: string) => {
    try {
      let stream: MediaStream | null = null;
      let lastError: any = null;

      if (deviceId) {
        // Multi-tier attempt to guarantee we open THIS specific physical camera:
        // Tier 1: exact deviceId with ideal 720p
        // Tier 2: exact deviceId with lower resolution (480p) - crucial for USB 2.0 dual camera bandwidth!
        // Tier 3: exact deviceId with 360p (ultra-light bandwidth)
        // Tier 4: exact deviceId unconstrained (let camera negotiate native format/MJPEG)
        // Tier 5: deviceId direct string (older browser driver compatibility)
        const attempts: MediaStreamConstraints[] = [
          { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
          { video: { deviceId: { exact: deviceId }, width: { ideal: 480 }, height: { ideal: 360 } }, audio: false },
          { video: { deviceId: { exact: deviceId } }, audio: false },
          { video: { deviceId: deviceId }, audio: false }
        ];

        for (const candidate of attempts) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(candidate);
            if (stream) {
              console.log('[Camera] Successfully opened physical device with constraints:', candidate);
              break;
            }
          } catch (err: any) {
            lastError = err;
            console.warn('[Camera] Constraint attempt failed for device', deviceId, err.name, err.message);
          }
        }

        // If all exact attempts failed, try ideal as a fallback, but strictly verify it didn't return an already active device!
        if (!stream) {
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { ideal: deviceId } },
              audio: false
            });
            const fallbackTrack = fallbackStream.getVideoTracks()[0];
            const fallbackDeviceId = fallbackTrack.getSettings().deviceId;

            // Check if fallback returned a device that is ALREADY active!
            const alreadyRunning = localCamerasRef.current.some(c =>
              (fallbackDeviceId && c.deviceId === fallbackDeviceId) ||
              (fallbackDeviceId && c.id === `physical-${fallbackDeviceId}`)
            );

            if (alreadyRunning) {
              fallbackStream.getTracks().forEach(t => t.stop());
              const conflictErr = new Error(
                'Trình duyệt không thể kích hoạt đồng thời camera này (xung đột phần cứng USB hoặc camera đang bị ứng dụng khác chiếm dụng).'
              );
              conflictErr.name = 'NotReadableError';
              throw conflictErr;
            }
            stream = fallbackStream;
          } catch (err: any) {
            console.error('[Camera] All attempts to open camera failed:', err);
            throw lastError || err;
          }
        }
      } else {
        // No specific device requested, open default camera with progressive fallback
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });
        } catch (_) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      if (!stream) {
        throw lastError || new Error('Không thể thu nhận luồng video từ camera.');
      }

      const track = stream.getVideoTracks()[0];
      const settingsDeviceId = track.getSettings().deviceId;
      const targetDeviceId = deviceId || settingsDeviceId || `cam-${Date.now()}`;
      const cameraId = `physical-${targetDeviceId}`;

      // Check if already active
      const exists = localCamerasRef.current.find(c =>
        c.id === cameraId ||
        (deviceId && c.deviceId === deviceId) ||
        (settingsDeviceId && c.deviceId === settingsDeviceId)
      );

      if (exists) {
        console.log(`[Camera] Camera ${cameraId} is already active.`);
        // Stop newly opened stream tracks to prevent hardware lock leak!
        stream.getTracks().forEach(t => t.stop());
        return exists;
      }

      const label = customLabel || track.label || `Camera ${localCamerasRef.current.length + 1}`;

      const newCam: CameraSource = {
        id: cameraId,
        deviceId: targetDeviceId,
        label,
        type: 'physical',
        stream,
        active: true
      };

      // Synchronously update localCamerasRef BEFORE addTrack to ensure onnegotiationneeded has accurate metadata
      localCamerasRef.current = [...localCamerasRef.current, newCam];
      setLocalCameras(localCamerasRef.current);

      // Add to RTCPeerConnection if established
      if (pcRef.current) {
        const sender = pcRef.current.addTrack(track, stream);
        cameraSendersRef.current.set(cameraId, sender);
      }

      refreshDevices();
      broadcastCameraState();
      return newCam;
    } catch (err) {
      console.error('[Camera] Failed to add physical camera:', err);
      throw err;
    }
  }, [broadcastCameraState, refreshDevices]);

  // Add a Virtual Simulated Camera
  const addVirtualCamera = useCallback((pattern: 'clock' | 'blueprint' | 'radar') => {
    const patternLabels: Record<string, string> = {
      clock: 'Studio SMPTE Clock [Virtual]',
      blueprint: 'Desk Blueprint [Virtual]',
      radar: 'Radar Scanner [Virtual]'
    };
    const cameraId = `virtual-${pattern}`;

    // Prevent duplicates
    const exists = localCamerasRef.current.find(c => c.id === cameraId);
    if (exists) {
      return exists;
    }

    const instance = createVirtualCameraStream(pattern);
    virtualCamInstancesRef.current.set(cameraId, instance);

    const track = instance.stream.getVideoTracks()[0];
    const newCam: CameraSource = {
      id: cameraId,
      label: patternLabels[pattern] || 'Virtual Camera',
      type: 'virtual',
      stream: instance.stream,
      active: true,
      virtualPattern: pattern
    };

    // Synchronously update localCamerasRef BEFORE addTrack
    localCamerasRef.current = [...localCamerasRef.current, newCam];
    setLocalCameras(localCamerasRef.current);

    if (pcRef.current) {
      const sender = pcRef.current.addTrack(track, instance.stream);
      cameraSendersRef.current.set(cameraId, sender);
    }

    broadcastCameraState();
    return newCam;
  }, [broadcastCameraState]);

  // Remove a Camera (Physical, Virtual, or Screen)
  const removeCamera = useCallback((cameraId: string) => {
    const target = localCamerasRef.current.find(c => c.id === cameraId);
    if (target) {
      target.stream.getTracks().forEach(t => t.stop());
    }

    // Cleanup virtual instance if any
    const vInst = virtualCamInstancesRef.current.get(cameraId);
    if (vInst) {
      vInst.stop();
      virtualCamInstancesRef.current.delete(cameraId);
    }

    // Synchronously update localCamerasRef
    localCamerasRef.current = localCamerasRef.current.filter(c => c.id !== cameraId);
    setLocalCameras(localCamerasRef.current);

    // Remove from RTCPeerConnection
    if (pcRef.current) {
      const sender = cameraSendersRef.current.get(cameraId);
      if (sender) {
        try {
          pcRef.current.removeTrack(sender);
        } catch (e) {
          console.warn('[WebRTC] Error removing track sender:', e);
        }
        cameraSendersRef.current.delete(cameraId);
      }
    }

    broadcastCameraState();
  }, [broadcastCameraState]);

  // Add Screen Share as a Camera Feed
  const addScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      const cameraId = `screen-${Date.now()}`;

      const newCam: CameraSource = {
        id: cameraId,
        label: 'Shared Screen',
        type: 'screen',
        stream,
        active: true
      };

      track.onended = () => {
        removeCamera(cameraId);
      };

      // Synchronously update localCamerasRef BEFORE addTrack
      localCamerasRef.current = [...localCamerasRef.current, newCam];
      setLocalCameras(localCamerasRef.current);

      if (pcRef.current) {
        const sender = pcRef.current.addTrack(track, stream);
        cameraSendersRef.current.set(cameraId, sender);
      }

      broadcastCameraState();
      return newCam;
    } catch (err) {
      console.warn('[ScreenShare] Cancelled or failed:', err);
      return null;
    }
  }, [broadcastCameraState, removeCamera]);

  // Toggle specific camera state
  const toggleCamera = useCallback(async (cameraId: string) => {
    const exists = localCamerasRef.current.find(c => c.id === cameraId);
    if (exists) {
      removeCamera(cameraId);
    } else {
      if (cameraId.startsWith('physical-')) {
        const devId = cameraId.replace('physical-', '');
        await addPhysicalCamera(devId);
      } else if (cameraId.startsWith('virtual-')) {
        const pat = cameraId.replace('virtual-', '') as 'clock' | 'blueprint' | 'radar';
        addVirtualCamera(pat);
      }
    }
  }, [addPhysicalCamera, addVirtualCamera, removeCamera]);

  // Send text chat message
  const sendMessage = useCallback((text: string) => {
    if (!socketRef.current || !text.trim()) return;
    socketRef.current.emit('send-chat', { text: text.trim() });
  }, []);

  // Main Socket & WebRTC setup
  useEffect(() => {
    const socketInstance: Socket = io('/', {
      transports: ['websocket', 'polling']
    });

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    const audioElem = new Audio();
    audioElem.autoplay = true;
    remoteAudioElemRef.current = audioElem;

    // Helper to configure RTCPeerConnection safely
    const setupPeerConnection = () => {
      if (pcRef.current) {
        try { pcRef.current.close(); } catch (_) {}
      }
      cameraSendersRef.current.clear();
      audioSenderRef.current = null;
      iceCandidateQueueRef.current = [];

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // Attach local audio if available
      const audioStream = localAudioStreamRef.current;
      const audioTrack = localAudioTrackRef.current;
      if (audioTrack && audioTrack.readyState === 'live') {
        const stream = audioStream || new MediaStream([audioTrack]);
        audioSenderRef.current = pc.addTrack(audioTrack, stream);
      }

      // Attach all active local cameras
      localCamerasRef.current.forEach(cam => {
        const track = cam.stream.getVideoTracks()[0];
        if (track && track.readyState === 'live') {
          const sender = pc.addTrack(track, cam.stream);
          cameraSendersRef.current.set(cam.id, sender);
        }
      });

      // ICE candidate generation
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('signal-ice-candidate', { candidate: event.candidate });
        }
      };

      // Perfect Negotiation: onnegotiationneeded
      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current = true;
          await pc.setLocalDescription();
          console.log('[WebRTC] Emitting offer from onnegotiationneeded');
          socketRef.current?.emit('signal-offer', {
            offer: pc.localDescription,
            camerasMeta: getLocalCamerasMeta()
          });
        } catch (err) {
          console.error('[WebRTC] Negotiation needed error:', err);
        } finally {
          makingOfferRef.current = false;
        }
      };

      // Track receiver (Remote cameras and audio)
      pc.ontrack = (event) => {
        console.log(`[WebRTC] Received remote track: kind=${event.track.kind}, id=${event.track.id}`);

        if (event.track.kind === 'audio') {
          const audioStream = event.streams[0] || new MediaStream([event.track]);
          setRemoteAudioStream(audioStream);
          if (remoteAudioElemRef.current) {
            remoteAudioElemRef.current.srcObject = audioStream;
            remoteAudioElemRef.current.play().catch(e => console.warn('Audio auto-play prevented:', e));
          }
          return;
        }

        if (event.track.kind === 'video') {
          const remoteStream = event.streams[0] || new MediaStream([event.track]);
          const trackId = event.track.id;
          const meta = remoteCameraMetaRef.current.find(
            m => (m.trackId && m.trackId === trackId) || (m.streamId && m.streamId === remoteStream.id)
          );

          const newRemoteCam: RemoteCameraStream = {
            id: trackId,
            cameraId: meta?.cameraId || `remote-cam-${trackId}`,
            peerId: peerInfoRef.current?.peerId || 'peer',
            peerName: peerInfoRef.current?.peerName || 'Remote Peer',
            label: meta?.label || `Remote Camera (${event.track.label || 'Stream'})`,
            type: meta?.type || 'physical',
            stream: remoteStream,
            isMuted: peerInfoRef.current?.isMuted || false
          };

          setRemoteCameras(prev => {
            const filtered = prev.filter(c => c.id !== trackId);
            return [...filtered, newRemoteCam];
          });

          event.track.onended = () => {
            console.log(`[WebRTC] Remote track ${trackId} ended`);
            setRemoteCameras(prev => prev.filter(c => c.id !== trackId));
          };
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state: ${pc.connectionState}`);
      };

      return pc;
    };

    socketInstance.on('connect', () => {
      console.log('[Socket] Connected to signaling server');
      setIsConnected(true);
      socketInstance.emit('join-room', { roomId, userName });
    });

    socketInstance.on('disconnect', () => {
      console.log('[Socket] Disconnected from signaling server');
      setIsConnected(false);
    });

    socketInstance.on('room-full', ({ roomId: fullRoomId, max }: { roomId: string; max: number }) => {
      console.warn(`[Socket] Room ${fullRoomId} is full (max ${max})`);
      setIsRoomFull(true);
    });

    // When joining the room
    socketInstance.on('room-joined', async ({ isPolite: politeRole, peers }: { roomId: string; yourId: string; isPolite: boolean; peers: any[] }) => {
      isPoliteRef.current = politeRole;
      setIsPolite(politeRole);
      console.log(`[Socket] Room joined. isPolite: ${politeRole}. Existing peers:`, peers);

      if (peers.length > 0) {
        const peer = peers[0];
        const pInfo: PeerInfo = {
          peerId: peer.peerId,
          peerName: peer.peerName,
          isPolite: peer.isPolite,
          isMuted: peer.isMuted,
          cameras: peer.cameras || []
        };
        peerInfoRef.current = pInfo;
        setPeerInfo(pInfo);
        remoteCameraMetaRef.current = peer.cameras || [];
        setupPeerConnection();
      }
    });

    // When another peer joins
    socketInstance.on('peer-joined', ({ peerId, peerName, isPolite: remoteIsPolite }: { peerId: string; peerName: string; isPolite: boolean }) => {
      console.log(`[Socket] Peer joined: ${peerName} (${peerId}), remote isPolite: ${remoteIsPolite}`);
      const pInfo: PeerInfo = {
        peerId,
        peerName,
        isPolite: remoteIsPolite,
        isMuted: false,
        cameras: []
      };
      peerInfoRef.current = pInfo;
      setPeerInfo(pInfo);

      // Existing peer (impolite initiator) prepares connection and sends offer
      setupPeerConnection();
    });

    // Signaling: Handle WebRTC Offer
    socketInstance.on('signal-offer', async ({ senderId, offer, camerasMeta }) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (camerasMeta) {
        updateRemoteCameraMeta(camerasMeta);
      }

      try {
        const readyForOffer =
          !makingOfferRef.current &&
          (pc.signalingState === 'stable' || isSettingRemoteAnswerPendingRef.current);
        const offerCollision = !readyForOffer;

        ignoreOfferRef.current = !isPoliteRef.current && offerCollision;
        if (ignoreOfferRef.current) {
          console.log('[WebRTC] Glare collision: Impolite peer ignoring offer');
          return;
        }

        // Polite peer yields: roll back local offer if in have-local-offer
        if (offerCollision && isPoliteRef.current) {
          console.log('[WebRTC] Glare collision: Polite peer rolling back local offer');
          if (pc.signalingState === 'have-local-offer') {
            try {
              await pc.setLocalDescription({ type: 'rollback' });
            } catch (e) {
              console.warn('[WebRTC] Rollback error:', e);
            }
          }
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any queued ICE candidates
        while (iceCandidateQueueRef.current.length > 0) {
          const cand = iceCandidateQueueRef.current.shift();
          if (cand) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('[WebRTC] Error adding queued ICE candidate:', e);
            }
          }
        }

        if (offer.type === 'offer') {
          await pc.setLocalDescription();
          console.log('[WebRTC] Sending answer back to', senderId);
          socketInstance.emit('signal-answer', {
            targetId: senderId,
            answer: pc.localDescription,
            camerasMeta: getLocalCamerasMeta()
          });
        }
      } catch (err) {
        console.error('[WebRTC] Error handling signal-offer:', err);
      }
    });

    // Signaling: Handle WebRTC Answer
    socketInstance.on('signal-answer', async ({ answer, camerasMeta }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (camerasMeta) {
          updateRemoteCameraMeta(camerasMeta);
        }
        isSettingRemoteAnswerPendingRef.current = true;
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        isSettingRemoteAnswerPendingRef.current = false;

        // Process any queued ICE candidates
        while (iceCandidateQueueRef.current.length > 0) {
          const cand = iceCandidateQueueRef.current.shift();
          if (cand) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('[WebRTC] Error adding queued ICE candidate:', e);
            }
          }
        }
      } catch (err) {
        console.error('[WebRTC] Error handling signal-answer:', err);
      } finally {
        isSettingRemoteAnswerPendingRef.current = false;
      }
    });

    // Signaling: Handle ICE Candidate
    socketInstance.on('signal-ice-candidate', async ({ candidate }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (!pc.remoteDescription || isSettingRemoteAnswerPendingRef.current) {
          iceCandidateQueueRef.current.push(candidate);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        if (!ignoreOfferRef.current) {
          console.warn('[WebRTC] Error adding ICE candidate:', err);
        }
      }
    });

    // Peer Camera Updated
    socketInstance.on('peer-camera-updated', ({ cameras }: { peerId: string; cameras: CameraMeta[] }) => {
      console.log('[Socket] peer-camera-updated:', cameras);
      updateRemoteCameraMeta(cameras);
    });

    // Peer Mic Updated
    socketInstance.on('peer-mic-updated', ({ isMuted: remoteMuted }: { peerId: string; isMuted: boolean }) => {
      setPeerInfo(prev => prev ? { ...prev, isMuted: remoteMuted } : null);
      if (peerInfoRef.current) peerInfoRef.current.isMuted = remoteMuted;
      setRemoteCameras(prev => prev.map(rc => ({ ...rc, isMuted: remoteMuted })));
    });

    // Chat Message
    socketInstance.on('chat-message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
    });

    // Peer Left
    socketInstance.on('peer-left', ({ peerId, peerName }: { peerId: string; peerName: string }) => {
      console.log(`[Socket] Peer left: ${peerName} (${peerId})`);
      peerInfoRef.current = null;
      setPeerInfo(null);
      setRemoteCameras([]);
      remoteCameraMetaRef.current = [];
      setRemoteAudioStream(null);
      if (remoteAudioElemRef.current) remoteAudioElemRef.current.srcObject = null;
    });

    // WebRTC Stats Polling
    const statsInterval = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState !== 'connected') {
        setStats(null);
        return;
      }

      try {
        const statsReport = await pc.getStats();
        let rtt = 0;
        let packetsLost = 0;
        let videoBitrate = 0;
        let fps = 30;
        let resolution = '1280x720';
        let audioBitrate = 0;

        statsReport.forEach(report => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            packetsLost += report.packetsLost || 0;
            if (report.framesPerSecond) fps = Math.round(report.framesPerSecond);
            if (report.frameWidth && report.frameHeight) {
              resolution = `${report.frameWidth}x${report.frameHeight}`;
            }
          }
        });

        setStats({
          rtt,
          packetsLost,
          videoBitrate,
          resolution,
          fps,
          audioBitrate
        });
      } catch (e) {
        // ignore stats errors
      }
    }, 2000);

    return () => {
      clearInterval(statsInterval);
      socketInstance.disconnect();
      socketRef.current = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      // Stop all virtual instances
      virtualCamInstancesRef.current.forEach(v => v.stop());
      virtualCamInstancesRef.current.clear();
      // Stop all local cameras
      localCamerasRef.current.forEach(cam => cam.stream.getTracks().forEach(t => t.stop()));
      localCamerasRef.current = [];
      // Stop audio
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current = null;
      }
      if (remoteAudioElemRef.current) {
        remoteAudioElemRef.current.srcObject = null;
        remoteAudioElemRef.current = null;
      }
    };
  }, [roomId, userName, getLocalCamerasMeta, updateRemoteCameraMeta]);

  return {
    socket,
    isConnected,
    isRoomFull,
    peerInfo,
    isPolite,
    localAudioStream,
    remoteAudioStream,
    isMuted,
    toggleMute,
    initAudio,
    localCameras,
    remoteCameras,
    availableVideoDevices,
    refreshDevices,
    addPhysicalCamera,
    addVirtualCamera,
    addScreenShare,
    removeCamera,
    toggleCamera,
    chatMessages,
    sendMessage,
    stats
  };
}
