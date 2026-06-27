import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backfillTrackPointsFromRawPackets,
  closeDb,
  getLastLocation,
  getTrackForDate,
  initDb,
} from './db.js';
import { startCombinedServer } from './combinedServer.js';
import { parseTrackerPacket } from './parser.js';
import { startTcpServer } from './tcpServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpPort = Number.parseInt(
  process.env.HTTP_PORT
    ?? (process.env.RAILWAY_TCP_APPLICATION_PORT ? '8080' : process.env.PORT ?? '3000'),
  10,
);
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

app.get('/api/track', async (request, response, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const date = String(request.query.date ?? today);
    const timezoneOffsetMinutes = Number.parseInt(String(request.query.tzOffset ?? '0'), 10);
    const speedLimit = Number.parseFloat(String(request.query.speedLimit ?? '60'));
    const points = await getTrackForDate({
      date,
      timezoneOffsetMinutes: Number.isFinite(timezoneOffsetMinutes) ? timezoneOffsetMinutes : 0,
    });

    const overspeedPoints = points.filter((point) => Number.isFinite(point.speed) && point.speed > speedLimit);
    const speeds = points
      .map((point) => point.speed)
      .filter((speed) => Number.isFinite(speed));

    response.json({
      date,
      speedLimit,
      count: points.length,
      overspeedCount: overspeedPoints.length,
      maxSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
      points,
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
await backfillTrackPointsFromRawPackets(parseTrackerPacket);

let httpServer = null;
let tcpServer = null;
let combinedServer = null;
const trackerPort = Number.parseInt(
  process.env.TRACKER_PORT ?? process.env.RAILWAY_TCP_APPLICATION_PORT ?? process.env.PORT ?? '5001',
  10,
);
const useCombinedServer = serviceMode === 'all' && httpPort === trackerPort;

if (useCombinedServer) {
  combinedServer = startCombinedServer(app, httpPort);
} else if (serviceMode === 'all' || serviceMode === 'http') {
  httpServer = app.listen(httpPort, () => {
    console.log(`[http] listening on 0.0.0.0:${httpPort}`);
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
