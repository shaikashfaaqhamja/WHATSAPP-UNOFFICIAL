# Unofficial WhatsApp fallback

This service uses **whatsapp-web.js** to send messages when the official Meta API fails (e.g. "recipient not in allowed list" or "not registered"). It uses **long random delays** between messages to reduce ban risk.

**Two ways to use:**

- **App provides the URL** (recommended): Set `VITE_WHATSAPP_FALLBACK_URL` in the main app’s `.env` to this service’s URL (e.g. after you deploy it). Then users only enter their **secret key** in the app — no URL to copy. Each user has their own secret; the service is multi-tenant.
- **User provides URL + secret**: Leave that env unset; users who deploy their own instance enter both URL and secret in the app.

## Setup

1. Copy `.env.example` to `.env`. Optionally set:
   - `SECRET`: If set, **single-tenant** mode — one global session, this one secret for everyone. If **omitted**, **multi-tenant** — each user has their own secret (used in the app when you provide the URL via `VITE_WHATSAPP_FALLBACK_URL`).
   - Optionally: `DELAY_MIN_MS`, `DELAY_MAX_MS`, `JITTER_MS` (defaults: 12–25s + 0–2s jitter).

2. Install and run:
   ```bash
   npm install
   npm start
   ```

3. Scan QR once: open `http://localhost:3780/qr?secret=YOUR_SECRET` in a browser (or check terminal for QR). After scanning, the session is saved; next runs won’t need QR unless you log out.

4. In the main app, go to **Settings**, fill **Unofficial fallback URL** (e.g. `http://your-server:3780`) and **Unofficial fallback secret** (same as `SECRET`), then save.

When the official API returns "recipient not in allowed list" or "not registered", the app will send those recipients through this service with delays.

## Endpoints

- `GET /health` — `{ ok, ready }`
- `GET /qr?secret=SECRET` — Returns QR image (data URL) or `{ status: "ready" }`
- `GET /status?secret=SECRET` — `{ ready: true|false }`
- `POST /send` — Body: `{ secret, message, recipients: [ { phone, contact_id } ] }`. Returns `{ results: [ { contact_id, phone, success, error? } ] }`.

## Delays

Default: 12–25 seconds between each message, plus 0–2s jitter. Do not lower these too much; WhatsApp may ban the number for automation.
