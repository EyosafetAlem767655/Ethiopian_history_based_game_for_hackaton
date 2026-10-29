import type { Server as HttpServer } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';

// Both protocols share one deployed port. Each WebSocket upgrade must be handled
// by exactly one server; otherwise Socket.IO and Colyseus can corrupt each other.
export class SharedGameTransport extends WebSocketTransport {
  constructor(server: HttpServer) {
    super({ noServer: true, pingInterval: 0 });
    this.server = server;
    server.on('listening', () => this.autoTerminateUnresponsiveClients(3000, 2));
    server.on('close', () => clearInterval(this.pingInterval));
    server.on('upgrade', (request, socket, head) => {
      let path: string;
      try {
        path = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (path === '/socket.io/' || path === '/socket.io') return;
      this.wss.handleUpgrade(request, socket, head, (client) => {
        this.wss.emit('connection', client, request);
      });
    });
  }
}
