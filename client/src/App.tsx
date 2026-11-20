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

  useEffect(() => {
    const handlePopState = () => {
      const roomFromUrl = getRoomFromUrl();
      setInitialRoomId(roomFromUrl);
      if (!roomFromUrl) {
        setCurrentConfig(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleJoinRoom = (
    roomId: string,
    userName: string,
    initialAudio: boolean,
    initialVideo: boolean
  ) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.pushState({}, '', url.toString());

    setInitialRoomId(roomId);
    setCurrentConfig({
      roomId,
      userName,
      initialAudio,
      initialVideo
    });
  };

  const handleLeaveRoom = () => {
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
          onJoinRoom={handleJoinRoom}
        />
      )}
    </div>
  );
}

export default App;
