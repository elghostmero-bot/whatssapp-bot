const express = require('express')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const qrcode = require('qrcode')
const axios = require('axios')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

// Use volume mount for persistent authentication
const authPath = '/app/.wwebjs_auth'
if (!fs.existsSync(authPath)) {
  fs.mkdirSync(authPath, { recursive: true })
}

let currentQR = null

const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: "samia-bot",
    dataPath: authPath  // Use volume mount path, not temp
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--no-first-run",
      "--hide-scrollbars",
      "--mute-audio"
    ]
  }
})

// Function delays
function humanDelay(min = 10000, max = 15000) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)))
}

function outgoingMessageDelay(min = 5000, max = 10000) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)))
}

let repliesData = {}
let salonData = {}

// Load data
function loadData() {
  try {
    repliesData = JSON.parse(fs.readFileSync('replies.json', 'utf8'))
    console.log(`✓ Loaded ${Object.keys(repliesData).length} replies`)
  } catch (e) {
    console.error('✗ Error loading replies:', e.message)
    repliesData = {}
  }
  try {
    salonData = JSON.parse(fs.readFileSync('salon-data.txt', 'utf8'))
    console.log(`✓ Loaded salon data`)
  } catch (e) {
    console.error('✗ Error loading salon data:', e.message)
    salonData = {}
  }
}

loadData()

client.on('qr', async qr => {
  console.log('📱 [QR] Scan QR code to authenticate')
  currentQR = qr
  // Print to terminal
  const qrTerminal = require('qrcode-terminal')
  qrTerminal.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log('✅ [AUTH] Bot authenticated - session saved to volume')
  currentQR = null
})

client.on('ready', () => {
  console.log('🟢 [READY] Bot is online and listening')
})

client.on('message', async msg => {
  // Skip group messages
  if (msg.isGroupMsg) return
  
  // Skip bot's own messages
  if (msg.fromMe) return
  
  console.log(`📨 [MSG] From: ${msg.from.replace('@c.us', '')} | Text: "${msg.body}"`)
  
  await humanDelay()
  
  const text = msg.body.toLowerCase().trim()
  let reply = repliesData[text] || null
  
  if (reply) {
    console.log(`✓ [REPLY] Sending: "${reply}"`)
    await outgoingMessageDelay()
    try {
      await msg.reply(reply)
      console.log(`✓ [SENT] Message delivered`)
    } catch (e) {
      console.error(`✗ [ERROR] Failed to send:`, e.message)
    }
  } else {
    console.log(`✗ [NO_MATCH] No reply for: "${text}"`)
  }
})

client.on('disconnected', (reason) => {
  console.log('❌ [DISCONNECT] Bot offline:', reason)
})

client.on('error', (error) => {
  console.error('❌ [ERROR]', error.message)
})

// Express routes
app.use(express.json())
app.use(express.static('.'))

// QR Code page
app.get('/api/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`
      <html>
        <head>
          <title>WhatsApp Bot</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 40px; background: #f0f0f0; }
            .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            h1 { color: #25d366; }
            p { color: #666; font-size: 16px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Bot Authenticated</h1>
            <p>Your WhatsApp bot is connected and ready!</p>
            <p>Session saved to volume - will persist after restart</p>
          </div>
        </body>
      </html>
    `)
  }
  
  try {
    const qrImage = await qrcode.toDataURL(currentQR)
    res.send(`
      <html>
        <head>
          <title>WhatsApp Bot QR</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 40px; background: #f0f0f0; }
            .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            img { max-width: 100%; border: 2px solid #25d366; padding: 10px; }
            h1 { color: #25d366; margin-bottom: 10px; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 Scan QR Code</h1>
            <p>Scan with WhatsApp to authenticate:</p>
            <img src="${qrImage}" alt="QR Code" />
            <p><small>Auto-refreshing...</small></p>
          </div>
          <script>
            setInterval(() => location.reload(), 3000)
          </script>
        </body>
      </html>
    `)
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`)
  }
})

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !currentQR,
    botReady: client.info ? true : false,
    repliesLoaded: Object.keys(repliesData).length,
    botInfo: client.info
  })
})

// Manual send endpoint
app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body
  
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message required' })
  }

  try {
    await outgoingMessageDelay()
    await client.sendMessage(phone + '@c.us', message)
    res.json({ success: true, message: 'Sent' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📱 QR endpoint: /api/qr`)
  console.log(`📊 Status endpoint: /api/status`)
})

client.initialize()

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...')
  await client.destroy()
  process.exit(0)
})

