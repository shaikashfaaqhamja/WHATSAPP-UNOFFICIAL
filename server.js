/**
 * Unofficial WhatsApp fallback service (whatsapp-web.js).
 * Multi-tenant: each user has their own secret; GET /qr?secret=X and POST /send with secret=X use the same session.
 * Use with care: scan QR once per secret, then send with long random delays to reduce ban risk.
 */

require('dotenv').config()
const crypto = require('crypto')
const express = require('express')
const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
})
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled rejection at:', p, 'reason:', reason)
})

const PORT = Number(process.env.PORT) || 3780
const SESSION_PATH = process.env.SESSION_PATH || './.wwebjs_auth'
const DELAY_MIN_MS = Number(process.env.DELAY_MIN_MS) || 12000   // 12s
const DELAY_MAX_MS = Number(process.env.DELAY_MAX_MS) || 25000   // 25s
const JITTER_MS = Number(process.env.JITTER_MS) || 2000          // 0–2s extra
// Optional: Supabase Edge Function URL for inbound reply handling (e.g. https://PROJECT.supabase.co/functions/v1/inbound-from-unofficial). If set, incoming messages are sent here and the returned reply is sent back to the contact.
const INBOUND_EDGE_URL = (process.env.INBOUND_EDGE_URL || '').trim()

// Optional: single shared SECRET (legacy). If set, only this secret is accepted; one global client.
const LEGACY_SECRET = (process.env.SECRET || '').trim()
const MULTI_TENANT = !LEGACY_SECRET

function clientIdFromSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 32)
}

const app = express()
app.use(express.json({ limit: '1mb' }))

// Multi-tenant: map clientId -> { client, isReady, qrCode }
const sessions = new Map()

// Legacy single-tenant
let legacyClient = null
let legacyReady = false
let legacyQr = null

function randomDelay() {
  const range = Math.max(0, DELAY_MAX_MS - DELAY_MIN_MS)
  const base = DELAY_MIN_MS + (range > 0 ? Math.floor(Math.random() * range) : 0)
  const jitter = JITTER_MS > 0 ? Math.floor(Math.random() * (JITTER_MS + 1)) : 0
  return base + jitter
}

function toWwebjsId(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return null
  return `${digits}@c.us`
}

function getOrCreateClient(secret) {
  if (!secret || typeof secret !== 'string') return null
  const id = clientIdFromSecret(secret)
  let state = sessions.get(id)
  if (state) return state

  const dataPath = `${SESSION_PATH}/session-${id}`
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id, dataPath }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--memory-pressure-off',
        '--js-flags=--max-old-space-size=256',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  })

  state = { client, isReady: false, qrCode: null, secret }
  sessions.set(id, state)

  client.on('qr', (qr) => {
    state.qrCode = qr
    state.isReady = false
    console.log(`[${id.slice(0, 8)}] QR received – serve it at /qr?secret=YOUR_SECRET`)
    setImmediate(() => {
      try { qrcode.generate(qr, { small: true }) } catch (e) { console.error('qrcode-terminal:', e) }
    })
  })

  client.on('ready', () => {
    state.isReady = true
    state.qrCode = null
    console.log(`[${id.slice(0, 8)}] Ready`)
  })

  client.on('auth_failure', (msg) => {
    console.error(`[${id.slice(0, 8)}] Auth failure:`, msg)
    state.isReady = false
  })

  client.on('disconnected', (reason) => {
    console.log(`[${id.slice(0, 8)}] Disconnected:`, reason)
    state.isReady = false
  })

  if (INBOUND_EDGE_URL) {
    client.on('message', async (msg) => {
      try {
        const from = msg.from
        const body = typeof msg.body === 'string' ? msg.body : (msg.body || '')
        const secretToUse = state.secret
        if (!secretToUse || !from) return
        const fromPhone = from.replace('@c.us', '').replace('@s.whatsapp.net', '')
        const res = await fetch(INBOUND_EDGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: secretToUse, from_phone: fromPhone, body }),
        })
        const data = await res.json().catch(() => ({}))
        const reply = data && typeof data.reply === 'string' ? data.reply.trim() : ''
        if (reply) {
          await msg.reply(reply)
        }
      } catch (err) {
        console.error(`[${id.slice(0, 8)}] Inbound reply error:`, err)
      }
    })
  }

  client.initialize().catch((err) => console.error(`[${id.slice(0, 8)}] Init error:`, err))
  return state
}

