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
   - **Optional – auto-reply to incoming messages:** set `INBOUND_EDGE_URL` to your Supabase Edge Function URL, e.g. `https://YOUR_PROJECT_REF.supabase.co/functions/v1/inbound-from-unofficial`. When contacts message you, the app will reply (feedback 1–5, options 1/2/3, AI from product description). Deploy the `inbound-from-unofficial` function from the main WHATSAPP-AUTOMATION repo first.

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
- **Inbound replies:** If `INBOUND_EDGE_URL` is set, incoming WhatsApp messages are sent to that Edge Function; the returned `reply` is sent back to the contact (same logic as Meta webhook).

## Option A: Enable auto-replies (1/2/3, feedback 1–5)

1. In the **main app repo** (WHATSAPP-AUTOMATION), deploy the Edge Function:
   ```bash
   npx supabase functions deploy inbound-from-unofficial
   ```
2. Copy your Supabase Edge Function URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/inbound-from-unofficial`  
   (Get YOUR_PROJECT_REF from Supabase Dashboard → Project Settings → General. Or copy from the main app **Settings → Unofficial fallback**.)
3. In **Railway** → your WhatsApp-unofficial service → **Variables** → **New variable**:
   - Name: `INBOUND_EDGE_URL`
   - Value: the URL from step 2
4. **Redeploy** the service (or restart) so it picks up the variable.  
After that, when contacts reply to your campaign (e.g. 1, 2, 3 or 1–5 for feedback), they will get the auto-reply.

## Memory

Chrome uses a lot of RAM. If the container stops after showing the QR, check Railway **Metrics** (memory). Consider upgrading the plan or increasing memory if available.
