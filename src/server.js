import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getLastLocation, initDb } from './db.js';
import { startCombinedServer } from './combinedServer.js';
import { startTcpServer } from './tcpServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serviceMode = process.env.SERVICE_MODE ?? 'all';

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/location', async (_request, response, next) => {
  try {
    const location = await getLastLocation();

    if (!location) {
      response.json({
        deviceId: null,
        lat: null,
        lon: null,
        speed: null,
        time: null,
        online: false,
      });
      return;
    }

    const time = location.time instanceof Date ? location.time.toISOString() : location.time;
    const updatedAt = location.updatedAt instanceof Date
      ? location.updatedAt.toISOString()
      : location.updatedAt;
    const onlineTime = updatedAt ?? time;
    const ageMs = Date.now() - new Date(onlineTime).getTime();

    response.json({
      deviceId: location.deviceId,
      lat: location.lat,
      lon: location.lon,
      speed: location.speed,
      time,
      online: Number.isFinite(ageMs) && ageMs < 120_000,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error('[http] request failed', error);
  response.status(500).json({ error: 'Internal server error' });
});

await initDb();

let httpServer = null;
let tcpServer = null;
let combinedServer = null;
const trackerPort = Number.parseInt(process.env.TRACKER_PORT ?? process.env.PORT ?? '5001', 10);
const useCombinedServer = serviceMode === 'all' && port === trackerPort;

if (useCombinedServer) {
  combinedServer = startCombinedServer(app, port);
} else if (serviceMode === 'all' || serviceMode === 'http') {
  httpServer = app.listen(port, () => {
    console.log(`[http] listening on 0.0.0.0:${port}`);
  });
}

if (!useCombinedServer && (serviceMode === 'all' || serviceMode === 'tcp')) {
  tcpServer = startTcpServer();
}

async function shutdown(signal) {
  console.log(`[app] received ${signal}, shutting down`);
  combinedServer?.close();
  httpServer?.close();
  tcpServer?.close();
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