function initLegacyClient() {
  if (legacyClient) return
  legacyClient = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--memory-pressure-off',
        '--js-flags=--max-old-space-size=256',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  })
  legacyClient.on('qr', (qr) => {
    legacyQr = qr
    console.log('Legacy: QR received')
    setImmediate(() => {
      try { qrcode.generate(qr, { small: true }) } catch (e) { console.error('qrcode-terminal:', e) }
    })
  })
  legacyClient.on('ready', () => {
    legacyReady = true
    legacyQr = null
    console.log('Legacy: ready')
  })
  legacyClient.on('auth_failure', (msg) => { console.error('Legacy auth failure:', msg); legacyReady = false })
  legacyClient.on('disconnected', (r) => { console.log('Legacy disconnected:', r); legacyReady = false })
  if (INBOUND_EDGE_URL) {
    legacyClient.on('message', async (msg) => {
      try {
        const from = msg.from
        const body = typeof msg.body === 'string' ? msg.body : (msg.body || '')
        if (!LEGACY_SECRET || !from) return
        const fromPhone = from.replace('@c.us', '').replace('@s.whatsapp.net', '')
        const res = await fetch(INBOUND_EDGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: LEGACY_SECRET, from_phone: fromPhone, body }),
        })
        const data = await res.json().catch(() => ({}))
        const reply = data && typeof data.reply === 'string' ? data.reply.trim() : ''
        if (reply) await msg.reply(reply)
      } catch (err) {
        console.error('Legacy inbound reply error:', err)
      }
    })
  }
  legacyClient.initialize().catch((err) => console.error('Legacy init error:', err))
}

function authSecret(reqSecret) {
  if (LEGACY_SECRET) {
    return reqSecret === LEGACY_SECRET ? 'legacy' : null
  }
  return (reqSecret && typeof reqSecret === 'string' && reqSecret.trim()) ? reqSecret.trim() : null
}

function getState(secret) {
  if (secret === 'legacy') {
    initLegacyClient()
    return { client: legacyClient, isReady: legacyReady, qrCode: legacyQr }
  }
  const state = getOrCreateClient(secret)
  return state || null
}

if (LEGACY_SECRET) initLegacyClient()

app.get('/health', (req, res) => {
  const ready = LEGACY_SECRET ? legacyReady : Array.from(sessions.values()).some(s => s.isReady)
  res.json({
    ok: true,
    ready,
    multiTenant: MULTI_TENANT,
    chrome: !!process.env.PUPPETEER_EXECUTABLE_PATH,
    chromePath: process.env.PUPPETEER_EXECUTABLE_PATH || '(not set – QR may not work)',
  })
})

function sendQrJson(secret, res) {
  const state = getState(secret)
  if (!state) return res.status(500).json({ error: 'Failed to get session' })
  if (state.isReady) return res.json({ status: 'ready', message: 'Already logged in' })
  if (!state.qrCode) return res.json({ status: 'waiting', message: 'Waiting for QR; refresh in a few seconds' })
  const QRCode = require('qrcode')
  QRCode.toDataURL(state.qrCode, (err, url) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ status: 'qr', qr: url })
  })
}

app.get('/api/qr', (req, res) => {
  const secret = authSecret(req.query.secret)
  if (!secret) return res.status(401).json({ error: 'Unauthorized: provide a valid secret (e.g. /api/qr?secret=YOUR_SECRET)' })
  sendQrJson(secret, res)
})

