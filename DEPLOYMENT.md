# Deploy WhatsApp Unofficial Fallback (run forever, B2C)

This service must run **24/7** so users can connect once (QR scan) and send messages anytime. Deploy it once; your main app will use its URL so users only enter a **secret key** — no Phone Number ID, WABA ID, or Meta token.

---

## 1. Prepare the project

- **No `SECRET` in `.env`** — leave it unset so each user has their own session (multi-tenant).
- Your `whatsapp-unofficial/.env` should look like the `.env.example` (PORT, SESSION_PATH, delays; no SECRET).

---

## 2. Option A: Deploy on Railway (recommended, simple)

1. **Sign up**: [railway.app](https://railway.app) → Login (GitHub is fine).

2. **New project**: Dashboard → **New Project** → **Deploy from GitHub repo**.
   - If the repo has the whole app (e.g. `WHATSAPP-AUTOMATION`), choose it and set the **Root Directory** to `whatsapp-unofficial`.
   - Or push only the `whatsapp-unofficial` folder to a separate repo and deploy that.

3. **Root directory** (if repo is the full app):
   - Project → your service → **Settings** → **Root Directory** → set to `whatsapp-unofficial`.

4. **Build & start** (Railway usually detects Node):
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - Or leave default; ensure **Start Command** is `npm start` (runs `node server.js`).

5. **Environment variables** (Railway → your service → **Variables**):
   - `PORT` = `3780` (or leave empty; Railway sets `PORT` automatically — our server uses `process.env.PORT || 3780`).
   - Do **not** set `SECRET` (multi-tenant).
   - Optional: `DELAY_MIN_MS`, `DELAY_MAX_MS`, `JITTER_MS` (defaults are fine).

6. **Persistent storage** (sessions must survive restarts):
   - Railway → your service → **Settings** → **Volumes** → **Add Volume**.
   - Mount path: `/app/.wwebjs_auth` (or `./.wwebjs_auth` relative to app; Railway often runs from `/app`).
   - Or set **Variable**: `SESSION_PATH=/data/.wwebjs_auth` and mount a volume at `/data`.
   - This keeps WhatsApp sessions so users don’t have to scan QR again after a redeploy.

7. **Domain**: Railway → **Settings** → **Generate Domain** (e.g. `your-app.railway.app`). Copy the **HTTPS URL**.

8. **Main app**: In your **main app’s** `.env` (the one with `VITE_SUPABASE_URL`), add:
   ```env
   VITE_WHATSAPP_FALLBACK_URL=https://your-app.railway.app
   ```
   Use the exact URL Railway gave you (no trailing slash). Rebuild/redeploy the main app so the new env is used.

---

## 3. Option B: Deploy on Render

1. **Sign up**: [render.com](https://render.com).

2. **New Web Service**: Dashboard → **New** → **Web Service** → connect your repo.

3. **Settings**:
   - **Root Directory**: `whatsapp-unofficial` (if repo is the full app).
   - **Runtime**: Node.
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

4. **Environment** (Render → **Environment**):
   - `PORT` = `3780` (Render sets `PORT` automatically; our server uses it).
   - Do **not** set `SECRET`.

5. **Persistent disk** (so sessions survive restarts):
   - Render → your Web Service → **Disks** → **Add Disk**.
   - Mount path: `/opt/render/project/src/.wwebjs_auth` (or the path where your app runs; check Render docs for the app root).
   - Set env: `SESSION_PATH=/opt/render/project/src/.wwebjs_auth` so the app writes sessions on the disk.

6. **Domain**: Render gives a URL like `https://your-service.onrender.com`. Copy it.

7. **Main app**: In the main app’s `.env`:
   ```env
   VITE_WHATSAPP_FALLBACK_URL=https://your-service.onrender.com
   ```
   Rebuild/redeploy the main app.

---

## 4. After deployment

1. **Test health**: Open `https://your-fallback-url/health` — you should see `{"ok":true,"ready":false,"multiTenant":true}` (ready becomes true after at least one user scans QR).

2. **User flow** (from your deployed main app):
   - User hits “Try without Meta services” and enters a **secret** (e.g. a password they choose).
   - They open the link shown (e.g. `https://your-fallback-url/qr?secret=TheirSecret`), scan the QR with WhatsApp once.
   - They click “Send via fallback” with the same secret. Messages are sent with delays; no Phone Number ID or Meta API needed for this path.

3. **Run forever**: Railway and Render keep the process running. Paid plans avoid sleep on Render; Railway has a free tier with limits. For production B2C, use a paid plan so the service is always up.

---

## 5. Checklist

| Item | Done |
|------|------|
| `.env` in whatsapp-unofficial has **no** `SECRET` | ☐ |
| Deployed service has a public HTTPS URL | ☐ |
| Volume/disk mounted for `SESSION_PATH` so sessions persist | ☐ |
| Main app `.env` has `VITE_WHATSAPP_FALLBACK_URL=https://...` | ☐ |
| Main app rebuilt/redeployed after adding the env var | ☐ |

---

## 6. Unofficial = only QR scan

- **No** Phone Number ID, WABA ID, or Meta API token needed for the unofficial fallback.
- Each user connects **once** via QR (using their own secret). After that, sending works with only that secret in the app.
