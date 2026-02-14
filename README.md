# WhatsApp Unofficial Fallback (Railway)

Unofficial WhatsApp send service using whatsapp-web.js. Use as a fallback when the official Meta API is unavailable.

**Repo:** [github.com/shaikashfaaqhamja/WHATSAPP-UNOFFICIAL](https://github.com/shaikashfaaqhamja/WHATSAPP-UNOFFICIAL)

## Deploy on Railway

1. **Connect repo**  
   Railway → New Project → **Deploy from GitHub repo** → select [shaikashfaaqhamja/WHATSAPP-UNOFFICIAL](https://github.com/shaikashfaaqhamja/WHATSAPP-UNOFFICIAL) (or push this folder to your fork).

2. **Build & deploy**  
   Railway will use the **Dockerfile** and build with Node + Chrome.

3. **Variables**  
   In the service → **Variables**:
   - `SESSION_PATH` = `./.wwebjs_auth` (or leave default)  
   - Do **not** set `SECRET` if you want multi-tenant (each user has their own secret).

4. **Domain**  
   Service → **Settings** → **Networking** → **Generate domain**.  
   Example: `https://whatsapp-unofficial-production.up.railway.app`

5. **Main app**  
   In your main app `.env` set:
   ```env
   VITE_WHATSAPP_FALLBACK_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
   ```
   Users then add their **secret** in the app; the app calls this URL for QR and send.

## Usage

- **QR page:** `https://YOUR-DOMAIN/qr?secret=YOUR_SECRET`  
  Open in browser, scan with WhatsApp (Linked devices), then use the same secret in the app.
- **Health:** `GET /health`
- **Send:** `POST /send` with body `{ "secret", "message", "recipients" }`

## Memory

Chrome uses a lot of RAM. If the container stops after showing the QR, check Railway **Metrics** (memory). Consider upgrading the plan or increasing memory if available.
