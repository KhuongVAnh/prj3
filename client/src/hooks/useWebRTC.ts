/**
 * ============================================================================
 * MODULE: CLIENT HOOKS - TRÁI TIM XỬ LÝ WEBRTC ĐA CAMERA (useWebRTC)
 * ============================================================================
 * Hook này quản lý toàn bộ vòng đời kết nối WebRTC chuẩn 1.0 (Unified Plan)
 * và cơ chế W3C Perfect Negotiation để phát nhiều camera cùng lúc:
 *
 * 1. QUẢN LÝ KẾT NỐI WEBRTC P2P:
 *    - Khởi tạo RTCPeerConnection duy nhất với danh sách máy chủ STUN của Google.
 *    - Thu thập và chuyển tiếp ứng viên mạng ICE Candidates qua Socket.io.
 *    - Giải quyết triệt để xung đột đàm phán tức thời (Glare Collision) bằng
 *      chuẩn W3C Perfect Negotiation:
 *      * Impolite Peer: Giữ nguyên Offer của mình, bỏ qua Offer đối phương khi va chạm.
 *      * Polite Peer: Tự động rollback trạng thái 'have-local-offer' về 'stable'
 *        và chấp nhận Offer của đối phương để cuộc gọi không bị đứt.
 *
 * 2. PHÁT NHIỀU CAMERA ĐỒNG THỜI TRÊN 1 KẾT NỐI (MULTI-TRACK):
 *    - Cho phép bật cùng lúc nhiều camera vật lý + camera ảo + chia sẻ màn hình.
 *    - Mỗi camera tương ứng với 1 RTCRtpSender độc lập trong RTCPeerConnection.
 *    - Tự động bắt sự kiện 'onnegotiationneeded' để tạo Offer tái đàm phán động
 *      khi thêm/bớt camera mà KHÔNG làm gián đoạn cuộc gọi.
 *
 * 3. ĐỒNG BỘ METADATA CAMERA:
 *    - Gửi kèm danh sách thông tin (tên nhãn, trackId, streamId, loại camera) qua Signaling.
 *    - Phía nhận tự động ghép nối đúng luồng video vào đúng khung hiển thị trên UI.
 *
 * 4. ĐO LƯỜNG THÔNG SỐ MẠNG (METRICS POLLING):
 *    - Định kỳ 2 giây gọi pc.getStats() để đo độ trễ RTT, packet loss, FPS, độ phân giải.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  CameraSource,
  RemoteCameraStream,
  CameraMeta,
  PeerInfo,
  ChatMessage,
  WebRTCStats,
  VideoQualityMode,
  WhiteboardState,
  WhiteboardStroke,
  WhiteboardLiveDraw,
  WhiteboardPoint,
  WhiteboardTool
} from '../types';
import { ICE_SERVERS } from '../constants/webrtc';

export function useWebRTC(roomId: string, userName: string, initialAudio: boolean = true) {
  // Trạng thái kết nối WebSocket tới Signaling Server
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isRoomFull, setIsRoomFull] = useState<boolean>(false);

  // Thông tin về người đối diện trong phòng họp (Remote Peer)
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);

  // Vai trò Perfect Negotiation của máy cục bộ (true: nhường nhịn, false: chủ động)
  const [isPolite, setIsPolite] = useState<boolean>(false);

  // Trạng thái media âm thanh của máy cục bộ
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(!initialAudio);

  // Danh sách các luồng camera đang hoạt động
  const [localCameras, setLocalCameras] = useState<CameraSource[]>([]);       // Camera máy mình đang phát
  const [remoteCameras, setRemoteCameras] = useState<RemoteCameraStream[]>([]); // Camera nhận được từ đối phương
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]); // Danh sách webcam phần cứng quét được

  // Tin nhắn chat và thông số đo kiểm mạng
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [stats, setStats] = useState<WebRTCStats | null>(null);
  const [hasTurnServer, setHasTurnServer] = useState<boolean>(false);
  const hasTurnServerRef = useRef<boolean>(false);
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addDebugLog = useCallback((level: 'INFO' | 'WARN' | 'ERR', message: string) => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const line = `[${ts}] [${level}] ${message}`;
    if (level === 'ERR') {
      console.error(line);
    } else if (level === 'WARN') {
      console.warn(line);
    } else {
      console.log(line);
    }
    setDebugLogs(prev => {
      const next = [...prev, line];
      return next.length > 120 ? next.slice(next.length - 120) : next;
    });
  }, []);

  // Trạng thái chất lượng phát đi hiện tại của từng camera máy mình: Map cameraId -> 'high' | 'grid' | 'low'
  const [localQualityModes, setLocalQualityModes] = useState<Record<string, VideoQualityMode>>({});

  // Trạng thái Bảng trắng chung (chỉ 1 trong 2 người được bật, cả 2 đều vẽ được)
  const [whiteboardState, setWhiteboardState] = useState<WhiteboardState>({
    isOpen: false,
    ownerId: null,
    ownerName: null,
    showGrid: false,
    strokes: []
  });
  const whiteboardLiveHandlerRef = useRef<((draw: WhiteboardLiveDraw) => void) | null>(null);
  const whiteboardStateRef = useRef<WhiteboardState>(whiteboardState);
  useEffect(() => {
    whiteboardStateRef.current = whiteboardState;
  }, [whiteboardState]);

  /**
   * CÁC THAM CHIẾU (REFS) QUẢN LÝ TÀI NGUYÊN BẤT ĐỒNG BỘ:
   * Giúp truy cập dữ liệu mới nhất trong các hàm callback WebRTC / Socket mà
   * KHÔNG kích hoạt re-render React không cần thiết.
   */
  const pcRef = useRef<RTCPeerConnection | null>(null); // Duy nhất 1 kết nối RTCPeerConnection cho toàn bộ cuộc gọi
  const socketRef = useRef<Socket | null>(null);
  const localCamerasRef = useRef<CameraSource[]>([]);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null); // Quản lý bộ phát âm thanh (Microphone)
  const isMutedRef = useRef<boolean>(!initialAudio);
  const audioInitPromiseRef = useRef<Promise<MediaStream | null> | null>(null);
  const cameraSendersRef = useRef<Map<string, RTCRtpSender>>(new Map()); // Quản lý các bộ phát video: Map cameraId -> RTCRtpSender
  const remoteAudioElemRef = useRef<HTMLAudioElement | null>(null);
  const peerInfoRef = useRef<PeerInfo | null>(null);

  // Các biến cờ & bộ đếm trạng thái phục vụ W3C Perfect Negotiation và cơ chế fallback TURN theo epoch
  const clientIdRef = useRef<string>(
    // ID cố định theo tab trình duyệt: giúp server nhận ra cùng một người nếu Socket.IO reconnect lại
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const isPoliteRef = useRef<boolean>(false); // true = người vào sau (nhường khi va chạm Glare), false = người vào trước (chủ động)
  const makingOfferRef = useRef<boolean>(false); // Cờ đang chạy pc.setLocalDescription() tạo Offer cục bộ
  const makingOfferPromiseRef = useRef<Promise<void> | null>(null); // Promise tạo Offer hiện tại để đồng bộ hóa khi có Offer đến đúng lúc
  const signalingQueueRef = useRef<Promise<void>>(Promise.resolve()); // Hàng đợi tuần tự cho Offer/Answer/Reconnect để không bao giờ chạy đè nhau
  const ignoreOfferRef = useRef<boolean>(false); // Cờ Impolite đang bỏ qua Offer va chạm (và cả ICE candidate ăn theo Offer đó)
  const isSettingRemoteAnswerPendingRef = useRef<boolean>(false); // Đang trong lúc áp dụng Remote Answer
  const processingRemoteDescriptionRef = useRef<boolean>(false); // Khóa tạm onsignalingstatechange lúc áp SDP, tránh bắn Offer thừa giữa chừng
  const iceCandidateQueueRef = useRef<Array<{ epoch: number; candidate: RTCIceCandidateInit }>>([]); // Hàng đợi tạm cho ICE candidate đến sớm, gắn kèm epoch
  const pendingOfferRef = useRef<{
    senderId: string;
    offer: RTCSessionDescriptionInit;
    camerasMeta?: CameraMeta[];
    epoch?: number;
  } | null>(null); // Lưu tạm Offer đến trước khi RTCPeerConnection khởi tạo xong
  const remoteCameraMetaRef = useRef<CameraMeta[]>([]); // Bảng metadata tên/loại camera của người bên kia
  const remotePinnedCameraIdRef = useRef<string | null>(null); // ID camera máy mình mà đối phương đang ghim tiêu điểm
  const iceServersConfigRef = useRef<RTCConfiguration>(ICE_SERVERS); // Cấu hình STUN/TURN tải từ /api/ice-servers
  const iceFetchPromiseRef = useRef<Promise<void> | null>(null); // Promise chờ tải xong /api/ice-servers trước khi tạo PeerConnection
  const pcInitPromiseRef = useRef<Promise<RTCPeerConnection | null> | null>(null); // Promise chờ setupPeerConnection() xong trước khi xử lý Offer/Answer
  const pcSessionIdRef = useRef<number>(0); // Số thứ tự nội bộ của RTCPeerConnection trên máy này (bỏ qua callback từ PC cũ)
  const activeEpochRef = useRef<number>(1); // Phiên đàm phán đồng bộ từ server (mọi gói Offer/Answer/ICE khác epoch đều bị loại)
  const relayStageRef = useRef<'all' | 'relay-tls' | 'relay-all'>('all'); // Tầng đường truyền hiện tại: all -> relay-tls (TURNS 443) -> relay-all
  const reconnectRequestedEpochRef = useRef<number>(0); // Đánh dấu epoch gần nhất máy này đã gửi yêu cầu nâng tầng TURN (tránh spam trùng)
  const stallFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Bộ hẹn giờ (chỉ chạy phía Impolite) phát hiện kẹt ICE/DTLS
  const lastLoggedDtlsStateRef = useRef<string | null>(null); // Trạng thái DTLS gần nhất đã ghi log (tránh in lặp mỗi 2s)
  const politeGraceUntilRef = useRef<number>(0); // Mốc thời gian phía Polite hoãn gửi Offer đầu tiên (1.8s) để nhường Impolite mở màn, tránh Glare
  const politeGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Timer đánh thức Polite gửi Offer nếu quá 1.8s vẫn chưa thấy Offer từ Impolite

  // Giữ cho peerInfoRef luôn đồng bộ giá trị mới nhất
  useEffect(() => {
    peerInfoRef.current = peerInfo;
  }, [peerInfo]);

  /**
   * Quét và lấy danh sách tất cả các thiết bị videoinput (webcam vật lý) cắm vào máy
   */
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableVideoDevices(videoDevices);
      return videoDevices;
    } catch (err) {
      console.warn('[Devices] Lỗi khi quét danh sách thiết bị camera:', err);
      return [];
    }
  }, []);

  /**
   * Đóng gói thông tin Metadata của các camera cục bộ đang phát:
   * Bao gồm cameraId, trackId, streamId, tên nhãn hiển thị và loại camera.
   * Metadata này sẽ được gửi kèm trong Offer/Answer để máy đối phương biết camera nào là camera nào.
   */
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

  /**
   * Phát sóng cập nhật trạng thái danh sách camera sang người bên kia qua WebSocket
   */
  const broadcastCameraState = useCallback(() => {
    if (!socketRef.current) return;
    const meta = getLocalCamerasMeta();
    socketRef.current.emit('camera-state-update', { cameras: meta });
  }, [getLocalCamerasMeta]);

  /**
   * Cập nhật Metadata camera nhận từ đối phương và đối chiếu (Reconcile) với các luồng video đang nhận:
   * Giúp tự động gán đúng tên nhãn ("Webcam chính", "Camera tài liệu", "Screen Share")
   * và xóa bỏ các khung hình của những camera mà đối phương vừa tắt.
   */
  const updateRemoteCameraMeta = useCallback((cameras: CameraMeta[]) => {
    remoteCameraMetaRef.current = cameras;
    setRemoteCameras(prev => {
      // Nếu đối phương đã tắt hết camera, làm rỗng danh sách
      if (cameras.length === 0) return [];

      const activeStreamIds = new Set(cameras.map(c => c.streamId).filter(Boolean));
      const activeTrackIds = new Set(cameras.map(c => c.trackId).filter(Boolean));
      const activeCameraIds = new Set(cameras.map(c => c.cameraId).filter(Boolean));

      // Lọc bỏ những track đã kết thúc hoặc không còn nằm trong metadata của đối phương
      const filtered = prev.filter(rc => {
        const track = rc.stream.getVideoTracks()[0];
        if (track && track.readyState === 'ended') return false;

        const matches =
          activeTrackIds.has(rc.id) ||
          activeStreamIds.has(rc.stream.id) ||
          activeCameraIds.has(rc.cameraId);

        // Giữ lại nếu khớp thông tin metadata
        return matches || activeCameraIds.size === 0;
      });

      // Cập nhật lại nhãn tên và kiểu camera mới nhất cho từng ô hiển thị
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

  /**
   * Khởi tạo luồng âm thanh từ Microphone:
   * Bật các thuật toán lọc tạp âm, chống vọng âm (echo cancellation, noise suppression).
   */
  const initAudio = useCallback(async () => {
    if (audioInitPromiseRef.current) {
      return audioInitPromiseRef.current;
    }

    const promise = (async () => {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true, // Chống tiếng vang vọng
            noiseSuppression: true, // Lọc tiếng ồn môi trường
            autoGainControl: true   // Tự động cân bằng âm lượng
          },
          video: false
        });

        // Nếu hook đã unmount trong lúc chờ xin quyền micro thì giải phóng ngay tránh rò rỉ track
        if (!socketRef.current) {
          audioStream.getTracks().forEach(t => t.stop());
          return null;
        }

        // Dừng luồng micro cũ (nếu có) trước khi thay thế
        if (localAudioStreamRef.current) {
          localAudioStreamRef.current.getAudioTracks().forEach(t => t.stop());
        }
        if (localAudioTrackRef.current && localAudioTrackRef.current.readyState !== 'ended') {
          localAudioTrackRef.current.stop();
        }

        const track = audioStream.getAudioTracks()[0] || null;
        if (track) {
          track.enabled = !isMutedRef.current;
        }

        localAudioStreamRef.current = audioStream;
        localAudioTrackRef.current = track;
        setLocalAudioStream(audioStream);

        // Nếu đã có kết nối RTCPeerConnection thì nạp/thay thế track âm thanh ngay
        const pc = pcRef.current;
        if (pc && pc.signalingState !== 'closed' && track) {
          const existingSender =
            audioSenderRef.current && pc.getSenders().includes(audioSenderRef.current)
              ? audioSenderRef.current
              : pc.getSenders().find(s => s.track?.kind === 'audio') || null;

          if (existingSender) {
            await existingSender.replaceTrack(track);
            audioSenderRef.current = existingSender;
          } else {
            audioSenderRef.current = pc.addTrack(track, audioStream);
          }
        }
        return audioStream;
      } catch (err) {
        console.warn('[Audio] Không thể lấy quyền truy cập micro:', err);
        if (!localAudioTrackRef.current) {
          isMutedRef.current = true;
          setIsMuted(true);
        }
        return null;
      } finally {
        audioInitPromiseRef.current = null;
      }
    })();

    audioInitPromiseRef.current = promise;
    return promise;
  }, []);

  /**
   * Đồng bộ thuộc tính enabled trên toàn bộ audio track cục bộ và RTCRtpSender
   */
  const syncAudioTracksEnabled = useCallback((enabled: boolean) => {
    if (localAudioTrackRef.current) {
      localAudioTrackRef.current.enabled = enabled;
    }
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = enabled;
      });
    }
    if (audioSenderRef.current?.track) {
      audioSenderRef.current.track.enabled = enabled;
    }
    if (pcRef.current && pcRef.current.signalingState !== 'closed') {
      pcRef.current.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = enabled;
        }
      });
    }
  }, []);

  /**
   * Bật/Tắt Micro (Mute/Unmute) và thông báo trạng thái cho người bên kia.
   * Hỗ trợ cả trường hợp người dùng vào phòng với mic đang tắt (chưa khởi tạo stream)
   * rồi bấm bật mic lại sau đó.
   */
  const toggleMute = useCallback(async () => {
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);

    // Áp dụng ngay lập tức cho mọi audio track hiện có (nếu đang có mic)
    syncAudioTracksEnabled(!nextMuted);

    // Nếu người dùng bấm BẬT mic mà chưa có track live (do vào phòng tắt mic từ Lobby hoặc mất quyền) -> xin lại mic
    if (!nextMuted && (!localAudioTrackRef.current || localAudioTrackRef.current.readyState === 'ended')) {
      const stream = await initAudio();
      if (!stream || !localAudioTrackRef.current) {
        // Không mở được mic (chặn quyền hoặc thiếu thiết bị) -> giữ trạng thái Muted
        isMutedRef.current = true;
        setIsMuted(true);
        socketRef.current?.emit('mic-state-update', { isMuted: true });
        return;
      }
      syncAudioTracksEnabled(!isMutedRef.current);
    }

    if (socketRef.current) {
      socketRef.current.emit('mic-state-update', { isMuted: isMutedRef.current });
    }
  }, [initAudio, syncAudioTracksEnabled]);

  /**
   * ÁP DỤNG THÔNG SỐ CHẤT LƯỢNG MÃ HÓA (BITRATE / SCALE / FPS) CHO SENDER:
   * - 'high': Giữ nguyên độ phân giải gốc (1080p FHD), 30 FPS, 3.5 Mbps (Chỉ khi được GHIM tiêu điểm)
   * - 'grid': Tự động chia tỉ lệ về 720p HD (nếu nguồn > 720p), 24 FPS, 1.2 Mbps (Trạng thái lưới mặc định - chống nóng máy)
   * - 'low':  Thu nhỏ về ~360p, 15 FPS, 300 kbps (Ô thu nhỏ phụ khi một ô khác đang được ghim)
   */
  const applyEncodingQuality = useCallback(async (cameraId: string, mode: VideoQualityMode) => {
    const sender = cameraSendersRef.current.get(cameraId);
    if (!sender) return;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      const trackHeight = sender.track?.getSettings?.().height || 0;

      if (mode === 'high') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 3_500_000;
        params.encodings[0].maxFramerate = 30;
        params.degradationPreference = 'maintain-resolution';
      } else if (mode === 'grid') {
        const gridScale = trackHeight > 720 ? Math.max(1.0, trackHeight / 720) : 1.0;
        params.encodings[0].scaleResolutionDownBy = Number(gridScale.toFixed(2));
        params.encodings[0].maxBitrate = 1_200_000;
        params.encodings[0].maxFramerate = 24;
        params.degradationPreference = 'balanced';
      } else {
        const lowScale = trackHeight > 360 ? Math.max(2.0, trackHeight / 360) : 2.0;
        params.encodings[0].scaleResolutionDownBy = Number(lowScale.toFixed(2));
        params.encodings[0].maxBitrate = 300_000;
        params.encodings[0].maxFramerate = 15;
        params.degradationPreference = 'maintain-framerate';
      }

      await sender.setParameters(params);
      setLocalQualityModes(prev => ({ ...prev, [cameraId]: mode }));
      console.log(`[WebRTC Quality] Đã áp dụng chất lượng [${mode.toUpperCase()}] cho camera ${cameraId}`);
    } catch (err) {
      console.warn(`[WebRTC Quality] Lỗi khi đổi thông số chất lượng camera ${cameraId}:`, err);
    }
  }, []);

  /**
   * BẬT CAMERA VẬT LÝ VỚI THUẬT TOÁN FALLBACK ĐA TẦNG:
   * Giải quyết triệt để lỗi nghẽn băng thông Bus USB 2.0 (NotReadableError)
   * khi kích hoạt đồng thời 2 webcam cắm chung một USB Host Controller.
   */
  const addPhysicalCamera = useCallback(async (deviceId?: string, customLabel?: string) => {
    try {
      let stream: MediaStream | null = null;
      let lastError: any = null;

      if (deviceId) {
        /**
         * Thử tuần tự 6 tầng cấu hình (Progressive Constraints Fallback):
         * - Tầng 1: Đúng deviceId với độ phân giải Full HD 1080p (1920x1080) sắc nét nhất.
         * - Tầng 2: Hạ xuống 720p (1280x720) nếu camera không hỗ trợ 1080p.
         * - Tầng 3: Hạ xuống 480p (640x480) - giảm băng thông bus USB xuống còn ~147 Mbps.
         * - Tầng 4: Hạ xuống 360p (480x360) siêu nhẹ (~82 Mbps).
         * - Tầng 5: Bỏ giới hạn độ phân giải để camera tự đàm phán nén phần cứng (MJPEG/H.264).
         * - Tầng 6: Truyền trực tiếp chuỗi deviceId cho các trình duyệt/driver đời cũ.
         */
        const attempts: MediaStreamConstraints[] = [
          { video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
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
              console.log('[Camera] Mở thành công camera vật lý với cấu hình:', candidate);
              break;
            }
          } catch (err: any) {
            lastError = err;
            console.warn('[Camera] Thử cấu hình thất bại với device', deviceId, err.name, err.message);
          }
        }

        // Nếu cả 6 cấu hình exact đều thất bại, thử sang cấu hình 'ideal' làm phương án cứu cánh cuối cùng
        if (!stream) {
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { ideal: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
              audio: false
            });
            const fallbackTrack = fallbackStream.getVideoTracks()[0];
            const fallbackDeviceId = fallbackTrack.getSettings().deviceId;

            // KIỂM TRA CHỐNG TRÁO THIẾT BỊ: Đảm bảo trình duyệt không tự ý trả về camera ĐÃ ĐANG CHẠY!
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
            console.error('[Camera] Mọi nỗ lực mở camera đều thất bại:', err);
            throw lastError || err;
          }
        }
      } else {
        // Nếu không chỉ định deviceId cụ thể, mở camera mặc định với fallback phân giải ưu tiên 1080p
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
          });
        } catch (_) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false
            });
          } catch (__) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        }
      }

      if (!stream) {
        throw lastError || new Error('Không thể thu nhận luồng video từ camera.');
      }

      // Nếu người dùng đã rời phòng trong lúc chờ getUserMedia trả về -> dừng track ngay tránh rò rỉ camera
      if (!socketRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return null;
      }

      const track = stream.getVideoTracks()[0];
      const settingsDeviceId = track.getSettings().deviceId;
      const targetDeviceId = deviceId || settingsDeviceId || `cam-${Date.now()}`;
      const cameraId = `physical-${targetDeviceId}`;

      // Kiểm tra xem camera này đã được bật trong danh sách chưa
      const exists = localCamerasRef.current.find(c =>
        c.id === cameraId ||
        (deviceId && c.deviceId === deviceId) ||
        (settingsDeviceId && c.deviceId === settingsDeviceId)
      );

      if (exists) {
        console.log(`[Camera] Camera ${cameraId} đã đang hoạt động.`);
        // Dừng track mới mở để tránh rò rỉ khóa phần cứng (hardware lock leak)
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

      // Cập nhật mảng localCamerasRef NGAY LẬP TỨC trước khi addTrack
      // để sự kiện onnegotiationneeded có sẵn metadata chính xác
      localCamerasRef.current = [...localCamerasRef.current, newCam];
      setLocalCameras(localCamerasRef.current);

      // Nạp track của camera vào kết nối RTCPeerConnection duy nhất
      if (pcRef.current && pcRef.current.signalingState !== 'closed') {
        const sender = pcRef.current.addTrack(track, stream);
        cameraSendersRef.current.set(cameraId, sender); // Lưu lại bộ phát để sau này gỡ bỏ khi tắt camera
        // Khởi tạo chất lượng ban đầu: không có ghim -> 'grid' (720p), đang ghim đúng cam này -> 'high' (1080p), ghim cam khác -> 'low' (360p)
        const initialQuality: VideoQualityMode = !remotePinnedCameraIdRef.current
          ? 'grid'
          : remotePinnedCameraIdRef.current === cameraId
          ? 'high'
          : 'low';
        applyEncodingQuality(cameraId, initialQuality);
      }

      refreshDevices();
      broadcastCameraState();
      return newCam;
    } catch (err) {
      console.error('[Camera] Không thể thêm camera vật lý:', err);
      throw err;
    }
  }, [applyEncodingQuality, broadcastCameraState, refreshDevices]);

  /**
   * TẮT MỘT CAMERA (Vật lý hoặc Màn hình):
   * Gỡ bỏ RTCRtpSender tương ứng ra khỏi RTCPeerConnection và giải phóng tài nguyên phần cứng.
   */
  const removeCamera = useCallback((cameraId: string) => {
    // 1. Dừng các track phần cứng để tắt đèn camera
    const target = localCamerasRef.current.find(c => c.id === cameraId);
    if (target) {
      target.stream.getTracks().forEach(t => t.stop());
    }

    // 2. Cập nhật danh sách camera cục bộ
    localCamerasRef.current = localCamerasRef.current.filter(c => c.id !== cameraId);
    setLocalCameras(localCamerasRef.current);

    // 3. Gỡ bỏ bộ phát (Sender) ra khỏi RTCPeerConnection (Kích hoạt onnegotiationneeded để đối phương xóa ô video)
    if (pcRef.current) {
      const sender = cameraSendersRef.current.get(cameraId);
      if (sender) {
        try {
          pcRef.current.removeTrack(sender);
        } catch (e) {
          console.warn('[WebRTC] Lỗi khi gỡ track sender:', e);
        }
        cameraSendersRef.current.delete(cameraId);
        setLocalQualityModes(prev => {
          const next = { ...prev };
          delete next[cameraId];
          return next;
        });
      }
    }

    // 5. Báo cho đối phương biết camera này đã tắt
    broadcastCameraState();
  }, [broadcastCameraState]);

  /**
   * BẬT CHIA SẺ MÀN HÌNH NHƯ MỘT LUỒNG CAMERA PHỤ:
   * Sử dụng navigator.mediaDevices.getDisplayMedia() để lấy hình ảnh desktop/tab trình duyệt.
   */
  const addScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });

      // Nếu người dùng đã rời phòng trong lúc chờ chọn màn hình -> dừng track ngay
      if (!socketRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return null;
      }
      const track = stream.getVideoTracks()[0];
      const cameraId = `screen-${Date.now()}`;

      const newCam: CameraSource = {
        id: cameraId,
        label: 'Shared Screen',
        type: 'screen',
        stream,
        active: true
      };

      // Tự động gỡ camera khi người dùng bấm "Dừng chia sẻ" trên thanh công cụ hệ điều hành
      track.onended = () => {
        removeCamera(cameraId);
      };

      localCamerasRef.current = [...localCamerasRef.current, newCam];
      setLocalCameras(localCamerasRef.current);

      if (pcRef.current && pcRef.current.signalingState !== 'closed') {
        const sender = pcRef.current.addTrack(track, stream);
        cameraSendersRef.current.set(cameraId, sender);
        const initialQuality: VideoQualityMode = !remotePinnedCameraIdRef.current
          ? 'grid'
          : remotePinnedCameraIdRef.current === cameraId
          ? 'high'
          : 'low';
        applyEncodingQuality(cameraId, initialQuality);
      }

      broadcastCameraState();
      return newCam;
    } catch (err) {
      console.warn('[ScreenShare] Người dùng hủy hoặc chia sẻ màn hình thất bại:', err);
      return null;
    }
  }, [applyEncodingQuality, broadcastCameraState, removeCamera]);

  /**
   * Chuyển đổi trạng thái Bật/Tắt một camera theo ID
   */
  const toggleCamera = useCallback(async (cameraId: string) => {
    const exists = localCamerasRef.current.find(c => c.id === cameraId);
    if (exists) {
      removeCamera(cameraId);
    } else {
      if (cameraId.startsWith('physical-')) {
        const devId = cameraId.replace('physical-', '');
        await addPhysicalCamera(devId);
      }
    }
  }, [addPhysicalCamera, removeCamera]);

  /**
   * XỬ LÝ TÍN HIỆU TIÊU ĐIỂM (PIN) TỪ ĐỐI PHƯƠNG:
   * - Nếu đối phương ghim 1 camera của mình: Camera đó được nâng lên High (1080p), tất cả camera khác hạ xuống Low (360p).
   * - Nếu đối phương bỏ ghim (null): Tất cả camera của mình chuyển về Grid (720p) để tránh nóng máy.
   * - Nếu đối phương ghim camera của chính họ: Tất cả camera của mình hạ xuống Low (360p).
   */
  const handleRemotePinUpdate = useCallback((pinnedCameraId: string | null) => {
    remotePinnedCameraIdRef.current = pinnedCameraId;
    console.log(`[WebRTC Quality] Đối phương cập nhật ghim camera: ${pinnedCameraId}`);

    localCamerasRef.current.forEach(cam => {
      if (!pinnedCameraId) {
        // Không ai bị ghim: Tất cả về Grid (720p) chống quá nhiệt
        applyEncodingQuality(cam.id, 'grid');
      } else if (cam.id === pinnedCameraId) {
        // Đúng camera máy mình đang được ghim: Nâng lên High (1080p)
        applyEncodingQuality(cam.id, 'high');
      } else {
        // Camera không được ghim: Hạ xuống Low (360p) để giảm tải bên nhận
        applyEncodingQuality(cam.id, 'low');
      }
    });
  }, [applyEncodingQuality]);

  /**
   * Gửi thông báo cho đối phương biết mình đang ghim camera nào để bên đối phương tự điều chỉnh chất lượng phát
   */
  const sendPinStateUpdate = useCallback((pinnedCameraId: string | null) => {
    if (socketRef.current) {
      console.log(`[Socket] Bắn tín hiệu ghim camera: ${pinnedCameraId}`);
      socketRef.current.emit('pin-state-update', { pinnedCameraId });
    }
  }, []);

  /**
   * Gửi tin nhắn văn bản tức thời trong phòng qua Signaling Server
   */
  const sendMessage = useCallback((text: string) => {
    if (!socketRef.current || !text.trim()) return;
    socketRef.current.emit('send-chat', { text: text.trim() });
  }, []);

  /**
   * Bật/Tắt Bảng trắng chung (chỉ 1 người được bật tại một thời điểm)
   */
  const toggleWhiteboard = useCallback(() => {
    const sock = socketRef.current;
    if (!sock) return;

    const current = whiteboardStateRef.current;
    if (current.isOpen) {
      // Chỉ người đã bật bảng mới được phép tắt
      if (current.ownerId && current.ownerId !== sock.id) {
        return;
      }
      sock.emit('whiteboard-toggle', { isOpen: false });
    } else {
      sock.emit('whiteboard-toggle', { isOpen: true });
    }
  }, []);

  const emitWhiteboardLive = useCallback(
    (payload: {
      strokeId: string;
      tool: WhiteboardTool;
      color: string;
      size: number;
      points: WhiteboardPoint[];
    }) => {
      socketRef.current?.emit('whiteboard-draw-live', payload);
    },
    []
  );

  const commitWhiteboardStroke = useCallback(
    (stroke: Omit<WhiteboardStroke, 'authorId' | 'authorName'>) => {
      const sock = socketRef.current;
      const fullStroke: WhiteboardStroke = {
        ...stroke,
        authorId: sock?.id || 'local',
        authorName: userName
      };

      setWhiteboardState(prev => ({
        ...prev,
        strokes: [...prev.strokes, fullStroke]
      }));

      sock?.emit('whiteboard-stroke-commit', stroke);
    },
    [userName]
  );

  const undoWhiteboard = useCallback(() => {
    socketRef.current?.emit('whiteboard-undo');
  }, []);

  const clearWhiteboard = useCallback(() => {
    socketRef.current?.emit('whiteboard-clear');
  }, []);

  const toggleWhiteboardGrid = useCallback(() => {
    const nextGrid = !whiteboardStateRef.current.showGrid;
    setWhiteboardState(prev => ({ ...prev, showGrid: nextGrid }));
    socketRef.current?.emit('whiteboard-grid-toggle', { showGrid: nextGrid });
  }, []);

  const registerWhiteboardLiveHandler = useCallback(
    (handler: ((draw: WhiteboardLiveDraw) => void) | null) => {
      whiteboardLiveHandlerRef.current = handler;
    },
    []
  );

  /**
   * VÒNG ĐỜI KẾT NỐI WEBSOCKET & WEBRTC:
   * Quản lý bắt tay tín hiệu, đàm phán W3C Perfect Negotiation và đón nhận các luồng media.
   */
  useEffect(() => {
    const socketInstance: Socket = io('/', {
      transports: ['polling', 'websocket']
    });

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    const audioElem = new Audio();
    audioElem.autoplay = true;
    remoteAudioElemRef.current = audioElem;

    // Tải trước cấu hình STUN/TURN từ backend (/api/ice-servers) ngay khi vào phòng
    const fetchIceConfig = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch('/api/ice-servers', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
            iceServersConfigRef.current = {
              iceServers: data.iceServers,
              iceCandidatePoolSize: 10
            };
            hasTurnServerRef.current = Boolean(data.hasTurn);
            setHasTurnServer(Boolean(data.hasTurn));
            const serverUrls = data.iceServers.flatMap((s: any) =>
              Array.isArray(s.urls) ? s.urls : [s.urls]
            );
            addDebugLog(
              'INFO',
              `ICE config loaded: provider=${data.provider}, hasTurn=${Boolean(data.hasTurn)}, urls=[${serverUrls.join(', ')}]`
            );
          }
        } else {
          addDebugLog('WARN', `/api/ice-servers HTTP ${res.status}`);
        }
      } catch (err: any) {
        addDebugLog('WARN', `Lỗi tải /api/ice-servers (${err?.name || 'Error'}: ${err?.message || err}), dùng STUN mặc định`);
      }
    };
    iceFetchPromiseRef.current = fetchIceConfig();

    /**
     * Hủy toàn bộ bộ hẹn giờ liên quan tới đàm phán/fallback (tránh timer cũ bắn nhầm vào phiên mới)
     */
    const clearNegotiationTimers = () => {
      if (stallFallbackTimerRef.current) {
        clearTimeout(stallFallbackTimerRef.current);
        stallFallbackTimerRef.current = null;
      }
      if (politeGraceTimerRef.current) {
        clearTimeout(politeGraceTimerRef.current);
        politeGraceTimerRef.current = null;
      }
    };

    /**
     * Đóng một RTCPeerConnection sạch sẽ, không rò rỉ tài nguyên:
     * - Gỡ sạch các event handler để PC cũ không bắn callback muộn.
     * - Dừng toàn bộ track nhận (receivers) từ đối phương.
     * - Chỉ dừng track gửi cục bộ (senders) khi người dùng thực sự rời phòng (stopLocalSenderTracks=true);
     *   còn khi chỉ tái tạo PC (đổi tầng TURN hoặc peer mới vào) thì giữ nguyên webcam cục bộ để gắn lại.
     */
    const closePeerConnectionCleanly = (
      pc: RTCPeerConnection | null,
      stopLocalSenderTracks: boolean = false
    ) => {
      if (!pc) return;
      try {
        pc.onicecandidate = null;
        pc.onicecandidateerror = null;
        pc.onnegotiationneeded = null;
        pc.onsignalingstatechange = null;
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;

        pc.getReceivers().forEach(receiver => {
          try { receiver.track?.stop(); } catch (_) {}
        });
        if (stopLocalSenderTracks) {
          pc.getSenders().forEach(sender => {
            try { sender.track?.stop(); } catch (_) {}
          });
        }
        pc.close();
      } catch (_) {}
    };

    /**
     * Dừng thẻ <audio> ẩn đang phát giọng nói của đối phương và giải phóng các audio track bên trong
     */
    const stopRemoteAudioElement = () => {
      const elem = remoteAudioElemRef.current;
      if (!elem) return;
      try {
        elem.pause();
        const stream = elem.srcObject as MediaStream | null;
        if (stream) {
          stream.getTracks().forEach(t => {
            try { t.stop(); } catch (_) {}
          });
        }
        elem.srcObject = null;
      } catch (_) {}
    };

    /**
     * Lọc danh sách ICE server theo từng tầng vượt tường lửa:
     * - 'relay-tls': Ưu tiên tuyệt đối TURNS (TLS cổng 443/5349) để giả lập HTTPS & tránh phân mảnh UDP/MTU;
     *                chỉ lùi về TURN TCP thường nếu nhà cung cấp không có URL turns:.
     * - 'relay-all': Toàn bộ máy chủ TURN (TLS + TCP + UDP) với iceTransportPolicy='relay'.
     */
    const buildRelayConfig = (stage: 'relay-tls' | 'relay-all'): RTCConfiguration => {
      const allServers = iceServersConfigRef.current.iceServers || [];

      // Hàm phụ: lọc từng entry RTCIceServer, chỉ giữ lại các URL thỏa điều kiện predicate
      const filterByRegex = (predicate: (url: string) => boolean): RTCIceServer[] =>
        allServers
          .map(entry => {
            const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
            const matched = urls.filter(u => typeof u === 'string' && predicate(u.trim()));
            if (matched.length === 0) return null;
            return { ...entry, urls: matched.length === 1 ? matched[0] : matched };
          })
          .filter(Boolean) as RTCIceServer[];

      let selectedServers: RTCIceServer[];
      if (stage === 'relay-tls') {
        // Thứ tự ưu tiên: TURNS (TLS 443/5349) -> TURN TCP -> mọi TURN -> giữ nguyên danh sách gốc
        const tlsTurn = filterByRegex(u => /^turns:/i.test(u));
        const tcpTurn = filterByRegex(u => /^turn:/i.test(u) && /transport=tcp/i.test(u));
        const anyTurn = filterByRegex(u => /^turns?:/i.test(u));
        selectedServers =
          tlsTurn.length > 0
            ? tlsTurn
            : tcpTurn.length > 0
            ? tcpTurn
            : anyTurn.length > 0
            ? anyTurn
            : allServers;
      } else {
        // Tầng dự phòng cuối: mở toàn bộ các URL TURN (UDP + TCP + TLS) nhưng vẫn ép đi qua Relay
        const anyTurn = filterByRegex(u => /^turns?:/i.test(u));
        selectedServers = anyTurn.length > 0 ? anyTurn : allServers;
      }

      return {
        iceServers: selectedServers,
        iceCandidatePoolSize: 4,
        iceTransportPolicy: 'relay'
      };
    };

    /**
     * Yêu cầu server đồng bộ nâng tầng TURN (all -> relay-tls -> relay-all) cho cả 2 peer theo epoch.
     * Mỗi epoch mỗi máy chỉ được phát yêu cầu tối đa 1 lần; server cũng chống trùng nếu cả 2 máy phát cùng lúc.
     */
    const requestRelayReconnect = (reason: string) => {
      if (!hasTurnServerRef.current || !peerInfoRef.current) return;
      const currentEpoch = activeEpochRef.current;
      if (reconnectRequestedEpochRef.current >= currentEpoch) return;

      // Xác định tầng kế tiếp trong thang dự phòng (tối đa 2 lần nâng tầng để không bao giờ lặp vô hạn)
      let nextMode: 'relay-tls' | 'relay-all' | null = null;
      if (relayStageRef.current === 'all') {
        nextMode = 'relay-tls';
      } else if (relayStageRef.current === 'relay-tls') {
        nextMode = 'relay-all';
      }

      if (!nextMode) {
        addDebugLog('ERR', `${reason} (đã thử hết các tầng TURN Relay, giữ phiên hiện tại)`);
        return;
      }

      reconnectRequestedEpochRef.current = currentEpoch;
      addDebugLog(
        'WARN',
        `${reason} -> phát signal-reconnect-relay (mode=${nextMode}, fromEpoch=${currentEpoch})`
      );
      socketInstance.emit('signal-reconnect-relay', {
        mode: nextMode,
        fromEpoch: currentEpoch
      });
    };

    /**
     * Đẩy toàn bộ các gói ICE Candidate đến sớm (đúng expectedEpoch) vào RTCPeerConnection
     * ngay sau khi đã áp dụng xong Remote Description.
     */
    const flushIceCandidateQueue = async (pc: RTCPeerConnection, expectedEpoch: number) => {
      const pending = iceCandidateQueueRef.current;
      iceCandidateQueueRef.current = [];

      for (const item of pending) {
        // Loại bỏ candidate thuộc phiên/epoch cũ để tránh lỗi ufrag mismatch
        if (item.epoch !== expectedEpoch) continue;
        if (pc.signalingState === 'closed' || activeEpochRef.current !== expectedEpoch) break;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(item.candidate));
        } catch (e: any) {
          addDebugLog('WARN', `Lỗi thêm ICE candidate từ hàng đợi: ${e?.message || e}`);
        }
      }
    };

    /**
     * Tạo và gửi SDP Offer an toàn:
     * - Chỉ chạy khi kết nối đúng sessionId/epoch, signalingState === 'stable', không đang tạo Offer hoặc áp SDP.
     * - Phía Polite (vào sau) sẽ nhường tối đa 1.8s lúc chưa có remoteDescription để Impolite gửi Offer trước,
     *   tránh va chạm 2x Glare ngay đầu cuộc gọi.
     */
    const scheduleNegotiation = (pc: RTCPeerConnection, sessionId: number, epoch: number) => {
      if (
        sessionId !== pcSessionIdRef.current ||
        epoch !== activeEpochRef.current ||
        pc.signalingState !== 'stable' ||
        makingOfferRef.current ||
        processingRemoteDescriptionRef.current
      ) {
        return;
      }

      // Phía Polite hoãn nhẹ Offer đầu tiên để chờ Offer từ Impolite đến trước
      if (isPoliteRef.current && !pc.remoteDescription) {
        const remaining = politeGraceUntilRef.current - Date.now();
        if (remaining > 0) {
          if (!politeGraceTimerRef.current) {
            politeGraceTimerRef.current = setTimeout(() => {
              politeGraceTimerRef.current = null;
              scheduleNegotiation(pc, sessionId, epoch);
            }, remaining + 20);
          }
          return;
        }
      }

      const offerPromise = (async () => {
        try {
          makingOfferRef.current = true;
          if (
            sessionId !== pcSessionIdRef.current ||
            epoch !== activeEpochRef.current ||
            pc.signalingState !== 'stable'
          ) {
            return;
          }
          await pc.setLocalDescription(); // Tự động tạo SDP Offer mới (Unified Plan, hỗ trợ nhiều m=video)
          if (sessionId !== pcSessionIdRef.current || epoch !== activeEpochRef.current) return;

          if (pc.localDescription && pc.localDescription.type === 'offer') {
            const meta = getLocalCamerasMeta();
            addDebugLog(
              'INFO',
              `Gửi signal-offer (epoch=${epoch}, tracks=${meta.length}, signalingState=${pc.signalingState})`
            );
            socketRef.current?.emit('signal-offer', {
              offer: pc.localDescription,
              camerasMeta: meta,
              epoch
            });
          }
        } catch (err: any) {
          addDebugLog('ERR', `onnegotiationneeded error: ${err?.message || err}`);
        } finally {
          makingOfferRef.current = false;
          makingOfferPromiseRef.current = null;
        }
      })();

      makingOfferPromiseRef.current = offerPromise;
    };

    /**
     * Xử lý SDP Offer đến theo hàng đợi tuần tự (chuẩn W3C Perfect Negotiation + kiểm tra epoch)
     */
    const enqueueIncomingOffer = (
      senderId: string,
      offer: RTCSessionDescriptionInit,
      camerasMeta?: CameraMeta[],
      epoch?: number
    ) => {
      signalingQueueRef.current = signalingQueueRef.current.then(async () => {
        if (pcInitPromiseRef.current) {
          await pcInitPromiseRef.current;
        }

        if (typeof epoch === 'number' && epoch !== activeEpochRef.current) {
          addDebugLog(
            'WARN',
            `Bỏ qua signal-offer lệch epoch (got=${epoch}, active=${activeEpochRef.current})`
          );
          return;
        }

        const pc = pcRef.current;
        if (!pc || pc.signalingState === 'closed') {
          pendingOfferRef.current = { senderId, offer, camerasMeta, epoch };
          return;
        }
        const sessionId = pcSessionIdRef.current;
        const currentEpoch = activeEpochRef.current;

        if (camerasMeta) {
          updateRemoteCameraMeta(camerasMeta);
        }

        try {
          // Nếu đang dở tạo Offer cục bộ, Impolite bỏ qua ngay, Polite chờ tạo xong rồi mới kiểm tra va chạm
          if (makingOfferPromiseRef.current) {
            if (!isPoliteRef.current) {
              ignoreOfferRef.current = true;
              addDebugLog('WARN', `Glare collision: Impolite đang tạo Offer nên bỏ qua Offer từ ${senderId}`);
              return;
            }
            await makingOfferPromiseRef.current;
          }

          if (
            sessionId !== pcSessionIdRef.current ||
            currentEpoch !== activeEpochRef.current ||
            pcRef.current !== pc
          ) {
            return;
          }

          const readyForOffer =
            !makingOfferRef.current &&
            (pc.signalingState === 'stable' || isSettingRemoteAnswerPendingRef.current);
          const offerCollision = !readyForOffer;

          // NẾU LÀ IMPOLITE (Chủ động): Bỏ qua Offer từ đối phương khi va chạm
          ignoreOfferRef.current = !isPoliteRef.current && offerCollision;
          if (ignoreOfferRef.current) {
            addDebugLog('WARN', `Glare collision: Impolite bỏ qua Offer từ ${senderId}`);
            return;
          }

          addDebugLog(
            'INFO',
            `Nhận signal-offer từ ${senderId} (epoch=${currentEpoch}, collision=${offerCollision}, metas=${camerasMeta?.length ?? 0})`
          );
          politeGraceUntilRef.current = 0;
          if (politeGraceTimerRef.current) {
            clearTimeout(politeGraceTimerRef.current);
            politeGraceTimerRef.current = null;
          }

          // Chuẩn W3C Perfect Negotiation: setRemoteDescription(offer) tự động implicit-rollback phía Polite
          // mà không kích hoạt onsignalingstatechange('stable') tạo Offer thừa ở giữa chừng.
          processingRemoteDescriptionRef.current = true;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            if (sessionId !== pcSessionIdRef.current || currentEpoch !== activeEpochRef.current) return;

            await flushIceCandidateQueue(pc, currentEpoch);

            if (offer.type === 'offer') {
              await pc.setLocalDescription();
              if (sessionId !== pcSessionIdRef.current || currentEpoch !== activeEpochRef.current) return;
              addDebugLog('INFO', `Gửi signal-answer phản hồi về ${senderId} (epoch=${currentEpoch})`);
              socketInstance.emit('signal-answer', {
                targetId: senderId,
                answer: pc.localDescription,
                camerasMeta: getLocalCamerasMeta(),
                epoch: currentEpoch
              });
            }
          } finally {
            processingRemoteDescriptionRef.current = false;
          }

          // Nếu phía Polite có track mới chưa kịp ghép trong Answer, kiểm tra lại sau khi đã stable
          if (
            sessionId === pcSessionIdRef.current &&
            currentEpoch === activeEpochRef.current &&
            pc.signalingState === 'stable'
          ) {
            const hasUnnegotiatedSender = pc.getTransceivers().some(t => {
              if (!t.sender.track || t.sender.track.readyState !== 'live') return false;
              if (t.mid === null) return true;
              return (
                (t.direction === 'sendrecv' || t.direction === 'sendonly') &&
                t.currentDirection !== 'sendrecv' &&
                t.currentDirection !== 'sendonly'
              );
            });
            if (hasUnnegotiatedSender) {
              queueMicrotask(() => scheduleNegotiation(pc, sessionId, currentEpoch));
            }
          }
        } catch (err: any) {
          addDebugLog('ERR', `Lỗi xử lý signal-offer: ${err?.message || err}`);
        }
      });
    };

    /**
     * HÀM THIẾT LẬP KẾT NỐI RTCPeerConnection DUY NHẤT:
     * Chờ ICE/TURN config sẵn sàng, đăng ký toàn bộ sự kiện TRƯỚC khi addTrack
     * để đảm bảo các camera đã bật trước khi peer vào sau luôn được đàm phán đầy đủ.
     */
    const setupPeerConnection = async (
      overrideConfig?: RTCConfiguration,
      targetEpoch?: number,
      stage: 'all' | 'relay-tls' | 'relay-all' = 'all'
    ): Promise<RTCPeerConnection | null> => {
      const sessionId = ++pcSessionIdRef.current;
      const epoch = typeof targetEpoch === 'number' ? targetEpoch : activeEpochRef.current;
      activeEpochRef.current = epoch;
      relayStageRef.current = stage;

      clearNegotiationTimers();

      if (pcRef.current) {
        closePeerConnectionCleanly(pcRef.current, false);
        pcRef.current = null;
      }
      cameraSendersRef.current.clear();
      audioSenderRef.current = null;
      makingOfferRef.current = false;
      makingOfferPromiseRef.current = null;
      ignoreOfferRef.current = false;
      isSettingRemoteAnswerPendingRef.current = false;
      processingRemoteDescriptionRef.current = false;
      lastLoggedDtlsStateRef.current = null;
      politeGraceUntilRef.current = isPoliteRef.current ? Date.now() + 1800 : 0;
      remotePinnedCameraIdRef.current = null;

      if (iceFetchPromiseRef.current) {
        await iceFetchPromiseRef.current;
      }

      if (sessionId !== pcSessionIdRef.current || epoch !== activeEpochRef.current) {
        return null;
      }

      const activeConfig = overrideConfig || iceServersConfigRef.current;
      const activeUrls = (activeConfig.iceServers || []).flatMap(s =>
        Array.isArray(s.urls) ? s.urls : [s.urls]
      );
      addDebugLog(
        'INFO',
        `setupPeerConnection #${sessionId} (epoch=${epoch}, stage=${stage}): policy=${activeConfig.iceTransportPolicy || 'all'}, servers=${activeUrls.length} [${activeUrls.join(', ')}], localCams=${localCamerasRef.current.length}, hasAudio=${Boolean(localAudioTrackRef.current)}`
      );
      const pc = new RTCPeerConnection(activeConfig);
      pcRef.current = pc;
      setIceConnectionState(pc.iceConnectionState);
      setConnectionState(pc.connectionState);

      // Chỉ phía Impolite chạy bộ giám sát kẹt ICE/DTLS để yêu cầu server nâng tầng TURN đồng bộ cho cả 2 bên
      if (!isPoliteRef.current && hasTurnServerRef.current && stage !== 'relay-all') {
        const scheduleStallWatch = (delayMs: number) => {
          if (stallFallbackTimerRef.current) {
            clearTimeout(stallFallbackTimerRef.current);
          }
          stallFallbackTimerRef.current = setTimeout(() => {
            stallFallbackTimerRef.current = null;
            if (
              sessionId !== pcSessionIdRef.current ||
              epoch !== activeEpochRef.current ||
              pcRef.current !== pc ||
              pc.signalingState === 'closed' ||
              pc.connectionState === 'connected'
            ) {
              return;
            }
            // Nếu ICE đã connected nhưng DTLS mới đang bắt tay ở mốc 10s -> cho thêm 6s thay vì cắt ngang
            if (
              delayMs <= 10000 &&
              (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') &&
              pc.connectionState === 'connecting'
            ) {
              addDebugLog('INFO', 'ICE đã connected, DTLS đang bắt tay -> chờ thêm 6s trước khi nâng tầng TURN');
              scheduleStallWatch(6000);
              return;
            }
            requestRelayReconnect(
              `Kẹt ở connectionState=${pc.connectionState}, ice=${pc.iceConnectionState} (stage=${stage})`
            );
          }, delayMs);
        };
        scheduleStallWatch(10000);
      }

      // 1. Sự kiện thu thập ứng viên mạng ICE Candidate và gửi sang đối phương kèm epoch
      pc.onicecandidate = (event) => {
        if (sessionId !== pcSessionIdRef.current || epoch !== activeEpochRef.current) return;
        if (event.candidate && socketRef.current) {
          const raw = event.candidate.candidate || '';
          const typeMatch = raw.match(/\btyp\s+(\w+)/);
          const protoMatch = raw.match(/\bcandidate:\S+\s+\d+\s+(\w+)/i);
          const relayProto = (event.candidate as any).relayProtocol;
          const protoLabel = relayProto
            ? `${protoMatch?.[1]?.toLowerCase() || '?'} via ${String(relayProto).toLowerCase()}`
            : protoMatch?.[1]?.toLowerCase() || '?';
          addDebugLog(
            'INFO',
            `ICE local candidate: ${typeMatch?.[1] || '?'} (${protoLabel})`
          );
          socketRef.current.emit('signal-ice-candidate', {
            candidate: event.candidate,
            epoch
          });
        } else if (!event.candidate) {
          addDebugLog('INFO', `ICE gathering complete (epoch=${epoch})`);
        }
      };

      pc.onicecandidateerror = (event: any) => {
        if (sessionId !== pcSessionIdRef.current) return;
        addDebugLog(
          'ERR',
          `ICE candidate error: code=${event?.errorCode}, text=${event?.errorText || ''}, url=${event?.url || ''}`
        );
      };

      /**
       * 2. SỰ KIỆN TỰ ĐỘNG TÁI ĐÀM PHÁN (W3C Perfect Negotiation Pattern):
       */
      pc.onnegotiationneeded = () => {
        scheduleNegotiation(pc, sessionId, epoch);
      };

      /**
       * Đảm bảo không bỏ sót track nào nếu track được thêm trong lúc signalingState !== 'stable'
       */
      pc.onsignalingstatechange = () => {
        if (
          sessionId !== pcSessionIdRef.current ||
          epoch !== activeEpochRef.current ||
          processingRemoteDescriptionRef.current
        ) {
          return;
        }
        if (pc.signalingState === 'stable') {
          const hasUnnegotiatedSender = pc.getTransceivers().some(t => {
            if (!t.sender.track || t.sender.track.readyState !== 'live') return false;
            if (t.mid === null) return true;
            return (
              (t.direction === 'sendrecv' || t.direction === 'sendonly') &&
              t.currentDirection !== 'sendrecv' &&
              t.currentDirection !== 'sendonly'
            );
          });
          if (hasUnnegotiatedSender) {
            queueMicrotask(() => scheduleNegotiation(pc, sessionId, epoch));
          }
        }
      };

      /**
       * 3. SỰ KIỆN ĐÓN NHẬN LUỒNG TỪ XA (pc.ontrack):
       * Kích hoạt độc lập cho TỪNG camera và audio mà đối phương gửi đến trên cùng đường truyền.
       */
      pc.ontrack = (event) => {
        if (sessionId !== pcSessionIdRef.current || epoch !== activeEpochRef.current) return;
        addDebugLog(
          'INFO',
          `ontrack: kind=${event.track.kind}, muted=${event.track.muted}, state=${event.track.readyState}`
        );

        // A. Xử lý luồng âm thanh
        if (event.track.kind === 'audio') {
          const audioStream = event.streams[0] || new MediaStream([event.track]);
          setRemoteAudioStream(audioStream);
          if (remoteAudioElemRef.current) {
            remoteAudioElemRef.current.srcObject = audioStream;
            remoteAudioElemRef.current.play().catch(e => console.warn('Trình duyệt chặn auto-play âm thanh:', e));
          }
          return;
        }

        // B. Xử lý luồng hình ảnh của các camera
        if (event.track.kind === 'video') {
          const remoteStream = event.streams[0] || new MediaStream([event.track]);
          const trackId = event.track.id;

          // Tra cứu metadata gửi kèm qua WebSocket để biết đây là camera gì, tên nhãn là gì
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

          // Nạp camera từ xa mới vào danh sách hiển thị
          setRemoteCameras(prev => {
            const filtered = prev.filter(c => c.id !== trackId);
            return [...filtered, newRemoteCam];
          });

          // Tự động gỡ bỏ camera khỏi giao diện khi đối phương tắt camera này
          event.track.onended = () => {
            if (sessionId !== pcSessionIdRef.current) return;
            console.log(`[WebRTC] Remote track ${trackId} đã kết thúc`);
            setRemoteCameras(prev => prev.filter(c => c.id !== trackId));
          };
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (sessionId !== pcSessionIdRef.current || epoch !== activeEpochRef.current) return;
        setIceConnectionState(pc.iceConnectionState);
        addDebugLog('INFO', `ICE connection state -> ${pc.iceConnectionState} (epoch=${epoch})`);

        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          // Đảm bảo thông số chất lượng (mặc định 720p ở trạng thái grid) được áp dụng chắc chắn sau khi nối mạng
          localCamerasRef.current.forEach(cam => {
            const targetMode: VideoQualityMode = !remotePinnedCameraIdRef.current
              ? 'grid'
              : remotePinnedCameraIdRef.current === cam.id
              ? 'high'
              : 'low';
            applyEncodingQuality(cam.id, targetMode);
          });
        } else if (pc.iceConnectionState === 'failed') {
          if (hasTurnServerRef.current && stage !== 'relay-all') {
            requestRelayReconnect(`ICE failed (stage=${stage})`);
          } else if (!isPoliteRef.current && typeof pc.restartIce === 'function') {
            addDebugLog('WARN', 'ICE failed (không còn tầng fallback) -> thử restartIce()');
            pc.restartIce();
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (sessionId !== pcSessionIdRef.current || epoch !== activeEpochRef.current) return;
        setConnectionState(pc.connectionState);
        addDebugLog(
          pc.connectionState === 'failed' ? 'ERR' : 'INFO',
          `Peer connectionState -> ${pc.connectionState} (epoch=${epoch}, stage=${stage})`
        );
        if (pc.connectionState === 'connected' && stallFallbackTimerRef.current) {
          clearTimeout(stallFallbackTimerRef.current);
          stallFallbackTimerRef.current = null;
        }
        if (pc.connectionState === 'failed') {
          requestRelayReconnect(`DTLS/Peer failed (stage=${stage})`);
        }
      };

      // 4. Gắn luồng âm thanh Micro (nếu đã bật trước khi peer vào)
      let attachedTrackCount = 0;
      const audioStream = localAudioStreamRef.current;
      const audioTrack = localAudioTrackRef.current;
      if (audioTrack && audioTrack.readyState === 'live') {
        audioTrack.enabled = !isMutedRef.current;
        const stream = audioStream || new MediaStream([audioTrack]);
        audioSenderRef.current = pc.addTrack(audioTrack, stream);
        attachedTrackCount += 1;
      }

      // 5. Gắn TẤT CẢ các camera cục bộ đang hoạt động vào kết nối này (ở chế độ 720p grid mặc định)
      localCamerasRef.current.forEach(cam => {
        const track = cam.stream.getVideoTracks()[0];
        if (track && track.readyState === 'live') {
          const sender = pc.addTrack(track, cam.stream);
          cameraSendersRef.current.set(cam.id, sender);
          applyEncodingQuality(cam.id, 'grid');
          attachedTrackCount += 1;
        }
      });

      // Nếu Impolite chưa bật cam/mic nào, tạo 1 data channel nhẹ để Impolite luôn chủ động khởi tạo Offer ngay lập tức
      if (!isPoliteRef.current && attachedTrackCount === 0) {
        try {
          pc.createDataChannel('omnicam-ctrl');
        } catch (_) {}
      }

      // Xử lý Offer đến sớm (nếu khớp epoch) trước khi PeerConnection khởi tạo xong
      if (pendingOfferRef.current) {
        const queued = pendingOfferRef.current;
        pendingOfferRef.current = null;
        if (queued.epoch === undefined || queued.epoch === epoch) {
          enqueueIncomingOffer(queued.senderId, queued.offer, queued.camerasMeta, queued.epoch);
        }
      }

      return pc;
    };

    // Khi kết nối thành công tới WebSocket Signaling Server
    socketInstance.on('connect', () => {
      const transport = socketInstance.io?.engine?.transport?.name || 'unknown';
      addDebugLog('INFO', `Socket connected id=${socketInstance.id} (${transport}) -> join ${roomId}`);
      setIsConnected(true);
      socketInstance.emit('join-room', {
        roomId,
        userName,
        clientId: clientIdRef.current
      });
    });

    socketInstance.on('connect_error', (err: any) => {
      addDebugLog('ERR', `Socket connect_error: ${err?.message || err}`);
    });

    socketInstance.on('disconnect', (reason: string) => {
      addDebugLog('WARN', `Socket disconnected: reason=${reason}`);
      setIsConnected(false);
    });

    // Nhận thông báo phòng đã đủ 2 người (1-on-1 limit)
    socketInstance.on('room-full', ({ roomId: fullRoomId, max }: { roomId: string; max: number }) => {
      addDebugLog('ERR', `Phòng ${fullRoomId} đã đủ ${max} người (room-full)`);
      setIsRoomFull(true);
    });

    // Khi máy mình tham gia thành công vào phòng
    socketInstance.on(
      'room-joined',
      async ({
        yourId,
        isPolite: politeRole,
        epoch,
        peers,
        whiteboard
      }: {
        roomId: string;
        yourId: string;
        isPolite: boolean;
        epoch?: number;
        peers: any[];
        whiteboard?: WhiteboardState;
      }) => {
        isPoliteRef.current = politeRole;
        setIsPolite(politeRole);
        const nextEpoch = typeof epoch === 'number' ? epoch : activeEpochRef.current + 1;
        activeEpochRef.current = nextEpoch;
        reconnectRequestedEpochRef.current = 0;
        addDebugLog(
          'INFO',
          `room-joined: yourId=${yourId}, isPolite=${politeRole}, epoch=${nextEpoch}, peers=${peers.length}`
        );

        if (whiteboard) {
          setWhiteboardState(whiteboard);
        }

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
          iceCandidateQueueRef.current = [];
          pendingOfferRef.current = null;
          setRemoteCameras([]);
          pcInitPromiseRef.current = setupPeerConnection(undefined, nextEpoch, 'all');
        }

        // Đồng bộ trạng thái tắt/bật mic & danh sách camera hiện có lên phòng
        socketInstance.emit('mic-state-update', { isMuted: isMutedRef.current });
        const existingMeta = getLocalCamerasMeta();
        if (existingMeta.length > 0) {
          socketInstance.emit('camera-state-update', { cameras: existingMeta });
        }
      }
    );

    // Khi có người thứ 2 tham gia vào phòng
    socketInstance.on(
      'peer-joined',
      ({
        peerId,
        peerName,
        isPolite: remoteIsPolite,
        epoch
      }: {
        peerId: string;
        peerName: string;
        isPolite: boolean;
        epoch?: number;
      }) => {
        const nextEpoch = typeof epoch === 'number' ? epoch : activeEpochRef.current + 1;
        activeEpochRef.current = nextEpoch;
        reconnectRequestedEpochRef.current = 0;
        addDebugLog(
          'INFO',
          `peer-joined: ${peerName} (${peerId}), remoteIsPolite=${remoteIsPolite}, epoch=${nextEpoch}`
        );
        const pInfo: PeerInfo = {
          peerId,
          peerName,
          isPolite: remoteIsPolite,
          isMuted: false,
          cameras: []
        };
        peerInfoRef.current = pInfo;
        setPeerInfo(pInfo);
        iceCandidateQueueRef.current = [];
        pendingOfferRef.current = null;
        setRemoteCameras([]);

        // Người vào trước (Impolite Initiator) chuẩn bị kết nối và gửi Offer đầu tiên
        pcInitPromiseRef.current = setupPeerConnection(undefined, nextEpoch, 'all');
        // Đồng bộ lại trạng thái mic & camera hiện tại của máy mình cho người mới vào biết
        socketInstance.emit('mic-state-update', { isMuted: isMutedRef.current });
        const existingMeta = getLocalCamerasMeta();
        if (existingMeta.length > 0) {
          socketInstance.emit('camera-state-update', { cameras: existingMeta });
        }
      }
    );

    /**
     * XỬ LÝ NHẬN SDP OFFER TỪ ĐỐI PHƯƠNG (Giải quyết xung đột Glare Collision):
     */
    socketInstance.on('signal-offer', ({ senderId, offer, camerasMeta, epoch }) => {
      enqueueIncomingOffer(senderId, offer, camerasMeta, epoch);
    });

    /**
     * XỬ LÝ NHẬN SDP ANSWER TỪ ĐỐI PHƯƠNG
     */
    socketInstance.on('signal-answer', ({ answer, camerasMeta, epoch }) => {
      signalingQueueRef.current = signalingQueueRef.current.then(async () => {
        if (pcInitPromiseRef.current) {
          await pcInitPromiseRef.current;
        }
        if (typeof epoch === 'number' && epoch !== activeEpochRef.current) {
          addDebugLog(
            'WARN',
            `Bỏ qua signal-answer lệch epoch (got=${epoch}, active=${activeEpochRef.current})`
          );
          return;
        }

        const pc = pcRef.current;
        if (!pc || pc.signalingState === 'closed') return;
        const currentEpoch = activeEpochRef.current;

        if (camerasMeta) {
          updateRemoteCameraMeta(camerasMeta);
        }

        if (pc.signalingState !== 'have-local-offer') {
          addDebugLog('WARN', `Bỏ qua signal-answer vì signalingState=${pc.signalingState}`);
          return;
        }

        try {
          ignoreOfferRef.current = false;
          isSettingRemoteAnswerPendingRef.current = true;
          processingRemoteDescriptionRef.current = true;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          isSettingRemoteAnswerPendingRef.current = false;
          processingRemoteDescriptionRef.current = false;
          addDebugLog('INFO', `Đã nhận và áp dụng signal-answer (epoch=${currentEpoch})`);

          // Xử lý nốt các gói ICE candidate đúng epoch trong hàng đợi
          await flushIceCandidateQueue(pc, currentEpoch);
        } catch (err: any) {
          addDebugLog('ERR', `Lỗi xử lý signal-answer: ${err?.message || err}`);
        } finally {
          isSettingRemoteAnswerPendingRef.current = false;
          processingRemoteDescriptionRef.current = false;
        }
      });
    });

    /**
     * XỬ LÝ NHẬN GÓI ỨNG VIÊN MẠNG ICE CANDIDATE
     */
    socketInstance.on('signal-ice-candidate', async ({ candidate, epoch }) => {
      if (!candidate) return;
      if (typeof epoch === 'number' && epoch !== activeEpochRef.current) {
        return;
      }
      // Bỏ qua các ICE candidate thuộc Offer va chạm đã bị Impolite từ chối
      if (ignoreOfferRef.current) {
        return;
      }

      const currentEpoch = activeEpochRef.current;
      const pc = pcRef.current;
      if (
        !pc ||
        !pc.remoteDescription ||
        isSettingRemoteAnswerPendingRef.current ||
        processingRemoteDescriptionRef.current
      ) {
        iceCandidateQueueRef.current.push({ epoch: currentEpoch, candidate });
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err: any) {
        if (!ignoreOfferRef.current && currentEpoch === activeEpochRef.current) {
          addDebugLog('WARN', `Lỗi nạp ICE candidate: ${err?.message || err}`);
        }
      }
    });

    /**
     * ĐỒNG BỘ TẠO LẠI RTCPeerConnection QUA TURN TLS 443 / RELAY THEO EPOCH:
     * 1. Cập nhật activeEpochRef đồng bộ NGAY LẬP TỨC (trước khi vào hàng đợi async) để:
     *    - Ngắt ngay mọi tác vụ Offer/Answer của epoch cũ đang chạy dở.
     *    - Giữ lại các ICE candidate của epoch mới (nếu tới sớm) và loại sạch candidate epoch cũ.
     * 2. Đẩy việc đóng PC cũ + tạo PC mới vào signalingQueueRef để chạy tuần tự, tuyệt đối không race.
     */
    socketInstance.on(
      'signal-reconnect-relay',
      ({ mode, epoch }: { senderId?: string; mode?: string; epoch?: number }) => {
        if (!peerInfoRef.current) return;
        // Bỏ qua nếu tín hiệu nâng tầng này đã được xử lý trước đó
        if (typeof epoch === 'number' && epoch <= activeEpochRef.current) {
          return;
        }

        const nextEpoch = typeof epoch === 'number' ? epoch : activeEpochRef.current + 1;
        const nextStage: 'relay-tls' | 'relay-all' =
          mode === 'relay-all' ? 'relay-all' : 'relay-tls';

        // Chuyển ngay sang epoch mới và dọn trạng thái cũ
        activeEpochRef.current = nextEpoch;
        ignoreOfferRef.current = false;
        iceCandidateQueueRef.current = iceCandidateQueueRef.current.filter(c => c.epoch === nextEpoch);
        pendingOfferRef.current = null;

        signalingQueueRef.current = signalingQueueRef.current.then(async () => {
          if (!peerInfoRef.current || activeEpochRef.current !== nextEpoch) return;

          // Xóa các khung hình remote cũ đã đơ từ phiên trước
          setRemoteCameras([]);
          const relayConfig = buildRelayConfig(nextStage);
          addDebugLog(
            'WARN',
            `signal-reconnect-relay -> tạo lại RTCPeerConnection (epoch=${nextEpoch}, stage=${nextStage})`
          );
          pcInitPromiseRef.current = setupPeerConnection(relayConfig, nextEpoch, nextStage);
          await pcInitPromiseRef.current;
        });
      }
    );

    // Khi đối phương bật/tắt camera
    socketInstance.on('peer-camera-updated', ({ cameras }: { peerId: string; cameras: CameraMeta[] }) => {
      console.log('[Socket] Đối phương cập nhật camera:', cameras);
      updateRemoteCameraMeta(cameras);
    });

    // Khi đối phương bật/tắt micro
    socketInstance.on('peer-mic-updated', ({ isMuted: remoteMuted }: { peerId: string; isMuted: boolean }) => {
      setPeerInfo(prev => prev ? { ...prev, isMuted: remoteMuted } : null);
      if (peerInfoRef.current) peerInfoRef.current.isMuted = remoteMuted;
      setRemoteCameras(prev => prev.map(rc => ({ ...rc, isMuted: remoteMuted })));
    });

    // Khi đối phương ghim hoặc bỏ ghim một camera (Spotlight Pin-Adaptive Video Quality)
    socketInstance.on('peer-pin-updated', ({ pinnedCameraId }: { pinnedCameraId: string | null }) => {
      console.log('[Socket] Nhận sự kiện peer-pin-updated:', pinnedCameraId);
      handleRemotePinUpdate(pinnedCameraId);
    });

    // Nhận tin nhắn chat
    socketInstance.on('chat-message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
    });

    // Đồng bộ trạng thái Bảng trắng chung
    socketInstance.on('whiteboard-state-updated', (wb: WhiteboardState) => {
      setWhiteboardState(wb);
    });

    socketInstance.on('whiteboard-toggle-rejected', ({ whiteboard }: { reason: string; whiteboard?: WhiteboardState }) => {
      if (whiteboard) {
        setWhiteboardState(whiteboard);
      }
    });

    socketInstance.on('whiteboard-draw-live', (draw: WhiteboardLiveDraw) => {
      whiteboardLiveHandlerRef.current?.(draw);
    });

    socketInstance.on('whiteboard-stroke-added', ({ stroke }: { stroke: WhiteboardStroke }) => {
      setWhiteboardState(prev => {
        if (prev.strokes.some(s => s.id === stroke.id)) return prev;
        return { ...prev, strokes: [...prev.strokes, stroke] };
      });
    });

    socketInstance.on('whiteboard-stroke-removed', ({ strokeId }: { strokeId: string }) => {
      setWhiteboardState(prev => ({
        ...prev,
        strokes: prev.strokes.filter(s => s.id !== strokeId)
      }));
    });

    socketInstance.on('whiteboard-cleared', () => {
      setWhiteboardState(prev => ({ ...prev, strokes: [] }));
    });

    socketInstance.on('whiteboard-grid-updated', ({ showGrid }: { showGrid: boolean }) => {
      setWhiteboardState(prev => ({ ...prev, showGrid }));
    });

    // Khi đối phương rời phòng họp
    socketInstance.on('peer-left', ({ peerId, peerName }: { peerId: string; peerName: string }) => {
      if (peerInfoRef.current && peerId && peerInfoRef.current.peerId !== peerId) {
        addDebugLog('WARN', `Bỏ qua peer-left cũ (${peerId}), hiện tại=${peerInfoRef.current.peerId}`);
        return;
      }
      addDebugLog('WARN', `peer-left: ${peerName} (${peerId})`);
      pcSessionIdRef.current++;
      activeEpochRef.current += 1;
      clearNegotiationTimers();
      if (pcRef.current) {
        closePeerConnectionCleanly(pcRef.current, false);
        pcRef.current = null;
      }
      pcInitPromiseRef.current = null;
      cameraSendersRef.current.clear();
      audioSenderRef.current = null;
      iceCandidateQueueRef.current = [];
      pendingOfferRef.current = null;
      remotePinnedCameraIdRef.current = null;
      peerInfoRef.current = null;
      setPeerInfo(null);
      setRemoteCameras([]);
      remoteCameraMetaRef.current = [];
      setRemoteAudioStream(null);
      setIceConnectionState('new');
      setConnectionState('new');
      setStats(null);
      setLocalQualityModes({});
      stopRemoteAudioElement();
    });

    /**
     * ĐO KIỂM THÔNG SỐ MẠNG ĐỊNH KỲ (pc.getStats):
     * Đo RTT, tỉ lệ mất gói, FPS, độ phân giải thực tế, trạng thái DTLS và loại kết nối ICE (host/srflx/relay).
     */
    const statsInterval = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'new') {
        setStats(null);
        return;
      }

      try {
        const statsReport = await pc.getStats();
        let rtt = 0;
        let packetsLost = 0;
        let videoBitrate = 0;
        let fps = 0;
        let resolution = '';
        let audioBitrate = 0;
        let selectedPairId: string | undefined;
        let candidateType: string | undefined;
        let candidateProtocol: string | undefined;
        let dtlsState: string | undefined;
        const localCandidates = new Map<
          string,
          { type: string; protocol?: string; relayProtocol?: string }
        >();
        const candidatePairs = new Map<string, any>();

        statsReport.forEach(report => {
          if (report.type === 'transport') {
            if (report.selectedCandidatePairId) {
              selectedPairId = report.selectedCandidatePairId;
            }
            if (report.dtlsState) {
              dtlsState = report.dtlsState;
            }
          }
          if (report.type === 'local-candidate' && report.candidateType) {
            localCandidates.set(report.id, {
              type: report.candidateType,
              protocol: report.protocol,
              relayProtocol: report.relayProtocol
            });
          }
          if (report.type === 'candidate-pair') {
            candidatePairs.set(report.id, report);
            if (report.currentRoundTripTime && (report.nominated || report.state === 'succeeded')) {
              rtt = Math.round(report.currentRoundTripTime * 1000);
            }
          }
          // Đo số gói video bị rụng (packets lost) và FPS thực tế
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            packetsLost += report.packetsLost || 0;
            if (report.framesPerSecond) fps = Math.round(report.framesPerSecond);
            if (report.frameWidth && report.frameHeight) {
              resolution = `${report.frameWidth}x${report.frameHeight}`;
            }
          }
        });

        const activePair =
          (selectedPairId && candidatePairs.get(selectedPairId)) ||
          Array.from(candidatePairs.values()).find(p => p.nominated && p.state === 'succeeded') ||
          Array.from(candidatePairs.values()).find(p => p.state === 'in-progress');
        if (activePair) {
          if (activePair.currentRoundTripTime) {
            rtt = Math.round(activePair.currentRoundTripTime * 1000);
          }
          if (activePair.localCandidateId) {
            const lc = localCandidates.get(activePair.localCandidateId);
            candidateType = lc?.type;
            candidateProtocol = lc?.relayProtocol || lc?.protocol;
          }
        }

        if (dtlsState && dtlsState !== lastLoggedDtlsStateRef.current) {
          lastLoggedDtlsStateRef.current = dtlsState;
          addDebugLog(
            dtlsState === 'failed' ? 'ERR' : 'INFO',
            `DTLS state -> ${dtlsState} (route=${candidateType || '?'}/${candidateProtocol || '?'}, rtt=${rtt}ms)`
          );
        }

        setStats({
          rtt,
          packetsLost,
          videoBitrate,
          resolution: resolution || undefined,
          fps: fps || undefined,
          audioBitrate,
          candidateType,
          candidateProtocol,
          dtlsState,
          connectionState: pc.connectionState
        });
      } catch (e) {
        // Bỏ qua lỗi thống kê nếu ngắt kết nối đột ngột
      }
    }, 2000);

    /**
     * DỌN DẸP CỨNG TOÀN BỘ WEBRTC, SOCKET & PHẦN CỨNG (IDEMPOTENT - CHỈ CHẠY 1 LẦN):
     * Chạy ngay lập tức ở mọi lối thoát: nút Rời phòng, nút Back điện thoại, đóng tab, refresh, vuốt tắt Chrome.
     */
    let tornDown = false;

    /**
     * Gửi gói HTTP POST nhỏ tới /api/leave-room bằng sendBeacon (fallback fetch keepalive):
     * Khác với WebSocket có thể bị Chrome trên điện thoại cắt ngay khi đóng tab,
     * sendBeacon được trình duyệt ưu tiên đẩy nốt ra mạng -> server báo peer-left tức thì để máy kia ngắt video TURN.
     */
    const sendLeaveBeacon = (socketId?: string) => {
      const payload = JSON.stringify({
        socketId: socketId || undefined,
        roomId,
        clientId: clientIdRef.current
      });
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([payload], { type: 'application/json' });
          if (navigator.sendBeacon('/api/leave-room', blob)) {
            return;
          }
        }
      } catch (_) {}
      // Dự phòng nếu trình duyệt không hỗ trợ sendBeacon hoặc hàng đợi beacon đầy
      try {
        fetch('/api/leave-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      } catch (_) {}
    };

    const teardownSession = () => {
      if (tornDown) return;
      tornDown = true;

      // Vô hiệu hóa mọi callback bất đồng bộ còn sót từ phiên cũ
      pcSessionIdRef.current++;
      activeEpochRef.current += 1;
      clearInterval(statsInterval);
      clearNegotiationTimers();

      // 1. Báo server rời phòng qua cả WebSocket lẫn HTTP Beacon (server xử lý idempotent nên không lo trùng)
      const activeSocketId = socketInstance.id;
      try {
        if (socketInstance.connected) {
          socketInstance.emit('leave-room');
        }
      } catch (_) {}
      sendLeaveBeacon(activeSocketId);

      // 2. Gỡ toàn bộ listener và ngắt kết nối Socket.IO
      try {
        socketInstance.removeAllListeners();
        socketInstance.disconnect();
      } catch (_) {}
      socketRef.current = null;

      // 3. Đóng RTCPeerConnection + dừng toàn bộ track gửi & nhận (cắt 100% lưu lượng 4G/TURN)
      if (pcRef.current) {
        closePeerConnectionCleanly(pcRef.current, true);
        pcRef.current = null;
      }
      pcInitPromiseRef.current = null;
      cameraSendersRef.current.clear();
      audioSenderRef.current = null;
      iceCandidateQueueRef.current = [];
      pendingOfferRef.current = null;
      peerInfoRef.current = null;

      // 4. Tắt toàn bộ track webcam/màn hình cục bộ để tắt đèn camera phần cứng
      localCamerasRef.current.forEach(cam => cam.stream.getTracks().forEach(t => t.stop()));
      localCamerasRef.current = [];

      // 5. Tắt toàn bộ track micro cục bộ
      audioInitPromiseRef.current = null;
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(t => t.stop());
        localAudioStreamRef.current = null;
      }
      if (localAudioTrackRef.current) {
        try { localAudioTrackRef.current.stop(); } catch (_) {}
        localAudioTrackRef.current = null;
      }

      // 6. Tắt thẻ <audio> phát giọng đối phương
      stopRemoteAudioElement();
      remoteAudioElemRef.current = null;
    };

    // Bắt sự kiện đóng tab / refresh / vuốt tắt trình duyệt (pagehide tin cậy hơn beforeunload trên mobile)
    const handlePageExit = () => {
      teardownSession();
    };
    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);

    return () => {
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
      teardownSession();
    };
  }, [roomId, userName, applyEncodingQuality, getLocalCamerasMeta, updateRemoteCameraMeta, handleRemotePinUpdate]);

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
    addScreenShare,
    removeCamera,
    toggleCamera,
    chatMessages,
    sendMessage,
    stats,
    hasTurnServer,
    iceConnectionState,
    connectionState,
    debugLogs,
    // Pin-adaptive quality
    localQualityModes,
    sendPinStateUpdate,
    setCameraQuality: applyEncodingQuality,
    // Whiteboard
    whiteboardState,
    toggleWhiteboard,
    emitWhiteboardLive,
    commitWhiteboardStroke,
    undoWhiteboard,
    clearWhiteboard,
    toggleWhiteboardGrid,
    registerWhiteboardLiveHandler
  };
}
