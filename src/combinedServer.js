import net from 'node:net';
import http from 'node:http';
import { handleTrackerBuffer } from './tcpServer.js';

const httpMethods = ['GET ', 'POST ', 'PUT ', 'PATCH ', 'DELETE ', 'HEAD ', 'OPTIONS '];

export function startCombinedServer(app, port) {
  const httpServer = http.createServer(app);

  const server = net.createServer((socket) => {
    socket.once('data', (buffer) => {
      const prefix = buffer.toString('ascii', 0, Math.min(buffer.length, 8));

      if (httpMethods.some((method) => prefix.startsWith(method))) {
        socket.unshift(buffer);
        httpServer.emit('connection', socket);
        return;
      }

      socket.unshift(buffer);
      handleTrackerSocket(socket);
    });
  });

  server.on('error', (error) => {
    console.error('[combined] server error', error);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[combined] listening for HTTP and TCP on 0.0.0.0:${port}`);
  });

  return server;
}

function handleTrackerSocket(socket) {
  const remoteAddress = socket.remoteAddress;
  const remotePort = socket.remotePort;

  console.log(`[tcp] connected ${remoteAddress}:${remotePort}`);

  socket.on('data', async (buffer) => {
    await handleTrackerBuffer(socket, buffer, remoteAddress, remotePort);
  });

  socket.on('error', (error) => {
    console.error(`[tcp] socket error ${remoteAddress}:${remotePort}`, error.message);
  });

  socket.on('close', () => {
    console.log(`[tcp] disconnected ${remoteAddress}:${remotePort}`);
  });
}