app.get('/api/qr.png', (req, res) => {
  const secret = authSecret(req.query.secret)
  if (!secret) return res.status(401).end()
  const state = getState(secret)
  if (!state) return res.status(500).end()
  if (state.isReady) return res.status(204).end()
  if (!state.qrCode) return res.status(204).end()
  const QRCode = require('qrcode')
  QRCode.toBuffer(state.qrCode, { type: 'png', margin: 2 }, (err, buf) => {
    if (err) return res.status(500).end()
    res.setHeader('Cache-Control', 'no-store')
    res.type('png').send(buf)
  })
})

function getQrPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect WhatsApp</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #111; color: #eee; text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p { color: #aaa; margin: 8px 0; max-width: 380px; }
    #status { margin: 24px 0; min-height: 320px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    #status img { max-width: 280px; height: auto; border-radius: 12px; }
    .ready { color: #4ade80; }
    .waiting { color: #fbbf24; }
    .error { color: #f87171; }
    .spinner { width: 44px; height: 44px; border: 3px solid #333; border-top-color: #fbbf24; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 16px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <h1>Connect WhatsApp</h1>
  <div id="status"></div>
  <p id="hint">Use the same secret in the app when sending via fallback.</p>
  <img id="qrImg" alt="QR" style="display:none; max-width:280px; border-radius:12px;">
  <script>
    (function() {
      var secret = new URLSearchParams(location.search).get('secret');
      var statusEl = document.getElementById('status');
      var hintEl = document.getElementById('hint');
      var qrImg = document.getElementById('qrImg');
      var start = Date.now();
      var qrShown = false;
      function html(s) { statusEl.innerHTML = s; }
      function show(msg, cls) { html('<p class="' + (cls || '') + '">' + msg + '</p>'); }
      function showWaiting(msg) { html('<div class="spinner"></div><p class="waiting">' + msg + '</p>'); }
      function showQrFromImg() {
        if (qrShown) return;
        qrShown = true;
        statusEl.innerHTML = '<p>Scan with WhatsApp on your phone</p><p style="font-size:0.9rem;color:#888">Settings → Linked devices → Link a device</p>';
        qrImg.style.display = 'block';
        if (hintEl) hintEl.textContent = 'Scan the QR above, then close this tab and use the app.';
      }
      function showQr(dataUrl) {
        if (qrShown) return;
        qrShown = true;
        html('<p>Scan with WhatsApp on your phone</p><p style="font-size:0.9rem;color:#888">Settings → Linked devices → Link a device</p><img src="' + (dataUrl || '').replace(/"/g, '&quot;') + '" alt="QR code">');
        if (hintEl) hintEl.textContent = 'Scan the QR above, then close this tab and use the app.';
      }
      if (!secret) {
        show('Add your secret to the URL: <br><code>?secret=YOUR_SECRET</code>', 'error');
        return;
      }
      showWaiting('Connecting…');
      function tickImg() {
        if (qrShown) return;
        fetch('/api/qr.png?secret=' + encodeURIComponent(secret) + '&_=' + Date.now())
          .then(function(r) {
            if (r.status === 200) return r.blob();
            return null;
          })
          .then(function(blob) {
            if (qrShown || !blob) return;
            qrImg.onload = function() { showQrFromImg(); };
            qrImg.src = URL.createObjectURL(blob);
          });
        setTimeout(tickImg, 2000);
      }
      tickImg();
      function poll() {
        if (qrShown) return;
        var elapsed = ((Date.now() - start) / 1000) | 0;
        var c = new AbortController();
        var t = setTimeout(function() { c.abort(); }, 10000);
        fetch('/api/qr?secret=' + encodeURIComponent(secret), { signal: c.signal })
          .then(function(r) { clearTimeout(t); return r.json(); })
          .then(function(d) {
            if (d.status === 'ready') { show('You\\'re connected. Close this tab and use the app.', 'ready'); return; }
            if (d.status === 'qr' && d.qr) { showQr(d.qr); return; }
            if (d.status === 'waiting') {
              var msg = 'Preparing QR… It will appear here automatically.';
              if (elapsed >= 60) msg += ' Taking long? <a href="#" onclick="location.reload(); return false;">Refresh the page</a>.';
              else if (elapsed >= 20) msg += ' First time can take 1–2 min. Keep this tab open.';
              showWaiting(msg);
              setTimeout(poll, 1500);
              return;
            }
            show(d.error || d.message || 'Something went wrong.', 'error');
          })
          .catch(function(e) {
            clearTimeout(t);
            if (qrShown) return;
            if (e.name === 'AbortError') show('Server slow. <a href="#" onclick="location.reload(); return false;">Refresh</a> to try again.', 'error');
            else show('Error: ' + (e.message || 'Network problem') + ' <a href="#" onclick="location.reload(); return false;">Refresh</a>', 'error');
          });
      }
      poll();
    })();
  </script>
</body>
</html>`
}

app.get('/qr', (req, res) => {
  const secret = authSecret(req.query.secret)
  const wantsJson = req.query.format === 'json' || req.get('accept')?.toLowerCase().includes('application/json')
  if (!wantsJson) {
    return res.type('html').send(getQrPage())
  }
  if (!secret) {
    return res.status(401).json({ error: 'Unauthorized: provide a valid secret in query (e.g. /qr?secret=YOUR_SECRET)' })
  }
  sendQrJson(secret, res)
})

app.get('/status', (req, res) => {
  const secret = authSecret(req.query.secret)
  if (!secret) return res.status(401).json({ error: 'Unauthorized' })
  const state = getState(secret)
  res.json({ ready: state ? state.isReady : false })
})

app.post('/send', async (req, res) => {
  const secret = authSecret(req.body.secret)
  if (!secret) {
    return res.status(401).json({ error: 'Unauthorized: provide secret in body' })
  }
  const state = getState(secret)
  if (!state || !state.client) {
    return res.status(500).json({ error: 'Session not found' })
  }
  if (!state.isReady) {
    return res.status(503).json({ error: 'WhatsApp not ready. Open /qr?secret=YOUR_SECRET and scan the QR first.' })
  }

  const { message, recipients } = req.body
  if (!message || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'Missing message or recipients' })
  }

  const client = state.client
  const results = []
  for (let i = 0; i < recipients.length; i++) {
    const { phone, contact_id } = recipients[i]
    const chatId = toWwebjsId(phone)
    if (!chatId) {
      results.push({ contact_id, phone, success: false, error: 'Invalid phone' })
      continue
    }

    if (i > 0) {
      const wait = randomDelay()
      console.log(`Delay ${(wait / 1000).toFixed(1)}s before next send`)
      await new Promise((r) => setTimeout(r, wait))
    }

    try {
      await client.sendMessage(chatId, message)
      results.push({ contact_id, phone, success: true })
    } catch (err) {
      const errMsg = err.message || String(err)
      console.error(`Send to ${phone} failed:`, errMsg)
      results.push({ contact_id, phone, success: false, error: errMsg })
    }
  }

  res.json({ results })
})

app.listen(PORT, () => {
  console.log(`Unofficial WhatsApp fallback on port ${PORT}.`)
  if (INBOUND_EDGE_URL) console.log('INBOUND_EDGE_URL set: auto-replies (1/2/3, feedback 1–5) enabled.')
  if (LEGACY_SECRET) {
    console.log('Running in single-tenant mode (SECRET env set). Use /qr?secret=YOUR_SECRET to get QR.')
  } else {
    console.log('Running in multi-tenant mode. Each user uses their own secret: /qr?secret=USER_SECRET then POST /send with that secret.')
  }
})
