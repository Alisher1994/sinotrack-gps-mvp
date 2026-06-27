const fallbackCenter = [41.3111, 69.2797];
const map = L.map('map', { zoomControl: true }).setView(fallbackCenter, 12);

L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

let marker = null;
let routeLayer = L.layerGroup().addTo(map);
let playbackMarker = null;
let playbackTimer = null;
let currentPlaybackIndex = 0;
let playbackProgress = 0;
let trackPoints = [];
const roadRouteCache = new Map();
const segmentSelections = new Map();
const segmentPolylines = new Map();
const segmentData = new Map();

const elements = {
  status: document.querySelector('#status'),
  statusDot: document.querySelector('#statusDot'),
  deviceId: document.querySelector('#deviceId'),
  coordinates: document.querySelector('#coordinates'),
  speed: document.querySelector('#speed'),
  time: document.querySelector('#time'),
  trackDate: document.querySelector('#trackDate'),
  speedLimit: document.querySelector('#speedLimit'),
  loadTrack: document.querySelector('#loadTrack'),
  playTrack: document.querySelector('#playTrack'),
  trackTimeline: document.querySelector('#trackTimeline'),
  timelineTime: document.querySelector('#timelineTime'),
  timelineSpeed: document.querySelector('#timelineSpeed'),
  trackCount: document.querySelector('#trackCount'),
  overspeedCount: document.querySelector('#overspeedCount'),
  maxSpeed: document.querySelector('#maxSpeed'),
  segmentPanel: document.querySelector('#segmentPanel'),
  segmentSummary: document.querySelector('#segmentSummary'),
  segmentOptions: document.querySelector('#segmentOptions'),
};

function formatTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function updateStatus(isOnline) {
  elements.status.textContent = isOnline ? 'Online' : 'Offline';
  elements.statusDot.classList.toggle('online', isOnline);
  elements.statusDot.classList.toggle('offline', !isOnline);
}

function todayForInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${Math.round(value)} км/ч` : '-';
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '-';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} км` : `${Math.round(meters)} м`;
}

