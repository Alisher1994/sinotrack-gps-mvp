import pg from 'pg';

const { Pool } = pg;

const memoryState = {
  lastLocation: null,
  rawPackets: [],
};

let pool = null;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export async function initDb() {
  if (!hasDatabase()) {
    console.warn('[db] DATABASE_URL is not set. Running with in-memory storage.');
    return;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' || process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : false,
  });

  await pool.query(`
    create table if not exists raw_packets (
      id bigserial primary key,
      device_id text,
      remote_address text,
      remote_port integer,
      raw_hex text not null,
      raw_ascii text not null,
      received_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists last_locations (
      device_id text primary key,
      lat double precision,
      lon double precision,
      speed double precision,
      device_time timestamptz,
      raw_packet_id bigint references raw_packets(id),
      updated_at timestamptz not null default now()
    );
  `);
}

export async function saveRawPacket(packet) {
  if (!pool) {
    const row = {
      id: memoryState.rawPackets.length + 1,
      ...packet,
      receivedAt: new Date().toISOString(),
    };
    memoryState.rawPackets.push(row);
    return row.id;
  }

  const result = await pool.query(
    `
      insert into raw_packets (device_id, remote_address, remote_port, raw_hex, raw_ascii)
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [
      packet.deviceId ?? null,
      packet.remoteAddress ?? null,
      packet.remotePort ?? null,
      packet.rawHex,
      packet.rawAscii,
    ],
  );

  return result.rows[0].id;
}

export async function saveLocation(location) {
  const normalized = {
    deviceId: location.deviceId ?? 'unknown',
    lat: location.lat ?? null,
    lon: location.lon ?? null,
    speed: location.speed ?? null,
    time: location.time ?? new Date().toISOString(),
    rawPacketId: location.rawPacketId ?? null,
  };

  if (!pool) {
    memoryState.lastLocation = normalized;
    return normalized;
  }

  await pool.query(
    `
      insert into last_locations (device_id, lat, lon, speed, device_time, raw_packet_id, updated_at)
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (device_id) do update set
        lat = excluded.lat,
        lon = excluded.lon,
        speed = excluded.speed,
        device_time = excluded.device_time,
        raw_packet_id = excluded.raw_packet_id,
        updated_at = now()
    `,
    [
      normalized.deviceId,
      normalized.lat,
      normalized.lon,
      normalized.speed,
      normalized.time,
      normalized.rawPacketId,
    ],
  );

  return normalized;
}

export async function getLastLocation() {
  if (!pool) {
    return memoryState.lastLocation;
  }

  const result = await pool.query(`
    select
      device_id as "deviceId",
      lat,
      lon,
      speed,
      coalesce(device_time, updated_at) as time,
      updated_at as "updatedAt"
    from last_locations
    order by updated_at desc
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
  }
}
