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

Проект развернут:

- GitHub: `https://github.com/Alisher1994/sinotrack-gps-mvp`
- Railway HTTP: `https://sinotrack-gps-api-production.up.railway.app`
- Railway project: `https://railway.com/project/5a1b94eb-af0d-468e-b905-e03b563572c3`

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

## TCP Proxy для трекера

HTTP-домен Railway подходит для карты и API, но ST-901M подключается по raw TCP.

В Railway нужно открыть:

```text
sinotrack-gps-api -> Settings -> Networking -> TCP Proxy
```

Internal port:

```text
5001
```

Railway выдаст адрес вида:

```text
xxxx.proxy.rlwy.net:12345
```

Именно его нужно отправить трекеру через SMS:

```text
8040000 xxxx.proxy.rlwy.net 12345
```
