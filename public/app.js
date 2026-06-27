const fallbackCenter = [41.3111, 69.2797];
const map = L.map('map', { zoomControl: true }).setView(fallbackCenter, 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

let marker = null;
let routeLayer = L.layerGroup().addTo(map);
let playbackMarker = null;
let playbackTimer = null;
let trackPoints = [];

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
  trackCount: document.querySelector('#trackCount'),
  overspeedCount: document.querySelector('#overspeedCount'),
  maxSpeed: document.querySelector('#maxSpeed'),
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
    map.panTo(point, { animate: true });
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

    drawTrack(Number.parseFloat(elements.speedLimit.value || '60'));
  } catch (error) {
    console.error('Failed to load track', error);
    elements.trackCount.textContent = '-';
    elements.overspeedCount.textContent = '-';
    elements.maxSpeed.textContent = '-';
  } finally {
    elements.loadTrack.disabled = false;
  }
}

function drawTrack(speedLimit) {
  routeLayer.clearLayers();

  if (trackPoints.length === 0) {
    return;
  }

  for (let index = 1; index < trackPoints.length; index += 1) {
    const previous = trackPoints[index - 1];
    const current = trackPoints[index];
    const isOverspeed =
      (Number.isFinite(previous.speed) && previous.speed > speedLimit)
      || (Number.isFinite(current.speed) && current.speed > speedLimit);

    L.polyline(
      [
        [previous.lat, previous.lon],
        [current.lat, current.lon],
      ],
      {
        color: isOverspeed ? '#d64545' : '#0b5fff',
        weight: isOverspeed ? 6 : 4,
        opacity: 0.9,
      },
    ).addTo(routeLayer);
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

function togglePlayback() {
  if (playbackTimer) {
    stopPlayback();
    return;
  }

  if (trackPoints.length < 2) {
    return;
  }

  let index = 0;
  elements.playTrack.textContent = '■';

  playbackTimer = window.setInterval(() => {
    const point = trackPoints[index];

    if (!playbackMarker) {
      playbackMarker = L.circleMarker([point.lat, point.lon], {
        radius: 8,
        color: '#f2b705',
        fillColor: '#f2b705',
        fillOpacity: 1,
      }).addTo(routeLayer);
    } else {
      playbackMarker.setLatLng([point.lat, point.lon]);
    }

    playbackMarker.bindTooltip(`${formatTime(point.time)} · ${formatSpeed(point.speed)}`, {
      permanent: false,
    });

    index += 1;
    if (index >= trackPoints.length) {
      stopPlayback();
    }
  }, 650);
}

function stopPlayback() {
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  elements.playTrack.textContent = '▶';
}

elements.trackDate.value = todayForInput();
elements.loadTrack.addEventListener('click', loadTrack);
elements.playTrack.addEventListener('click', togglePlayback);
elements.speedLimit.addEventListener('change', loadTrack);

loadLocation();
loadTrack();
window.setInterval(loadLocation, 3000);
