import pg from 'pg';

const { Pool } = pg;

const memoryState = {
  lastLocation: null,
  trackPoints: [],
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

  await pool.query(`
    create table if not exists track_points (
      id bigserial primary key,
      device_id text not null,
      lat double precision not null,
      lon double precision not null,
      speed double precision,
      course double precision,
      device_time timestamptz,
      raw_packet_id bigint unique references raw_packets(id),
      received_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create index if not exists track_points_device_received_idx
    on track_points (device_id, received_at);
  `);

  await pool.query(`
    create table if not exists app_metadata (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    );
  `);

  await migrateSpeedsToKmh();
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
    course: location.course ?? null,
    time: location.time ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    rawPacketId: location.rawPacketId ?? null,
  };

  if (!pool) {
    memoryState.lastLocation = normalized;
    if (Number.isFinite(normalized.lat) && Number.isFinite(normalized.lon)) {
      memoryState.trackPoints.push(normalized);
    }
    return normalized;
  }

  if (Number.isFinite(normalized.lat) && Number.isFinite(normalized.lon)) {
    await pool.query(
      `
        insert into track_points (
          device_id, lat, lon, speed, course, device_time, raw_packet_id, received_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, now())
        on conflict (raw_packet_id) do nothing
      `,
      [
        normalized.deviceId,
        normalized.lat,
        normalized.lon,
        normalized.speed,
        normalized.course,
        normalized.time,
        normalized.rawPacketId,
      ],
    );
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

export async function getTrackForDate({ date, timezoneOffsetMinutes = 0 }) {
  const range = getUtcRangeForLocalDate(date, timezoneOffsetMinutes);

  if (!pool) {
    return memoryState.trackPoints
      .filter((point) => {
        const timestamp = new Date(point.updatedAt ?? point.time).getTime();
        return timestamp >= range.start.getTime() && timestamp < range.end.getTime();
      })
      .map(formatTrackPoint)
      .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
  }

  const result = await pool.query(
    `
      select
        device_id as "deviceId",
        lat,
        lon,
        speed,
        course,
        device_time as time,
        received_at as "receivedAt"
      from track_points
      where received_at >= $1 and received_at < $2
      order by received_at asc
    `,
    [range.start.toISOString(), range.end.toISOString()],
  );

  return result.rows.map(formatTrackPoint);
}

export async function backfillTrackPointsFromRawPackets(parsePacket) {
  if (!pool) {
    return 0;
  }

  const result = await pool.query(`
    select
      rp.id,
      rp.raw_ascii as "rawAscii",
      rp.received_at as "receivedAt"
    from raw_packets rp
    left join track_points tp on tp.raw_packet_id = rp.id
    where tp.id is null
    order by rp.received_at asc
    limit 5000
  `);

  let inserted = 0;

  for (const row of result.rows) {
    const parsed = parsePacket(row.rawAscii);
    if (!parsed.location) {
      continue;
    }

    const location = parsed.location;
    await pool.query(
      `
        insert into track_points (
          device_id, lat, lon, speed, course, device_time, raw_packet_id, received_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (raw_packet_id) do nothing
      `,
      [
        location.deviceId,
        location.lat,
        location.lon,
        location.speed,
        location.course,
        location.time,
        row.id,
        row.receivedAt,
      ],
    );
    inserted += 1;
  }

  if (inserted > 0) {
    console.log(`[db] backfilled ${inserted} track points from raw packets`);
  }

  return inserted;
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

function getUtcRangeForLocalDate(date, timezoneOffsetMinutes) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new Error('Invalid date. Expected YYYY-MM-DD.');
  }

  const [year, month, day] = date.split('-').map(Number);
  const startMs = Date.UTC(year, month - 1, day) + timezoneOffsetMinutes * 60_000;
  const endMs = startMs + 24 * 60 * 60_000;

  return {
    start: new Date(startMs),
    end: new Date(endMs),
  };
}

function formatTrackPoint(point) {
  const speed = point.speed === null || point.speed === undefined ? null : Number(point.speed);

  return {
    deviceId: point.deviceId,
    lat: Number(point.lat),
    lon: Number(point.lon),
    speed,
    course: point.course === null || point.course === undefined ? null : Number(point.course),
    time: point.time instanceof Date ? point.time.toISOString() : point.time,
    receivedAt: point.receivedAt instanceof Date ? point.receivedAt.toISOString() : point.receivedAt,
  };
}

async function migrateSpeedsToKmh() {
  const migrationKey = 'speeds_migrated_to_kmh';
  const existing = await pool.query('select value from app_metadata where key = $1', [migrationKey]);
  if (existing.rows[0]?.value === 'true') {
    return;
  }

  await pool.query('update track_points set speed = speed * 1.852 where speed is not null');
  await pool.query('update last_locations set speed = speed * 1.852 where speed is not null');
  await pool.query(
    `
      insert into app_metadata (key, value, updated_at)
      values ($1, 'true', now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    [migrationKey],
  );

  console.log('[db] migrated stored speeds from knots to km/h');
}
