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
import { CameraSource, RemoteCameraStream, CameraMeta, PeerInfo, ChatMessage, WebRTCStats } from '../types';
import { ICE_SERVERS } from '../constants/webrtc';

export function useWebRTC(roomId: string, userName: string) {
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
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Danh sách các luồng camera đang hoạt động
  const [localCameras, setLocalCameras] = useState<CameraSource[]>([]);       // Camera máy mình đang phát
  const [remoteCameras, setRemoteCameras] = useState<RemoteCameraStream[]>([]); // Camera nhận được từ đối phương
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]); // Danh sách webcam phần cứng quét được

  // Tin nhắn chat và thông số đo kiểm mạng
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [stats, setStats] = useState<WebRTCStats | null>(null);

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
  const cameraSendersRef = useRef<Map<string, RTCRtpSender>>(new Map()); // Quản lý các bộ phát video: Map cameraId -> RTCRtpSender
  const remoteAudioElemRef = useRef<HTMLAudioElement | null>(null);
  const peerInfoRef = useRef<PeerInfo | null>(null);

  // Các biến cờ trạng thái phục vụ cỗ máy W3C Perfect Negotiation
  const isPoliteRef = useRef<boolean>(false);
  const makingOfferRef = useRef<boolean>(false); // Đang trong quá trình tạo Offer cục bộ
  const ignoreOfferRef = useRef<boolean>(false); // Cờ bỏ qua Offer đối phương nếu xảy ra xung đột (dành cho Impolite)
  const isSettingRemoteAnswerPendingRef = useRef<boolean>(false); // Đang chờ áp dụng Remote Answer
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]); // Hàng đợi chứa các gói ICE đến sớm trước khi có Remote Description
  const remoteCameraMetaRef = useRef<CameraMeta[]>([]); // Bảng metadata camera của người bên kia

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
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, // Chống tiếng vang vọng
          noiseSuppression: true, // Lọc tiếng ồn môi trường
          autoGainControl: true   // Tự động cân bằng âm lượng
        },
        video: false
      });
      localAudioStreamRef.current = audioStream;
      setLocalAudioStream(audioStream);

      const track = audioStream.getAudioTracks()[0];
      localAudioTrackRef.current = track;

      // Nếu đã có kết nối RTCPeerConnection thì nạp track âm thanh vào ngay
      if (pcRef.current && track) {
        if (!audioSenderRef.current) {
          audioSenderRef.current = pcRef.current.addTrack(track, audioStream);
        }
      }
      return audioStream;
    } catch (err) {
      console.warn('[Audio] Không thể lấy quyền truy cập micro:', err);
      return null;
    }
  }, []);

  /**
   * Bật/Tắt Micro (Mute/Unmute) và thông báo trạng thái cho người bên kia
   */
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
         * Thử tuần tự 5 tầng cấu hình (Progressive Constraints Fallback):
         * - Tầng 1: Đúng deviceId với độ phân giải lý tưởng 720p (1280x720).
         * - Tầng 2: Đúng deviceId nhưng hạ xuống 480p (640x480) - CỰC KỲ QUAN TRỌNG:
         *           giúp giảm băng thông bus USB xuống còn ~147 Mbps để mở được camera thứ 2.
         * - Tầng 3: Hạ xuống 360p (480x360) siêu nhẹ (~82 Mbps).
         * - Tầng 4: Bỏ giới hạn độ phân giải để camera tự đàm phán nén phần cứng (MJPEG/H.264).
         * - Tầng 5: Truyền trực tiếp chuỗi deviceId cho các trình duyệt/driver đời cũ.
         */
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
              console.log('[Camera] Mở thành công camera vật lý với cấu hình:', candidate);
              break;
            }
          } catch (err: any) {
            lastError = err;
            console.warn('[Camera] Thử cấu hình thất bại với device', deviceId, err.name, err.message);
          }
        }

        // Nếu cả 5 cấu hình exact đều thất bại, thử sang cấu hình 'ideal' làm phương án cứu cánh cuối cùng
        if (!stream) {
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { ideal: deviceId } },
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
        // Nếu không chỉ định deviceId cụ thể, mở camera mặc định với fallback phân giải
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
      if (pcRef.current) {
        const sender = pcRef.current.addTrack(track, stream);
        cameraSendersRef.current.set(cameraId, sender); // Lưu lại bộ phát để sau này gỡ bỏ khi tắt camera
      }

      refreshDevices();
      broadcastCameraState();
      return newCam;
    } catch (err) {
      console.error('[Camera] Không thể thêm camera vật lý:', err);
      throw err;
    }
  }, [broadcastCameraState, refreshDevices]);

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

      if (pcRef.current) {
        const sender = pcRef.current.addTrack(track, stream);
        cameraSendersRef.current.set(cameraId, sender);
      }

      broadcastCameraState();
      return newCam;
    } catch (err) {
      console.warn('[ScreenShare] Người dùng hủy hoặc chia sẻ màn hình thất bại:', err);
      return null;
    }
  }, [broadcastCameraState, removeCamera]);

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
   * Gửi tin nhắn văn bản tức thời trong phòng qua Signaling Server
   */
  const sendMessage = useCallback((text: string) => {
    if (!socketRef.current || !text.trim()) return;
    socketRef.current.emit('send-chat', { text: text.trim() });
  }, []);

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

    /**
     * HÀM THIẾT LẬP KẾT NỐI RTCPeerConnection DUY NHẤT:
     * Cấu hình STUN servers, gắn các track âm thanh, các camera cục bộ và đăng ký các sự kiện mạng.
     */
    const setupPeerConnection = () => {
      if (pcRef.current) {
        try { pcRef.current.close(); } catch (_) {}
      }
      cameraSendersRef.current.clear();
      audioSenderRef.current = null;
      iceCandidateQueueRef.current = [];

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // 1. Gắn luồng âm thanh Micro (nếu đã bật)
      const audioStream = localAudioStreamRef.current;
      const audioTrack = localAudioTrackRef.current;
      if (audioTrack && audioTrack.readyState === 'live') {
        const stream = audioStream || new MediaStream([audioTrack]);
        audioSenderRef.current = pc.addTrack(audioTrack, stream);
      }

      // 2. Gắn TẤT CẢ các camera cục bộ đang hoạt động vào kết nối này
      localCamerasRef.current.forEach(cam => {
        const track = cam.stream.getVideoTracks()[0];
        if (track && track.readyState === 'live') {
          const sender = pc.addTrack(track, cam.stream);
          cameraSendersRef.current.set(cam.id, sender);
        }
      });

      // 3. Sự kiện thu thập ứng viên mạng ICE Candidate và gửi sang đối phương
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('signal-ice-candidate', { candidate: event.candidate });
        }
      };

      /**
       * 4. SỰ KIỆN TỰ ĐỘNG TÁI ĐÀM PHÁN (W3C Perfect Negotiation Pattern):
       * Bất cứ khi nào gọi addTrack hoặc removeTrack, sự kiện này tự động kích hoạt
       * để sinh ra SDP Offer mới chứa đầy đủ các khối m=video và gửi qua Signaling.
       */
      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current = true;
          await pc.setLocalDescription(); // Tạo SDP Offer mới (chứa nhiều m=video)
          console.log('[WebRTC] Tự động gửi SDP Offer từ sự kiện onnegotiationneeded');
          socketRef.current?.emit('signal-offer', {
            offer: pc.localDescription,
            camerasMeta: getLocalCamerasMeta() // Đính kèm metadata camera để phía nhận biết thông tin
          });
        } catch (err) {
          console.error('[WebRTC] Lỗi trong quá trình onnegotiationneeded:', err);
        } finally {
          makingOfferRef.current = false;
        }
      };

      /**
       * 5. SỰ KIỆN ĐÓN NHẬN LUỒNG TỪ XA (pc.ontrack):
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

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Trạng thái kết nối mạng: ${pc.connectionState}`);
      };

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
    socketInstance.on('room-joined', async ({ isPolite: politeRole, peers }: { roomId: string; yourId: string; isPolite: boolean; peers: any[] }) => {
      isPoliteRef.current = politeRole;
      setIsPolite(politeRole);
      console.log(`[Socket] Vào phòng thành công. Vai trò isPolite: ${politeRole}. Danh sách peers hiện có:`, peers);

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
        setupPeerConnection(); // Khởi tạo PeerConnection
      }
    });

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

      // Người vào trước (Impolite Initiator) chuẩn bị kết nối và gửi Offer đầu tiên
      setupPeerConnection();
    });

    /**
     * XỬ LÝ NHẬN SDP OFFER TỪ ĐỐI PHƯƠNG (Giải quyết xung đột Glare Collision):
     */
    socketInstance.on('signal-offer', async ({ senderId, offer, camerasMeta }) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (camerasMeta) {
        updateRemoteCameraMeta(camerasMeta);
      }

      try {
        // Kiểm tra xem máy này có đang bận tạo Offer hay đang trong trạng thái sẵn sàng nhận Offer không
        const readyForOffer =
          !makingOfferRef.current &&
          (pc.signalingState === 'stable' || isSettingRemoteAnswerPendingRef.current);
        const offerCollision = !readyForOffer; // Xảy ra va chạm đàm phán (Glare Condition)!

        // NẾU LÀ IMPOLITE (Chủ động): Bỏ qua Offer từ đối phương khi va chạm
        ignoreOfferRef.current = !isPoliteRef.current && offerCollision;
        if (ignoreOfferRef.current) {
          console.log('[WebRTC] Va chạm đàm phán (Glare): Máy chủ động (Impolite) bỏ qua Offer của đối phương');
          return;
        }

        // NẾU LÀ POLITE (Nhường nhịn): Chủ động rollback Offer của mình về trạng thái stable
        if (offerCollision && isPoliteRef.current) {
          console.log('[WebRTC] Va chạm đàm phán (Glare): Máy nhường nhịn (Polite) rollback local offer để nhận remote offer');
          if (pc.signalingState === 'have-local-offer') {
            try {
              await pc.setLocalDescription({ type: 'rollback' }); // Hủy Offer của mình
            } catch (e) {
              console.warn('[WebRTC] Lỗi rollback:', e);
            }
          }
        }

        // Áp dụng mô tả từ đối phương
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Xử lý các gói ICE candidate đã xếp hàng đợi trước đó
        while (iceCandidateQueueRef.current.length > 0) {
          const cand = iceCandidateQueueRef.current.shift();
          if (cand) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('[WebRTC] Lỗi thêm ICE candidate trong hàng đợi:', e);
            }
          }
        }

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

    /**
     * XỬ LÝ NHẬN SDP ANSWER TỪ ĐỐI PHƯƠNG
     */
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

        // Xử lý nốt các gói ICE candidate trong hàng đợi
        while (iceCandidateQueueRef.current.length > 0) {
          const cand = iceCandidateQueueRef.current.shift();
          if (cand) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('[WebRTC] Lỗi thêm ICE candidate trong hàng đợi:', e);
            }
          }
        }
      } catch (err) {
        console.error('[WebRTC] Lỗi xử lý signal-answer:', err);
      } finally {
        isSettingRemoteAnswerPendingRef.current = false;
      }
    });

    /**
     * XỬ LÝ NHẬN GÓI ỨNG VIÊN MẠNG ICE CANDIDATE
     */
    socketInstance.on('signal-ice-candidate', async ({ candidate }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        // Nếu chưa thiết lập remote description xong, đưa candidate vào hàng đợi chờ
        if (!pc.remoteDescription || isSettingRemoteAnswerPendingRef.current) {
          iceCandidateQueueRef.current.push(candidate);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
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

    // Nhận tin nhắn chat
    socketInstance.on('chat-message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
    });

    // Khi đối phương rời phòng họp
    socketInstance.on('peer-left', ({ peerId, peerName }: { peerId: string; peerName: string }) => {
      console.log(`[Socket] Đối phương đã rời phòng: ${peerName} (${peerId})`);
      peerInfoRef.current = null;
      setPeerInfo(null);
      setRemoteCameras([]);
      remoteCameraMetaRef.current = [];
      setRemoteAudioStream(null);
      if (remoteAudioElemRef.current) remoteAudioElemRef.current.srcObject = null;
    });

    /**
     * ĐO KIỂM THÔNG SỐ MẠNG ĐỊNH KỲ (pc.getStats):
     * Đo RTT, tỉ lệ mất gói, FPS, độ phân giải thực tế của luồng video đang nhận.
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
        let fps = 30;
        let resolution = '1280x720';
        let audioBitrate = 0;

        statsReport.forEach(report => {
          // Đo độ trễ khứ hồi RTT (Round Trip Time)
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
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

        setStats({
          rtt,
          packetsLost,
          videoBitrate,
          resolution,
          fps,
          audioBitrate
        });
      } catch (e) {
        // Bỏ qua lỗi thống kê nếu ngắt kết nối đột ngột
      }
    }, 2000);

    /**
     * DỌN DẸP BỘ NHỚ VÀ GIẢI PHÓNG PHẦN CỨNG KHI RỜI PHÒNG (CLEANUP):
     */
    return () => {
      clearInterval(statsInterval);
      socketInstance.disconnect();
      socketRef.current = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      // Tắt tất cả các track webcam để tắt đèn camera
      localCamerasRef.current.forEach(cam => cam.stream.getTracks().forEach(t => t.stop()));
      localCamerasRef.current = [];
      // Tắt micro
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
    addScreenShare,
    removeCamera,
    toggleCamera,
    chatMessages,
    sendMessage,
    stats
  };
}
