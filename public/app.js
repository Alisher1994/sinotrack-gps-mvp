const fallbackCenter = [41.3111, 69.2797];
const map = L.map('map', { zoomControl: true }).setView(fallbackCenter, 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

let marker = null;

const elements = {
  status: document.querySelector('#status'),
  statusDot: document.querySelector('#statusDot'),
  deviceId: document.querySelector('#deviceId'),
  coordinates: document.querySelector('#coordinates'),
  speed: document.querySelector('#speed'),
  time: document.querySelector('#time'),
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

async function loadLocation() {
  try {
    const response = await fetch('/api/location', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const location = await response.json();
    const hasCoordinates = Number.isFinite(location.lat) && Number.isFinite(location.lon);

    updateStatus(Boolean(location.online));
    elements.deviceId.textContent = location.deviceId || '-';
    elements.speed.textContent = Number.isFinite(location.speed) ? `${location.speed} км/ч` : '-';
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

loadLocation();
window.setInterval(loadLocation, 3000);
