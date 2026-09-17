const express = require('express')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const qrcode = require('qrcode')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

// Volume mount for persistent authentication
const authPath = '/app/.wwebjs_auth'
if (!fs.existsSync(authPath)) {
  fs.mkdirSync(authPath, { recursive: true })
}

let currentQR = null

const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: "samia-bot",
    dataPath: authPath
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--no-first-run',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-plugins',
      '--use-gl=swiftshader',
      '--disable-software-rasterizer',
      '--disable-blink-features=AutomationControlled',
      '--disable-device-discovery-notifications'
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

// Load data
function loadData() {
  try {
    repliesData = JSON.parse(fs.readFileSync('replies.json', 'utf8'))
    console.log(`✓ Loaded ${Object.keys(repliesData).length} replies`)
  } catch (e) {
    console.error('✗ Error loading replies:', e.message)
    repliesData = {}
  }
}

loadData()

client.on('qr', async qr => {
  console.log('📱 [QR] Scan QR code to authenticate')
  currentQR = qr
  const qrTerminal = require('qrcode-terminal')
  qrTerminal.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log('✅ [AUTH] Bot authenticated')
  currentQR = null
})

client.on('ready', () => {
  console.log('🟢 [READY] Bot online and listening')
})

client.on('message', async msg => {
  if (msg.isGroupMsg || msg.fromMe) return
  
  console.log(`📨 [MSG] From: ${msg.from.replace('@c.us', '')} | "${msg.body}"`)
  
  await humanDelay()
  
  const text = msg.body.toLowerCase().trim()
  let reply = repliesData[text] || null
  
  if (reply) {
    console.log(`✓ [REPLY] "${reply}"`)
    await outgoingMessageDelay()
    try {
      await msg.reply(reply)
      console.log(`✓ [SENT]`)
    } catch (e) {
      console.error(`✗ [ERROR]`, e.message)
    }
  } else {
    console.log(`✗ [NO_MATCH] "${text}"`)
  }
})

client.on('disconnected', (reason) => {
  console.log('❌ [DISCONNECT]:', reason)
})

client.on('error', (error) => {
  console.error('❌ [ERROR]', error.message)
})

// Express routes
app.use(express.json())
app.use(express.static('.'))

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
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Authenticated</h1>
            <p>Bot is running</p>
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
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 Scan QR</h1>
            <img src="${qrImage}" alt="QR" />
          </div>
          <script>setInterval(() => location.reload(), 3000)</script>
        </body>
      </html>
    `)
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`)
  }
})

app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !currentQR,
    botReady: client.info ? true : false,
    repliesLoaded: Object.keys(repliesData).length
  })
})

app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' })
  
  try {
    await client.sendMessage(phone + '@c.us', message)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`)
})

client.initialize()

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...')
  await client.destroy()
  process.exit(0)
})

