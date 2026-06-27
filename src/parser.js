const imeiPattern = /\b\d{15}\b/;
const decimalCoordinatePattern = /(-?\d{1,2}\.\d{4,})[,;\s]+(-?\d{1,3}\.\d{4,})/;

export function parseTrackerPacket(rawAscii) {
  const deviceId = rawAscii.match(imeiPattern)?.[0] ?? 'unknown';

  // Temporary helper for development packets that already contain decimal coordinates.
  // The ST-901M protocol parser will replace this after real RAW packets are captured.
  const coordinateMatch = rawAscii.match(decimalCoordinatePattern);
  if (!coordinateMatch) {
    return { deviceId, location: null };
  }

  const lat = Number.parseFloat(coordinateMatch[1]);
  const lon = Number.parseFloat(coordinateMatch[2]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { deviceId, location: null };
  }

  return {
    deviceId,
    location: {
      deviceId,
      lat,
      lon,
      speed: null,
      time: new Date().toISOString(),
    },
  };
}
