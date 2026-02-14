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

const PORT = Number(process.env.PORT) || 3780
const SESSION_PATH = process.env.SESSION_PATH || './.wwebjs_auth'
const DELAY_MIN_MS = Number(process.env.DELAY_MIN_MS) || 12000   // 12s
const DELAY_MAX_MS = Number(process.env.DELAY_MAX_MS) || 25000   // 25s
const JITTER_MS = Number(process.env.JITTER_MS) || 2000          // 0–2s extra

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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  })

  state = { client, isReady: false, qrCode: null }
  sessions.set(id, state)

  client.on('qr', (qr) => {
    state.qrCode = qr
    state.isReady = false
    console.log(`[${id.slice(0, 8)}] QR received`)
    qrcode.generate(qr, { small: true })
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

  client.initialize().catch((err) => console.error(`[${id.slice(0, 8)}] Init error:`, err))
  return state
}

function initLegacyClient() {
  if (legacyClient) return
  legacyClient = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  })
  legacyClient.on('qr', (qr) => {
    legacyQr = qr
    console.log('Legacy: scan QR')
    qrcode.generate(qr, { small: true })
  })
  legacyClient.on('ready', () => {
    legacyReady = true
    legacyQr = null
    console.log('Legacy: ready')
  })
  legacyClient.on('auth_failure', (msg) => { console.error('Legacy auth failure:', msg); legacyReady = false })
  legacyClient.on('disconnected', (r) => { console.log('Legacy disconnected:', r); legacyReady = false })
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
    p { color: #aaa; margin: 8px 0; max-width: 360px; }
    #status { margin: 24px 0; min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    #status img { max-width: 280px; height: auto; border-radius: 12px; }
    .ready { color: #4ade80; }
    .waiting { color: #fbbf24; }
    .error { color: #f87171; }
  </style>
</head>
<body>
  <h1>Connect WhatsApp</h1>
  <div id="status"><p>Loading…</p></div>
  <p>Use the same secret in the app when sending via fallback.</p>
  <script>
    const secret = new URLSearchParams(location.search).get('secret');
    const statusEl = document.getElementById('status');
    function show(msg, className) {
      statusEl.innerHTML = '<p class="' + (className || '') + '">' + msg + '</p>';
    }
    function showQr(dataUrl) {
      statusEl.innerHTML = '<p>Scan with WhatsApp on your phone:</p><p>Settings → Linked devices → Link a device</p><img src="' + dataUrl + '" alt="QR code">';
    }
    if (!secret) {
      show('Add your secret to the URL: <br><code>?secret=YOUR_SECRET</code><br>Use the same secret you enter in the app.', 'error');
    } else {
      function poll() {
        fetch('/api/qr?secret=' + encodeURIComponent(secret))
          .then(r => r.json())
          .then(d => {
            if (d.status === 'ready') { show('You\'re connected. You can close this tab and use the app.', 'ready'); return; }
            if (d.status === 'qr') { showQr(d.qr); return; }
            if (d.status === 'waiting') {
              show('Preparing QR… (first time can take 20–40 seconds). Refreshing automatically.', 'waiting');
              setTimeout(poll, 2500);
              return;
            }
            show(d.error || d.message || 'Something went wrong.', 'error');
          })
          .catch(e => { show('Network error: ' + e.message, 'error'); });
      }
      poll();
    }
  </script>
</body>
</html>`
}

app.get('/qr', (req, res) => {
  const secret = authSecret(req.query.secret)
  if (req.accepts('html') && !req.accepts('json')) {
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
  if (LEGACY_SECRET) {
    console.log('Running in single-tenant mode (SECRET env set). Use /qr?secret=YOUR_SECRET to get QR.')
  } else {
    console.log('Running in multi-tenant mode. Each user uses their own secret: /qr?secret=USER_SECRET then POST /send with that secret.')
  }
})
