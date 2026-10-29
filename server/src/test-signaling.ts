/**
 * ============================================================================
 * MODULE: TEST SUITE - AUTOMATED NESTJS SIGNALING & MULTI-CAMERA TESTS
 * ============================================================================
 * Kiểm thử tự động 8 ca kiểm thử trên nền tảng NestJS WebSocket Gateway:
 *   [Test 1] Alice tạo phòng và nhận vai trò Impolite initiator (isPolite: false)
 *   [Test 2] Bob vào cùng phòng, nhận vai trò Polite peer (isPolite: true), Alice nhận thông báo
 *   [Test 3] Charlie cố gắng vào phòng thứ 3 -> Bị máy chủ từ chối với mã room-full
 *   [Test 4] Alice bật 2 camera đồng thời (Webcam + Studio Clock) -> Bob nhận đúng metadata
 *   [Test 5] Đàm phán WebRTC Offer/Answer hai chiều kèm metadata các camera
 *   [Test 6] Chuyển tiếp ICE Candidates giữa 2 peer
 *   [Test 7] Chuyển tiếp tin nhắn văn bản tức thời (In-Call Chat)
 *   [Test 8] Bob rời phòng -> Alice nhận thông báo peer-left, phòng tự thu hồi tài nguyên
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { AppModule } from './app.module';

async function runSignalingTest() {
  console.log('--- Starting NestJS WebRTC Signaling & Multi-Camera Verification ---');
  
  const PORT = 3999;
  process.env.PORT = String(PORT);

  // Khởi động NestJS server ở chế độ silent log để output kiểm thử rõ ràng
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({ origin: '*' });
  await app.listen(PORT);

  console.log(`[Test NestJS Server] Running on http://localhost:${PORT}`);
  const url = `http://localhost:${PORT}`;

  try {
    // -------------------------------------------------------------
    // [Test 1] Alice joins room
    // -------------------------------------------------------------
    console.log('[Test 1] Connecting Alice...');
    const alice: ClientSocketType = ClientSocket(url);
    await new Promise<void>((resolve, reject) => {
      alice.on('connect', () => {
        alice.emit('join-room', { roomId: 'test-room-multicam', userName: 'Alice' });
      });
      alice.on('room-joined', (data) => {
        if (data.isPolite === false && data.peers.length === 0) {
          console.log(`✓ Alice joined room: ${data.roomId} isPolite: ${data.isPolite}`);
          resolve();
        } else {
          reject(new Error(`Alice unexpected role: ${JSON.stringify(data)}`));
        }
      });
      setTimeout(() => reject(new Error('Alice join timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 2] Bob joins room
    // -------------------------------------------------------------
    console.log('[Test 2] Connecting Bob...');
    const bob: ClientSocketType = ClientSocket(url);
    await new Promise<void>((resolve, reject) => {
      let bobJoined = false;
      let aliceNotified = false;

      bob.on('connect', () => {
        bob.emit('join-room', { roomId: 'test-room-multicam', userName: 'Bob' });
      });

      bob.on('room-joined', (data) => {
        if (data.isPolite === true && data.peers.length === 1 && data.peers[0].peerName === 'Alice') {
          console.log(`✓ Bob joined room: ${data.roomId} isPolite: ${data.isPolite}`);
          bobJoined = true;
          if (bobJoined && aliceNotified) resolve();
        } else {
          reject(new Error(`Bob unexpected room-joined data: ${JSON.stringify(data)}`));
        }
      });

      alice.on('peer-joined', (data) => {
        if (data.peerName === 'Bob' && data.isPolite === true) {
          console.log(`✓ Alice received peer-joined for Bob: ${data.peerName} isPolite: ${data.isPolite}`);
          aliceNotified = true;
          if (bobJoined && aliceNotified) resolve();
        }
      });

      setTimeout(() => reject(new Error('Bob join timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 3] Charlie attempts to join 1-on-1 full room
    // -------------------------------------------------------------
    console.log('[Test 3] Charlie attempting to join full 1-1 room...');
    const charlie: ClientSocketType = ClientSocket(url);
    await new Promise<void>((resolve, reject) => {
      charlie.on('connect', () => {
        charlie.emit('join-room', { roomId: 'test-room-multicam', userName: 'Charlie' });
      });

      charlie.on('room-full', (data) => {
        console.log(`✓ Charlie received room-full correctly:`, data);
        charlie.disconnect();
        resolve();
      });

      charlie.on('room-joined', () => {
        reject(new Error('Charlie should NOT be allowed into a 1-1 full room!'));
      });

      setTimeout(() => reject(new Error('Charlie timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 4] Alice activates 2 cameras simultaneously
    // -------------------------------------------------------------
    console.log('[Test 4] Alice activates 2 cameras (Physical Webcam + Studio Clock Simulator)...');
    await new Promise<void>((resolve, reject) => {
      const aliceCameras = [
        { id: 'physical-cam-1', label: 'Facecam HD', type: 'physical' },
        { id: 'virtual-clock', label: 'Studio Clock [Virtual]', type: 'virtual' }
      ];

      bob.on('peer-camera-updated', (data) => {
        if (data.cameras.length === 2) {
          console.log(`✓ Bob received Alice multi-camera update with 2 cameras:`, data.cameras.map((c: any) => c.label));
          resolve();
        } else {
          reject(new Error(`Expected 2 cameras from Alice, got: ${data.cameras.length}`));
        }
      });

      alice.emit('camera-state-update', { cameras: aliceCameras });
      setTimeout(() => reject(new Error('Camera state update timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 5] WebRTC Offer / Answer signaling exchange with camerasMeta
    // -------------------------------------------------------------
    console.log('[Test 5] Testing WebRTC Offer / Answer signaling exchange with camerasMeta...');
    await new Promise<void>((resolve, reject) => {
      const mockOffer = { type: 'offer' as const, sdp: 'v=0\r\no=alice 12345 2 IN IP4 127.0.0.1...' };
      const camerasMeta = [
        { cameraId: 'physical-cam-1', trackId: 'track-video-1', streamId: 'stream-1', label: 'Facecam HD', type: 'physical' as const },
        { cameraId: 'virtual-clock', trackId: 'track-video-2', streamId: 'stream-2', label: 'Studio Clock [Virtual]', type: 'virtual' as const }
      ];

      bob.on('signal-offer', (data) => {
        if (data.camerasMeta && data.camerasMeta.length === 2) {
          console.log(`✓ Bob received offer with multi-cam meta: ${data.camerasMeta.length} tracks`);
          
          const mockAnswer = { type: 'answer' as const, sdp: 'v=0\r\no=bob 67890 2 IN IP4 127.0.0.1...' };
          const bobCamerasMeta = [
            { cameraId: 'physical-cam-bob', trackId: 'track-video-bob', streamId: 'stream-bob', label: 'Bob Webcam', type: 'physical' as const }
          ];

          alice.on('signal-answer', (ansData) => {
            if (ansData.camerasMeta && ansData.camerasMeta.length === 1) {
              console.log(`✓ Alice received answer from Bob with camerasMeta: ${ansData.camerasMeta.length} tracks`);
              resolve();
            } else {
              reject(new Error(`Alice answer missing camerasMeta: ${JSON.stringify(ansData)}`));
            }
          });

          bob.emit('signal-answer', {
            targetId: data.senderId,
            answer: mockAnswer,
            camerasMeta: bobCamerasMeta
          });
        } else {
          reject(new Error(`Offer missing camerasMeta: ${JSON.stringify(data)}`));
        }
      });

      alice.emit('signal-offer', { offer: mockOffer, camerasMeta });
      setTimeout(() => reject(new Error('Offer/Answer exchange timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 6] ICE Candidate signaling
    // -------------------------------------------------------------
    console.log('[Test 6] Testing ICE Candidate signaling...');
    await new Promise<void>((resolve, reject) => {
      const mockCandidate = {
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0
      };

      bob.on('signal-ice-candidate', (data) => {
        if (data.candidate && data.candidate.sdpMLineIndex === 0) {
          console.log(`✓ Bob received ICE candidate: ${data.candidate.sdpMLineIndex}`);
          resolve();
        } else {
          reject(new Error('Invalid candidate payload'));
        }
      });

      alice.emit('signal-ice-candidate', { candidate: mockCandidate });
      setTimeout(() => reject(new Error('ICE candidate timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 7] In-Call Chat messaging
    // -------------------------------------------------------------
    console.log('[Test 7] Testing In-Call Chat messaging...');
    await new Promise<void>((resolve, reject) => {
      alice.on('chat-message', (msg) => {
        if (msg.text.includes('both of your cameras')) {
          console.log(`✓ Alice received chat message: "${msg.text}" from ${msg.senderName}`);
          resolve();
        }
      });

      bob.emit('send-chat', { text: 'Hello Alice, I can see both of your cameras clearly!' });
      setTimeout(() => reject(new Error('Chat timeout')), 3000);
    });

    // -------------------------------------------------------------
    // [Test 8] Bob disconnects, room updates
    // -------------------------------------------------------------
    console.log('[Test 8] Bob disconnects...');
    await new Promise<void>((resolve, reject) => {
      alice.on('peer-left', (data) => {
        if (data.peerName === 'Bob') {
          console.log(`✓ Alice received peer-left notification: ${data.peerName}`);
          resolve();
        }
      });
      bob.disconnect();
      setTimeout(() => reject(new Error('Disconnect notification timeout')), 3000);
    });

    alice.disconnect();
    console.log('--- ALL NESTJS SIGNALING & MULTI-CAMERA TESTS PASSED (8/8) ---');
  } finally {
    await app.close();
  }
}

runSignalingTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
