// ============================================================
//  socket.js — one shared Socket.io connection (authenticated)
// ============================================================
import { io } from 'socket.io-client';
import { getToken, BASE } from './api';

let socket = null;

export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  // reuse the existing connection if it is alive or still connecting
  if (socket && (socket.connected || socket.active)) return socket;
  if (socket) socket.disconnect();
  socket = io(BASE || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