function createCarIcon(course = 0) {
  return L.divIcon({
    className: 'car-marker',
    html: `
      <svg viewBox="0 0 64 64" style="transform: rotate(${Number(course) || 0}deg)">
        <path d="M32 4 48 58 32 50 16 58 32 4Z" fill="#1565ff" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>
        <path d="M32 13 41 48 32 43 23 48 32 13Z" fill="#18a058"/>
      </svg>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

async function loadLocation() {
  try {
    const response = await fetch('/api/location', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const location = await response.json();
    const hasCoordinates = Number.isFinite(location.lat) && Number.isFinite(location.lon);

    updateStatus(Boolean(location.online));
    elements.deviceId.textContent = location.deviceId || '-';
    elements.speed.textContent = formatSpeed(location.speed);
    elements.time.textContent = formatTime(location.time);

    if (!hasCoordinates) {
      elements.coordinates.textContent = '-';
      return;
    }

    const point = [location.lat, location.lon];
    elements.coordinates.textContent = `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`;

    if (!marker) {
      marker = L.marker(point).addTo(map);
      map.setView(point, 15);
      return;
    }

    marker.setLatLng(point);
  } catch (error) {
    console.error('Failed to load location', error);
    updateStatus(false);
  }
}

async function loadTrack() {
  stopPlayback();
  elements.loadTrack.disabled = true;

  try {
    const params = new URLSearchParams({
      date: elements.trackDate.value || todayForInput(),
      speedLimit: elements.speedLimit.value || '60',
      tzOffset: String(new Date().getTimezoneOffset()),
    });
    const response = await fetch(`/api/track?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const track = await response.json();
    trackPoints = track.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

    elements.trackCount.textContent = String(track.count);
    elements.overspeedCount.textContent = String(track.overspeedCount);
    elements.maxSpeed.textContent = formatSpeed(track.maxSpeed);
    elements.playTrack.disabled = trackPoints.length < 2;
    elements.trackTimeline.disabled = trackPoints.length === 0;
    elements.trackTimeline.max = String(Math.max(trackPoints.length - 1, 0));
    elements.trackTimeline.value = '0';

    await drawTrack(Number.parseFloat(elements.speedLimit.value || '60'));
    setPlaybackPosition(0, { pan: false });
  } catch (error) {
    console.error('Failed to load track', error);
    elements.trackCount.textContent = '-';
    elements.overspeedCount.textContent = '-';
    elements.maxSpeed.textContent = '-';
    elements.timelineTime.textContent = '-';
    elements.timelineSpeed.textContent = '-';
    elements.trackTimeline.disabled = true;
  } finally {
    elements.loadTrack.disabled = false;
  }
}

async function drawTrack(speedLimit) {
  routeLayer.clearLayers();
  segmentPolylines.clear();
  segmentData.clear();
  elements.segmentPanel.hidden = true;

  if (trackPoints.length === 0) {
    return;
  }

  for (let index = 1; index < trackPoints.length; index += 1) {
    const previous = trackPoints[index - 1];
    const current = trackPoints[index];
    const isOverspeed =
      (Number.isFinite(previous.speed) && previous.speed > speedLimit)
      || (Number.isFinite(current.speed) && current.speed > speedLimit);
    const segmentKey = getSegmentKey(previous, current);
    const alternatives = await getRoadAlternatives(previous, current);
    const selectedIndex = segmentSelections.get(segmentKey) ?? chooseBestAlternative(previous, current, alternatives);
    const selected = alternatives[selectedIndex] ?? alternatives[0];
    const isUncertain = alternatives.length > 1 && isSegmentUncertain(previous, current, selected);

    const polyline = L.polyline(
      selected.coordinates,
      {
        color: isUncertain ? '#f2b705' : isOverspeed ? '#d64545' : '#0b5fff',
        weight: isUncertain || isOverspeed ? 6 : 4,
        opacity: 0.9,
      },
    ).addTo(routeLayer);

    polyline.on('click', () => showSegmentOptions(segmentKey));
    segmentPolylines.set(segmentKey, polyline);
    segmentData.set(segmentKey, {
      index,
      previous,
      current,
      alternatives,
      selectedIndex,
      isOverspeed,
      isUncertain,
    });
  }

  trackPoints.forEach((point, index) => {
    const isOverspeed = Number.isFinite(point.speed) && point.speed > speedLimit;
    const updateMarker = L.circleMarker([point.lat, point.lon], {
      radius: isOverspeed ? 5 : 4,
      color: isOverspeed ? '#b42318' : '#ffffff',
      weight: 2,
      fillColor: isOverspeed ? '#d64545' : '#0b5fff',
      fillOpacity: 0.95,
    }).addTo(routeLayer);

    updateMarker.bindTooltip(
      `#${index + 1} · ${formatTime(point.time)} · ${formatSpeed(point.speed)}`,
      { sticky: true },
    );
  });

  const start = trackPoints[0];
  const finish = trackPoints[trackPoints.length - 1];
  L.circleMarker([start.lat, start.lon], {
    radius: 6,
    color: '#18a058',
    fillColor: '#18a058',
    fillOpacity: 1,
  }).addTo(routeLayer);
  L.circleMarker([finish.lat, finish.lon], {
    radius: 6,
    color: '#17212b',
    fillColor: '#17212b',
    fillOpacity: 1,
  }).addTo(routeLayer);

  map.fitBounds(L.latLngBounds(trackPoints.map((point) => [point.lat, point.lon])), {
    padding: [36, 36],
    maxZoom: 16,
  });
}

async function getRoadAlternatives(previous, current) {
  const directSegment = [
    [previous.lat, previous.lon],
    [current.lat, current.lon],
  ];
  const directAlternative = {
    coordinates: directSegment,
    distance: distanceMeters(previous, current),
    duration: null,
    source: 'direct',
  };
  const distance = distanceMeters(previous, current);

  if (distance < 20 || distance > 3000) {
    return [directAlternative];
  }

  const cacheKey = getSegmentKey(previous, current);

  if (roadRouteCache.has(cacheKey)) {
    return roadRouteCache.get(cacheKey);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);

  try {
    const url = new URL(
      `https://router.project-osrm.org/route/v1/driving/${previous.lon},${previous.lat};${current.lon},${current.lat}`,
    );
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('alternatives', 'true');
    url.searchParams.set('steps', 'false');

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`OSRM ${response.status}`);

    const data = await response.json();
    const alternatives = data.routes
      ?.map((route) => ({
        coordinates: route.geometry?.coordinates?.map(([lon, lat]) => [lat, lon]) ?? [],
        distance: route.distance,
        duration: route.duration,
        source: 'osrm',
      }))
      .filter((route) => route.coordinates.length >= 2);

    if (!Array.isArray(alternatives) || alternatives.length === 0) {
      throw new Error('OSRM route is empty');
    }

    roadRouteCache.set(cacheKey, alternatives);
    return alternatives;
  } catch (error) {
    console.warn('Road segment fallback', error);
    roadRouteCache.set(cacheKey, [directAlternative]);
    return [directAlternative];
  } finally {
    window.clearTimeout(timeout);
  }
}

