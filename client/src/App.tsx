/**
 * ============================================================================
 * MODULE: CLIENT ROOT - APP COMPONENT & ROUTING
 * ============================================================================
 * Điều phối luồng màn hình chính giữa Lobby (Phòng chờ) và Room (Phòng gọi P2P):
 *  - Phân tích Query Parameter (?room=meet-xxx-xxx) trên URL khi người dùng mở link mời.
 *  - Cập nhật URL động qua HTML5 History API (pushState) không làm tải lại trang.
 */

import React, { useState, useEffect } from 'react';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';

interface JoinConfig {
  roomId: string;
  userName: string;
  initialAudio: boolean;
  initialVideo: boolean;
}

function getRoomFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  return roomParam ? roomParam.trim().toLowerCase() : '';
}

export function App() {
  const [initialRoomId, setInitialRoomId] = useState<string>(() => getRoomFromUrl());
  const [currentConfig, setCurrentConfig] = useState<JoinConfig | null>(null);
  // Đánh dấu người dùng vừa chủ động rời phòng -> khi quay lại Lobby sẽ tắt sẵn camera/mic preview
  const [justLeftRoom, setJustLeftRoom] = useState<boolean>(false);

  /**
   * Lắng nghe nút Back của trình duyệt / thao tác vuốt quay lại trên điện thoại:
   * Khi vào phòng ta gắn cờ { inRoom: true } vào History state; lúc người dùng bấm Back,
   * state quay về trạng thái cũ (không có inRoom) -> lập tức unmount <Room /> để ngắt WebRTC ngay,
   * kể cả trường hợp mở trực tiếp từ link mời đã có sẵn ?room=xxx trên URL.
   */
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const roomFromUrl = getRoomFromUrl();
      setInitialRoomId(roomFromUrl);
      if (!event.state?.inRoom) {
        setJustLeftRoom(true);
        setCurrentConfig(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  /**
   * Chuyển từ Sảnh chờ (Lobby) vào Phòng gọi (Room) và đẩy mốc lịch sử { inRoom: true }
   */
  const handleJoinRoom = (
    roomId: string,
    userName: string,
    initialAudio: boolean,
    initialVideo: boolean
  ) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.pushState({ inRoom: true, roomId }, '', url.toString());

    setInitialRoomId(roomId);
    setJustLeftRoom(false);
    setCurrentConfig({
      roomId,
      userName,
      initialAudio,
      initialVideo
    });
  };

  /**
   * Rời phòng gọi: xóa trạng thái inRoom khỏi lịch sử hiện tại và quay về Lobby với cam/mic tắt sẵn
   */
  const handleLeaveRoom = () => {
    if (window.history.state?.inRoom) {
      window.history.replaceState({ inRoom: false }, '', window.location.href);
    }
    setJustLeftRoom(true);
    setCurrentConfig(null);
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink-primary font-sans selection:bg-accent/15 selection:text-accent">
      {currentConfig ? (
        <Room
          roomId={currentConfig.roomId}
          userName={currentConfig.userName}
          initialAudio={currentConfig.initialAudio}
          initialVideo={currentConfig.initialVideo}
          onLeaveRoom={handleLeaveRoom}
        />
      ) : (
        <Lobby
          initialRoomId={initialRoomId}
          startMediaOff={justLeftRoom}
          onJoinRoom={handleJoinRoom}
        />
      )}
    </div>
  );
}

export default App;
