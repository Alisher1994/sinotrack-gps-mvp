import net from 'node:net';
import { parseTrackerPacket } from './parser.js';
import { saveLocation, saveRawPacket } from './db.js';

function getAckBuffer() {
  if (process.env.TRACKER_ACK_HEX) {
    return Buffer.from(process.env.TRACKER_ACK_HEX, 'hex');
  }

  if (process.env.TRACKER_ACK_ASCII) {
    return Buffer.from(process.env.TRACKER_ACK_ASCII, 'utf8');
  }

  return null;
}

export function startTcpServer() {
  const port = Number.parseInt(
    process.env.TRACKER_PORT ?? process.env.RAILWAY_TCP_APPLICATION_PORT ?? process.env.PORT ?? '5001',
    10,
  );

  const server = net.createServer((socket) => {
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
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[tcp] listening on 0.0.0.0:${port}`);
  });

  return server;
}

export async function handleTrackerBuffer(socket, buffer, remoteAddress, remotePort) {
  const ackBuffer = getAckBuffer();
  const rawHex = buffer.toString('hex');
  const rawAscii = buffer.toString('utf8').replace(/\0/g, '');
  const parsed = parseTrackerPacket(rawAscii);

  console.log(`[tcp] raw hex ${rawHex}`);
  console.log(`[tcp] raw ascii ${JSON.stringify(rawAscii)}`);

  try {
    const rawPacketId = await saveRawPacket({
      deviceId: parsed.deviceId,
      remoteAddress,
      remotePort,
      rawHex,
      rawAscii,
    });

    if (parsed.location) {
      await saveLocation({
        ...parsed.location,
        rawPacketId,
      });
      console.log(`[tcp] location ${parsed.location.deviceId} ${parsed.location.lat},${parsed.location.lon}`);
    }

    if (ackBuffer) {
      socket.write(ackBuffer);
      console.log(`[tcp] ack ${ackBuffer.toString('hex')}`);
    }
  } catch (error) {
    console.error('[tcp] failed to process packet', error);
  }
}
