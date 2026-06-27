# My Logistic GPS MVP

Минимальная GPS-платформа для Sinotrack ST-901M без облака SinoTrack и без Traccar.

## Возможности MVP

- TCP-сервер принимает подключения от трекера.
- Логирует RAW HEX и RAW ASCII.
- Сохраняет RAW пакеты в PostgreSQL при наличии `DATABASE_URL`.
- Хранит последние координаты, если пакет уже содержит decimal lat/lon.
- REST API: `GET /api/location`.
- Frontend: Leaflet + OpenStreetMap, опрос API каждые 3 секунды.

## Запуск локально

```bash
npm install
cp .env.example .env
npm run dev
```

По умолчанию:

- HTTP: `http://localhost:3000`
- TCP для трекера: `5001`

Если `DATABASE_URL` не задан, сервер работает в памяти. Это удобно для первого теста с PowerBank/USB.

## Railway

Переменные окружения:

```text
PORT=3000
TRACKER_PORT=5001
DATABASE_URL=postgresql://...
DATABASE_SSL=false
```

Команда запуска:

```bash
npm start
```

## API

```http
GET /api/location
```

Ответ:

```json
{
  "deviceId": "123456789012345",
  "lat": 41.311081,
  "lon": 69.240562,
  "speed": null,
  "time": "2026-06-27T10:00:00.000Z",
  "online": true
}
```

## Настройка ST-901M через SMS

```text
RCONF
8030000 internet
7100000
8040000 <SERVER_IP> <TRACKER_PORT>
```

Пример:

```text
8040000 185.xxx.xxx.xxx 5001
```

После первого реального пакета из трекера нужно добавить точный парсер ST-901M и корректный ACK.
