const imeiPattern = /\b\d{15}\b/;
const decimalCoordinatePattern = /(-?\d{1,2}\.\d{4,})[,;\s]+(-?\d{1,3}\.\d{4,})/;

export function parseTrackerPacket(rawAscii) {
  const sinotrack = parseSinotrackHqPacket(rawAscii);
  if (sinotrack) {
    return sinotrack;
  }

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

function parseSinotrackHqPacket(rawAscii) {
  const packet = rawAscii.trim();
  if (!packet.startsWith('*HQ,') || !packet.endsWith('#')) {
    return null;
  }

  const fields = packet.slice(1, -1).split(',');
  const [
    header,
    deviceId,
    protocol,
    timeValue,
    fixStatus,
    latValue,
    latHemisphere,
    lonValue,
    lonHemisphere,
    speedValue,
    courseValue,
    dateValue,
  ] = fields;

  if (header !== 'HQ' || !deviceId || !protocol || fixStatus !== 'A') {
    return { deviceId: deviceId ?? 'unknown', location: null };
  }

  const lat = parseNmeaCoordinate(latValue, latHemisphere, 2);
  const lon = parseNmeaCoordinate(lonValue, lonHemisphere, 3);
  const time = parseDeviceDateTime(dateValue, timeValue);
  const speed = Number.parseFloat(speedValue);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { deviceId, location: null };
  }

  return {
    deviceId,
    location: {
      deviceId,
      lat,
      lon,
      speed: Number.isFinite(speed) ? speed : null,
      course: Number.isFinite(Number.parseFloat(courseValue)) ? Number.parseFloat(courseValue) : null,
      time: time ?? new Date().toISOString(),
    },
  };
}

function parseNmeaCoordinate(value, hemisphere, degreeDigits) {
  if (!value || !hemisphere) {
    return null;
  }

  const degrees = Number.parseInt(value.slice(0, degreeDigits), 10);
  const minutes = Number.parseFloat(value.slice(degreeDigits));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) {
    return null;
  }

  const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1;
  return sign * (degrees + minutes / 60);
}

function parseDeviceDateTime(dateValue, timeValue) {
  if (!/^\d{6}$/.test(dateValue ?? '') || !/^\d{6}$/.test(timeValue ?? '')) {
    return null;
  }

  const day = Number.parseInt(dateValue.slice(0, 2), 10);
  const month = Number.parseInt(dateValue.slice(2, 4), 10) - 1;
  const year = 2000 + Number.parseInt(dateValue.slice(4, 6), 10);
  const hour = Number.parseInt(timeValue.slice(0, 2), 10);
  const minute = Number.parseInt(timeValue.slice(2, 4), 10);
  const second = Number.parseInt(timeValue.slice(4, 6), 10);

  return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
}