function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const value =
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function chooseBestAlternative(previous, current, alternatives) {
  const measuredSpeed = averageMeasuredSpeed(previous, current);
  const elapsedSeconds = elapsedSecondsBetween(previous, current);

  if (!Number.isFinite(measuredSpeed) || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  alternatives.forEach((alternative, index) => {
    const requiredSpeed = alternative.distance / elapsedSeconds * 3.6;
    const score = Math.abs(requiredSpeed - measuredSpeed);

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function isSegmentUncertain(previous, current, alternative) {
  const elapsedSeconds = elapsedSecondsBetween(previous, current);
  const measuredSpeed = averageMeasuredSpeed(previous, current);

  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || !Number.isFinite(measuredSpeed)) {
    return false;
  }

  const requiredSpeed = alternative.distance / elapsedSeconds * 3.6;
  return Math.abs(requiredSpeed - measuredSpeed) > 25 || alternative.distance > distanceMeters(previous, current) * 1.8;
}

function showSegmentOptions(segmentKey) {
  const data = segmentData.get(segmentKey);
  if (!data) return;

  const elapsedSeconds = elapsedSecondsBetween(data.previous, data.current);
  const measuredSpeed = averageMeasuredSpeed(data.previous, data.current);
  elements.segmentPanel.hidden = false;
  elements.segmentSummary.textContent =
    `#${data.index} · ${Math.round(elapsedSeconds || 0)} сек · GPS ${formatSpeed(measuredSpeed)}`;
  elements.segmentOptions.innerHTML = '';

  data.alternatives.forEach((alternative, index) => {
    const requiredSpeed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0
      ? alternative.distance / elapsedSeconds * 3.6
      : null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment-option${index === data.selectedIndex ? ' active' : ''}`;
    button.textContent =
      `Вариант ${index + 1}: ${formatDistance(alternative.distance)} · нужно ${formatSpeed(requiredSpeed)}`;
    button.addEventListener('click', () => selectSegmentAlternative(segmentKey, index));
    elements.segmentOptions.append(button);
  });
}

function selectSegmentAlternative(segmentKey, selectedIndex) {
  const data = segmentData.get(segmentKey);
  const polyline = segmentPolylines.get(segmentKey);
  const selected = data?.alternatives[selectedIndex];
  if (!data || !polyline || !selected) return;

  segmentSelections.set(segmentKey, selectedIndex);
  data.selectedIndex = selectedIndex;
  data.isUncertain = isSegmentUncertain(data.previous, data.current, selected);
  polyline.setLatLngs(selected.coordinates);
  polyline.setStyle({
    color: data.isUncertain ? '#f2b705' : data.isOverspeed ? '#d64545' : '#0b5fff',
    weight: data.isUncertain || data.isOverspeed ? 6 : 4,
  });
  showSegmentOptions(segmentKey);
}

function getSegmentKey(previous, current) {
  return [
    previous.receivedAt ?? previous.time,
    current.receivedAt ?? current.time,
    previous.lat.toFixed(6),
    previous.lon.toFixed(6),
    current.lat.toFixed(6),
    current.lon.toFixed(6),
  ].join(',');
}

function averageMeasuredSpeed(previous, current) {
  const speeds = [previous.speed, current.speed].filter((speed) => Number.isFinite(speed));
  if (speeds.length === 0) return null;
  return speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
}

function elapsedSecondsBetween(previous, current) {
  const start = new Date(previous.time ?? previous.receivedAt).getTime();
  const end = new Date(current.time ?? current.receivedAt).getTime();
  const seconds = Math.abs(end - start) / 1000;
  return Number.isFinite(seconds) ? seconds : null;
}

function togglePlayback() {
  if (playbackTimer) {
    stopPlayback();
    return;
  }

  if (trackPoints.length < 2) {
    return;
  }

  currentPlaybackIndex = Number.parseInt(elements.trackTimeline.value, 10) || 0;
  elements.playTrack.textContent = '■';

  playbackTimer = window.setInterval(() => {
    stepPlayback();
    if (currentPlaybackIndex >= trackPoints.length - 1 && playbackProgress >= 1) {
      stopPlayback();
    }
  }, 80);
}

function stopPlayback() {
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  elements.playTrack.textContent = '▶';
}

function setPlaybackPosition(index, { pan = false } = {}) {
  if (trackPoints.length === 0) {
    return;
  }

  const safeIndex = Math.max(0, Math.min(index, trackPoints.length - 1));
  const point = trackPoints[safeIndex];
  currentPlaybackIndex = safeIndex;
  playbackProgress = 0;
  elements.trackTimeline.value = String(safeIndex);
  elements.timelineTime.textContent = formatTime(point.time);
  elements.timelineSpeed.textContent = formatSpeed(point.speed);

  if (!playbackMarker) {
    playbackMarker = L.marker([point.lat, point.lon], {
      icon: createCarIcon(point.course),
      zIndexOffset: 1000,
    }).addTo(routeLayer);
  } else {
    playbackMarker.setLatLng([point.lat, point.lon]);
    playbackMarker.setIcon(createCarIcon(point.course));
  }

  playbackMarker.bindTooltip(`${formatTime(point.time)} · ${formatSpeed(point.speed)}`, {
    permanent: false,
  });

  if (pan) {
    map.panTo([point.lat, point.lon], { animate: true });
  }
}

function stepPlayback() {
  const start = trackPoints[currentPlaybackIndex];
  const finish = trackPoints[currentPlaybackIndex + 1];

  if (!start || !finish) {
    playbackProgress = 1;
    return;
  }

  const elapsedSeconds = Math.max(elapsedSecondsBetween(start, finish) || 1, 1);
  const progressStep = 0.08 / Math.min(Math.max(elapsedSeconds / 8, 1.2), 6);
  playbackProgress = Math.min(playbackProgress + progressStep, 1);

  const routePoint = interpolateSegmentRoute(start, finish, playbackProgress);
  const lat = routePoint.lat;
  const lon = routePoint.lon;
  const course = Number.isFinite(finish.course) ? finish.course : start.course;
  const speed = interpolateNumber(start.speed, finish.speed, playbackProgress);
  const time = interpolateTime(start.time, finish.time, playbackProgress);

  if (!playbackMarker) {
    playbackMarker = L.marker([lat, lon], {
      icon: createCarIcon(course),
      zIndexOffset: 1000,
    }).addTo(routeLayer);
  } else {
    playbackMarker.setLatLng([lat, lon]);
    playbackMarker.setIcon(createCarIcon(course));
  }

  playbackMarker.bindTooltip(`${formatTime(time)} · ${formatSpeed(speed)}`, {
    permanent: false,
  });
  elements.timelineTime.textContent = formatTime(time);
  elements.timelineSpeed.textContent = formatSpeed(speed);
  elements.trackTimeline.value = String(currentPlaybackIndex);

  if (playbackProgress >= 1) {
    currentPlaybackIndex += 1;
    playbackProgress = 0;
  }
}

function interpolateSegmentRoute(start, finish, progress) {
  const segment = getSelectedSegment(start, finish);
  if (!segment || segment.coordinates.length < 2) {
    return {
      lat: start.lat + (finish.lat - start.lat) * progress,
      lon: start.lon + (finish.lon - start.lon) * progress,
    };
  }

  const totalDistance = segment.distance || routeDistance(segment.coordinates);
  const targetDistance = totalDistance * progress;
  let travelled = 0;

  for (let index = 1; index < segment.coordinates.length; index += 1) {
    const previous = latLngToPoint(segment.coordinates[index - 1]);
    const current = latLngToPoint(segment.coordinates[index]);
    const distance = distanceMeters(previous, current);

    if (travelled + distance >= targetDistance) {
      const localProgress = distance === 0 ? 0 : (targetDistance - travelled) / distance;
      return {
        lat: previous.lat + (current.lat - previous.lat) * localProgress,
        lon: previous.lon + (current.lon - previous.lon) * localProgress,
      };
    }

    travelled += distance;
  }

  const last = latLngToPoint(segment.coordinates[segment.coordinates.length - 1]);
  return { lat: last.lat, lon: last.lon };
}

function getSelectedSegment(start, finish) {
  const segmentKey = getSegmentKey(start, finish);
  const data = segmentData.get(segmentKey);
  if (!data) return null;
  return data.alternatives[data.selectedIndex] ?? data.alternatives[0] ?? null;
}

function routeDistance(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceMeters(latLngToPoint(coordinates[index - 1]), latLngToPoint(coordinates[index]));
  }
  return total;
}

function latLngToPoint(latLng) {
  return { lat: latLng[0], lon: latLng[1] };
}

function interpolateNumber(start, finish, progress) {
  if (!Number.isFinite(start) && !Number.isFinite(finish)) return null;
  if (!Number.isFinite(start)) return finish;
  if (!Number.isFinite(finish)) return start;
  return start + (finish - start) * progress;
}

function interpolateTime(start, finish, progress) {
  const startMs = new Date(start).getTime();
  const finishMs = new Date(finish).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs)) return start;
  return new Date(startMs + (finishMs - startMs) * progress).toISOString();
}

elements.trackDate.value = todayForInput();
elements.loadTrack.addEventListener('click', loadTrack);
elements.playTrack.addEventListener('click', togglePlayback);
elements.speedLimit.addEventListener('change', loadTrack);
elements.trackTimeline.addEventListener('input', () => {
  stopPlayback();
  setPlaybackPosition(Number.parseInt(elements.trackTimeline.value, 10), { pan: true });
});

loadLocation();
loadTrack();
window.setInterval(loadLocation, 3000);
