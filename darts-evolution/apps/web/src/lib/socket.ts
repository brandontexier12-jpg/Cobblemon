import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** Connexion temps réel unique, reconnectée automatiquement par Socket.IO. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/socket.io", transports: ["websocket", "polling"], reconnectionDelayMax: 5000 });
  }
  return socket;
}

export function emitAck<T>(event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket()
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error | null, response: T) => (err ? reject(err) : resolve(response)));
  });
}
