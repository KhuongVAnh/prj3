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
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');

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

  // Các biến cờ trạng thái phục vụ cỗ máy W3C Perfect Negotiation
  const isPoliteRef = useRef<boolean>(false);
  const makingOfferRef = useRef<boolean>(false); // Đang trong quá trình tạo Offer cục bộ
  const makingOfferPromiseRef = useRef<Promise<void> | null>(null); // Promise đang tạo Offer để đồng bộ hóa va chạm
  const signalingQueueRef = useRef<Promise<void>>(Promise.resolve()); // Hàng đợi tuần tự xử lý Offer/Answer tránh race condition
  const ignoreOfferRef = useRef<boolean>(false); // Cờ bỏ qua Offer đối phương nếu xảy ra xung đột (dành cho Impolite)
  const isSettingRemoteAnswerPendingRef = useRef<boolean>(false); // Đang chờ áp dụng Remote Answer
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]); // Hàng đợi chứa các gói ICE đến sớm trước khi có Remote Description
  const pendingOfferRef = useRef<{ senderId: string; offer: RTCSessionDescriptionInit; camerasMeta?: CameraMeta[] } | null>(null);
  const remoteCameraMetaRef = useRef<CameraMeta[]>([]); // Bảng metadata camera của người bên kia
  const remotePinnedCameraIdRef = useRef<string | null>(null); // ID camera máy mình mà đối phương đang ghim tiêu điểm
  const iceServersConfigRef = useRef<RTCConfiguration>(ICE_SERVERS);
  const iceFetchPromiseRef = useRef<Promise<void> | null>(null);
  const pcInitPromiseRef = useRef<Promise<RTCPeerConnection | null> | null>(null);
  const pcSessionIdRef = useRef<number>(0);
  const iceRestartAttemptedRef = useRef<boolean>(false);

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
      transports: ['websocket', 'polling']
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
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('/api/ice-servers', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
            iceServersConfigRef.current = {
              iceServers: data.iceServers,
              iceCandidatePoolSize: 10
            };
            setHasTurnServer(Boolean(data.hasTurn));
            console.log(`[WebRTC] Đã tải ICE config (${data.provider}, hasTurn=${Boolean(data.hasTurn)})`);
          }
        }
      } catch (err) {
        console.warn('[WebRTC] Không thể tải /api/ice-servers, dùng STUN mặc định:', err);
      }
    };
    iceFetchPromiseRef.current = fetchIceConfig();

    /**
     * Đẩy toàn bộ các gói ICE Candidate đang xếp hàng vào RTCPeerConnection
     */
    const flushIceCandidateQueue = async (pc: RTCPeerConnection) => {
      while (iceCandidateQueueRef.current.length > 0) {
        const cand = iceCandidateQueueRef.current.shift();
        if (cand && pc.signalingState !== 'closed') {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.warn('[WebRTC] Lỗi thêm ICE candidate trong hàng đợi:', e);
          }
        }
      }
    };

    /**
     * Tạo và gửi SDP Offer an toàn (chống chồng chéo khi signalingState chưa stable)
     */
    const scheduleNegotiation = (pc: RTCPeerConnection, sessionId: number) => {
      if (
        sessionId !== pcSessionIdRef.current ||
        pc.signalingState !== 'stable' ||
        makingOfferRef.current
      ) {
        return;
      }

      const offerPromise = (async () => {
        try {
          makingOfferRef.current = true;
          if (sessionId !== pcSessionIdRef.current || pc.signalingState !== 'stable') {
            return;
          }
          await pc.setLocalDescription(); // Tạo SDP Offer mới (chứa nhiều m=video)
          if (sessionId !== pcSessionIdRef.current) return;

          if (pc.localDescription && pc.localDescription.type === 'offer') {
            console.log('[WebRTC] Tự động gửi SDP Offer từ sự kiện onnegotiationneeded');
            socketRef.current?.emit('signal-offer', {
              offer: pc.localDescription,
              camerasMeta: getLocalCamerasMeta() // Đính kèm metadata camera để phía nhận biết thông tin
            });
          }
        } catch (err) {
          console.error('[WebRTC] Lỗi trong quá trình onnegotiationneeded:', err);
        } finally {
          makingOfferRef.current = false;
          makingOfferPromiseRef.current = null;
        }
      })();

      makingOfferPromiseRef.current = offerPromise;
    };

    /**
     * Xử lý SDP Offer đến theo hàng đợi tuần tự (W3C Perfect Negotiation không xung đột)
     */
    const enqueueIncomingOffer = (
      senderId: string,
      offer: RTCSessionDescriptionInit,
      camerasMeta?: CameraMeta[]
    ) => {
      signalingQueueRef.current = signalingQueueRef.current.then(async () => {
        if (pcInitPromiseRef.current) {
          await pcInitPromiseRef.current;
        }

        const pc = pcRef.current;
        if (!pc || pc.signalingState === 'closed') {
          pendingOfferRef.current = { senderId, offer, camerasMeta };
          return;
        }
        const sessionId = pcSessionIdRef.current;

        if (camerasMeta) {
          updateRemoteCameraMeta(camerasMeta);
        }

        try {
          // Nếu đang dở tạo Offer cục bộ, Impolite bỏ qua ngay, Polite chờ tạo xong rồi mới kiểm tra va chạm
          if (makingOfferPromiseRef.current) {
            if (!isPoliteRef.current) {
              ignoreOfferRef.current = true;
              console.log('[WebRTC] Va chạm đàm phán (Glare): Impolite đang tạo Offer nên bỏ qua Offer đến');
              return;
            }
            await makingOfferPromiseRef.current;
          }

          if (sessionId !== pcSessionIdRef.current || pcRef.current !== pc) return;

          const readyForOffer =
            !makingOfferRef.current &&
            (pc.signalingState === 'stable' || isSettingRemoteAnswerPendingRef.current);
          const offerCollision = !readyForOffer;

          // NẾU LÀ IMPOLITE (Chủ động): Bỏ qua Offer từ đối phương khi va chạm
          ignoreOfferRef.current = !isPoliteRef.current && offerCollision;
          if (ignoreOfferRef.current) {
            console.log('[WebRTC] Va chạm đàm phán (Glare): Máy chủ động (Impolite) bỏ qua Offer của đối phương');
            return;
          }

          // NẾU LÀ POLITE (Nhường nhịn): Chủ động rollback Offer của mình về trạng thái stable
          if (offerCollision && isPoliteRef.current && pc.signalingState === 'have-local-offer') {
            console.log('[WebRTC] Va chạm đàm phán (Glare): Máy nhường nhịn (Polite) rollback local offer để nhận remote offer');
            try {
              await pc.setLocalDescription({ type: 'rollback' });
            } catch (e) {
              console.warn('[WebRTC] Lỗi rollback:', e);
            }
          }

          // Áp dụng mô tả từ đối phương
          await pc.setRemoteDescription(new RTCSessionDescription(offer));

          // Xử lý các gói ICE candidate đã xếp hàng đợi trước đó
          await flushIceCandidateQueue(pc);

          // Tạo SDP Answer để trả lời đối phương
          if (offer.type === 'offer') {
            await pc.setLocalDescription();
            console.log('[WebRTC] Gửi SDP Answer phản hồi về', senderId);
            socketInstance.emit('signal-answer', {
              targetId: senderId,
              answer: pc.localDescription,
              camerasMeta: getLocalCamerasMeta()
            });
          }
        } catch (err) {
          console.error('[WebRTC] Lỗi xử lý signal-offer:', err);
        }
      });
    };

    /**
     * HÀM THIẾT LẬP KẾT NỐI RTCPeerConnection DUY NHẤT:
     * Chờ ICE/TURN config sẵn sàng, đăng ký toàn bộ sự kiện TRƯỚC khi addTrack
     * để đảm bảo các camera đã bật trước khi peer vào sau luôn được đàm phán đầy đủ.
     */
    const setupPeerConnection = async (): Promise<RTCPeerConnection | null> => {
      const sessionId = ++pcSessionIdRef.current;

      if (pcRef.current) {
        try { pcRef.current.close(); } catch (_) {}
        pcRef.current = null;
      }
      cameraSendersRef.current.clear();
      audioSenderRef.current = null;
      makingOfferRef.current = false;
      makingOfferPromiseRef.current = null;
      ignoreOfferRef.current = false;
      isSettingRemoteAnswerPendingRef.current = false;
      iceRestartAttemptedRef.current = false;
      remotePinnedCameraIdRef.current = null;

      if (iceFetchPromiseRef.current) {
        await iceFetchPromiseRef.current;
      }

      if (sessionId !== pcSessionIdRef.current) {
        return null;
      }

      const pc = new RTCPeerConnection(iceServersConfigRef.current);
      pcRef.current = pc;
      setIceConnectionState(pc.iceConnectionState);

      // 1. Sự kiện thu thập ứng viên mạng ICE Candidate và gửi sang đối phương
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('signal-ice-candidate', { candidate: event.candidate });
        }
      };

      /**
       * 2. SỰ KIỆN TỰ ĐỘNG TÁI ĐÀM PHÁN (W3C Perfect Negotiation Pattern):
       */
      pc.onnegotiationneeded = () => {
        scheduleNegotiation(pc, sessionId);
      };

      /**
       * Đảm bảo không bỏ sót track nào nếu track được thêm trong lúc signalingState !== 'stable'
       */
      pc.onsignalingstatechange = () => {
        if (sessionId !== pcSessionIdRef.current) return;
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
            queueMicrotask(() => scheduleNegotiation(pc, sessionId));
          }
        }
      };

      /**
       * 3. SỰ KIỆN ĐÓN NHẬN LUỒNG TỪ XA (pc.ontrack):
       * Kích hoạt độc lập cho TỪNG camera và audio mà đối phương gửi đến trên cùng đường truyền.
       */
      pc.ontrack = (event) => {
        console.log(`[WebRTC] Nhận được remote track: kind=${event.track.kind}, id=${event.track.id}`);

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
            console.log(`[WebRTC] Remote track ${trackId} đã kết thúc`);
            setRemoteCameras(prev => prev.filter(c => c.id !== trackId));
          };
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (sessionId !== pcSessionIdRef.current) return;
        setIceConnectionState(pc.iceConnectionState);
        console.log(`[WebRTC] ICE connection state: ${pc.iceConnectionState}`);

        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          iceRestartAttemptedRef.current = false;
          // Đảm bảo thông số chất lượng (mặc định 720p ở trạng thái grid) được áp dụng chắc chắn sau khi nối mạng
          localCamerasRef.current.forEach(cam => {
            const targetMode: VideoQualityMode = !remotePinnedCameraIdRef.current
              ? 'grid'
              : remotePinnedCameraIdRef.current === cam.id
              ? 'high'
              : 'low';
            applyEncodingQuality(cam.id, targetMode);
          });
        } else if (pc.iceConnectionState === 'failed' && !iceRestartAttemptedRef.current) {
          iceRestartAttemptedRef.current = true;
          console.warn('[WebRTC] ICE bị failed, thử ICE Restart tự động...');
          if (typeof pc.restartIce === 'function') {
            pc.restartIce();
          }
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Trạng thái kết nối mạng: ${pc.connectionState}`);
      };

      // 4. Gắn luồng âm thanh Micro (nếu đã bật trước khi peer vào)
      const audioStream = localAudioStreamRef.current;
      const audioTrack = localAudioTrackRef.current;
      if (audioTrack && audioTrack.readyState === 'live') {
        audioTrack.enabled = !isMutedRef.current;
        const stream = audioStream || new MediaStream([audioTrack]);
        audioSenderRef.current = pc.addTrack(audioTrack, stream);
      }

      // 5. Gắn TẤT CẢ các camera cục bộ đang hoạt động vào kết nối này (ở chế độ 720p grid mặc định)
      localCamerasRef.current.forEach(cam => {
        const track = cam.stream.getVideoTracks()[0];
        if (track && track.readyState === 'live') {
          const sender = pc.addTrack(track, cam.stream);
          cameraSendersRef.current.set(cam.id, sender);
          applyEncodingQuality(cam.id, 'grid');
        }
      });

      // Xử lý Offer đến sớm (nếu có) trước khi PeerConnection khởi tạo xong
      if (pendingOfferRef.current) {
        const queued = pendingOfferRef.current;
        pendingOfferRef.current = null;
        enqueueIncomingOffer(queued.senderId, queued.offer, queued.camerasMeta);
      }

      return pc;
    };

    // Khi kết nối thành công tới WebSocket Signaling Server
    socketInstance.on('connect', () => {
      console.log('[Socket] Đã kết nối tới Signaling Server');
      setIsConnected(true);
      socketInstance.emit('join-room', { roomId, userName });
    });

    socketInstance.on('disconnect', () => {
      console.log('[Socket] Đã ngắt kết nối khỏi Signaling Server');
      setIsConnected(false);
    });

    // Nhận thông báo phòng đã đủ 2 người (1-on-1 limit)
    socketInstance.on('room-full', ({ roomId: fullRoomId, max }: { roomId: string; max: number }) => {
      console.warn(`[Socket] Phòng ${fullRoomId} đã đủ ${max} người`);
      setIsRoomFull(true);
    });

    // Khi máy mình tham gia thành công vào phòng
    socketInstance.on(
      'room-joined',
      async ({
        isPolite: politeRole,
        peers,
        whiteboard
      }: {
        roomId: string;
        yourId: string;
        isPolite: boolean;
        peers: any[];
        whiteboard?: WhiteboardState;
      }) => {
        isPoliteRef.current = politeRole;
        setIsPolite(politeRole);
        console.log(`[Socket] Vào phòng thành công. Vai trò isPolite: ${politeRole}. Danh sách peers hiện có:`, peers);

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
          pcInitPromiseRef.current = setupPeerConnection(); // Khởi tạo PeerConnection
        }

        // Đồng bộ trạng thái tắt/bật mic ban đầu của máy mình lên phòng
        socketInstance.emit('mic-state-update', { isMuted: isMutedRef.current });
      }
    );

    // Khi có người thứ 2 tham gia vào phòng
    socketInstance.on('peer-joined', ({ peerId, peerName, isPolite: remoteIsPolite }: { peerId: string; peerName: string; isPolite: boolean }) => {
      console.log(`[Socket] Người đối diện đã vào phòng: ${peerName} (${peerId}), isPolite từ xa: ${remoteIsPolite}`);
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

      // Người vào trước (Impolite Initiator) chuẩn bị kết nối và gửi Offer đầu tiên
      pcInitPromiseRef.current = setupPeerConnection();
      // Đồng bộ lại trạng thái mic hiện tại của máy mình cho người mới vào biết
      socketInstance.emit('mic-state-update', { isMuted: isMutedRef.current });
    });

    /**
     * XỬ LÝ NHẬN SDP OFFER TỪ ĐỐI PHƯƠNG (Giải quyết xung đột Glare Collision):
     */
    socketInstance.on('signal-offer', ({ senderId, offer, camerasMeta }) => {
      enqueueIncomingOffer(senderId, offer, camerasMeta);
    });

    /**
     * XỬ LÝ NHẬN SDP ANSWER TỪ ĐỐI PHƯƠNG
     */
    socketInstance.on('signal-answer', ({ answer, camerasMeta }) => {
      signalingQueueRef.current = signalingQueueRef.current.then(async () => {
        if (pcInitPromiseRef.current) {
          await pcInitPromiseRef.current;
        }
        const pc = pcRef.current;
        if (!pc || pc.signalingState === 'closed') return;

        if (camerasMeta) {
          updateRemoteCameraMeta(camerasMeta);
        }

        if (pc.signalingState !== 'have-local-offer') {
          console.warn(`[WebRTC] Bỏ qua signal-answer vì signalingState hiện tại là ${pc.signalingState}`);
          return;
        }

        try {
          isSettingRemoteAnswerPendingRef.current = true;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          isSettingRemoteAnswerPendingRef.current = false;

          // Xử lý nốt các gói ICE candidate trong hàng đợi
          await flushIceCandidateQueue(pc);
        } catch (err) {
          console.error('[WebRTC] Lỗi xử lý signal-answer:', err);
        } finally {
          isSettingRemoteAnswerPendingRef.current = false;
        }
      });
    });

    /**
     * XỬ LÝ NHẬN GÓI ỨNG VIÊN MẠNG ICE CANDIDATE
     */
    socketInstance.on('signal-ice-candidate', async ({ candidate }) => {
      if (!candidate) return;
      const pc = pcRef.current;
      // Nếu chưa tạo pcRef hoặc chưa có remoteDescription, giữ candidate vào hàng đợi (không làm mất!)
      if (!pc || !pc.remoteDescription || isSettingRemoteAnswerPendingRef.current) {
        iceCandidateQueueRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        if (!ignoreOfferRef.current) {
          console.warn('[WebRTC] Lỗi nạp ICE candidate:', err);
        }
      }
    });

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
      console.log(`[Socket] Đối phương đã rời phòng: ${peerName} (${peerId})`);
      pcSessionIdRef.current++;
      if (pcRef.current) {
        try { pcRef.current.close(); } catch (_) {}
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
      setStats(null);
      setLocalQualityModes({});
      if (remoteAudioElemRef.current) remoteAudioElemRef.current.srcObject = null;
    });

    /**
     * ĐO KIỂM THÔNG SỐ MẠNG ĐỊNH KỲ (pc.getStats):
     * Đo RTT, tỉ lệ mất gói, FPS, độ phân giải thực tế và loại kết nối ICE (host/srflx/relay).
     */
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
        let fps = 0;
        let resolution = '';
        let audioBitrate = 0;
        let selectedPairId: string | undefined;
        let candidateType: string | undefined;
        const localCandidates = new Map<string, string>();
        const candidatePairs = new Map<string, any>();

        statsReport.forEach(report => {
          if (report.type === 'transport' && report.selectedCandidatePairId) {
            selectedPairId = report.selectedCandidatePairId;
          }
          if (report.type === 'local-candidate' && report.candidateType) {
            localCandidates.set(report.id, report.candidateType);
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
          Array.from(candidatePairs.values()).find(p => p.nominated && p.state === 'succeeded');
        if (activePair) {
          if (activePair.currentRoundTripTime) {
            rtt = Math.round(activePair.currentRoundTripTime * 1000);
          }
          if (activePair.localCandidateId) {
            candidateType = localCandidates.get(activePair.localCandidateId);
          }
        }

        setStats({
          rtt,
          packetsLost,
          videoBitrate,
          resolution: resolution || '1280x720',
          fps: fps || 24,
          audioBitrate,
          candidateType
        });
      } catch (e) {
        // Bỏ qua lỗi thống kê nếu ngắt kết nối đột ngột
      }
    }, 2000);

    /**
     * DỌN DẸP BỘ NHỚ VÀ GIẢI PHÓNG PHẦN CỨNG KHI RỜI PHÒNG (CLEANUP):
     */
    return () => {
      pcSessionIdRef.current++;
      clearInterval(statsInterval);
      socketInstance.disconnect();
      socketRef.current = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      pcInitPromiseRef.current = null;
      iceCandidateQueueRef.current = [];
      pendingOfferRef.current = null;
      // Tắt tất cả các track webcam để tắt đèn camera
      localCamerasRef.current.forEach(cam => cam.stream.getTracks().forEach(t => t.stop()));
      localCamerasRef.current = [];
      // Tắt micro
      audioInitPromiseRef.current = null;
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(t => t.stop());
        localAudioStreamRef.current = null;
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current = null;
      }
      if (remoteAudioElemRef.current) {
        remoteAudioElemRef.current.srcObject = null;
        remoteAudioElemRef.current = null;
      }
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
