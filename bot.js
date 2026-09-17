const express = require('express')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const qrcode = require('qrcode')
const axios = require('axios')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000

// Use temp directory for Chrome profile
const tempDir = '/tmp/wwebjs_auth_' + Date.now()
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true })
}

let currentQR = null

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "samia-bot", dataPath: tempDir }),
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
    console.log(`Loaded ${Object.keys(repliesData).length} replies`)
  } catch (e) {
    console.error('Error loading replies:', e.message)
    repliesData = {}
  }
  try {
    salonData = JSON.parse(fs.readFileSync('salon-data.txt', 'utf8'))
    console.log(`Loaded salon data`)
  } catch (e) {
    console.error('Error loading salon data:', e.message)
    salonData = {}
  }
}

loadData()

client.on('qr', async qr => {
  console.log('📱 QR code generated - scan to authenticate')
  currentQR = qr
  // Also print to terminal for quick scan
  const qrTerminal = require('qrcode-terminal')
  qrTerminal.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log('✅ Bot authenticated successfully')
  currentQR = null
})

client.on('ready', () => {
  console.log('🟢 Bot is ready and listening for messages')
})

client.on('message', async msg => {
  console.log(`[MSG] Received: "${msg.body}" from ${msg.from}`)
  
  // Skip group messages
  if (msg.isGroupMsg) {
    console.log(`[SKIP] Group message, ignoring`)
    return
  }
  
  // Skip bot's own messages
  if (msg.fromMe) {
    console.log(`[SKIP] Own message, ignoring`)
    return
  }
  
  await humanDelay()
  
  const text = msg.body.toLowerCase().trim()
  console.log(`[SEARCH] Looking for reply for: "${text}"`)
  
  // Try to find reply
  let reply = repliesData[text] || null
  
  if (reply) {
    console.log(`[FOUND] Found reply: "${reply}"`)
    await outgoingMessageDelay()
    try {
      await msg.reply(reply)
      console.log(`[SENT] ✓ Reply sent`)
    } catch (e) {
      console.error(`[ERROR] Failed to send reply:`, e.message)
    }
  } else {
    console.log(`[NO_REPLY] No matching reply for: "${text}"`)
    console.log(`[DEBUG] Available keys sample:`, Object.keys(repliesData).slice(0, 5))
  }
})

client.on('disconnected', (reason) => {
  console.log('❌ Bot disconnected:', reason)
})

client.on('error', (error) => {
  console.error('❌ Client error:', error)
})

// Express routes
app.use(express.json())
app.use(express.static('.'))

// QR Code endpoint - returns HTML page with image
app.get('/api/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`
      <html>
        <head>
          <title>WhatsApp Bot - Authenticated</title>
          <style>
            body { font-family: Arial; text-align: center; padding: 40px; }
            h1 { color: green; }
          </style>
        </head>
        <body>
          <h1>✅ Bot is Authenticated</h1>
          <p>Your WhatsApp bot is already connected and running!</p>
        </body>
      </html>
    `)
  }
  
  try {
    const qrImage = await qrcode.toDataURL(currentQR)
    res.send(`
      <html>
        <head>
          <title>WhatsApp Bot QR Code</title>
          <style>
            body { 
              font-family: Arial; 
              text-align: center; 
              padding: 40px;
              background: #f0f0f0;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 10px;
              max-width: 500px;
              margin: 0 auto;
              box-shadow: 0 0 10px rgba(0,0,0,0.1);
            }
            img { 
              max-width: 100%; 
              height: auto;
              border: 2px solid #25d366;
              padding: 10px;
            }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 WhatsApp Bot QR Code</h1>
            <p>Scan this QR code with your phone to authenticate:</p>
            <img src="${qrImage}" alt="QR Code" />
            <p><small>This page will refresh when authenticated</small></p>
          </div>
          <script>
            // Refresh every 5 seconds to check if authenticated
            setTimeout(() => location.reload(), 5000)
          </script>
        </body>
      </html>
    `)
  } catch (error) {
    res.status(500).send(`Error generating QR: ${error.message}`)
  }
})

app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !currentQR,
    botReady: client.info ? true : false,
    repliesLoaded: Object.keys(repliesData).length,
    ready: client.info ? true : false
  })
})

app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body
  
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message required' })
  }

  try {
    await outgoingMessageDelay()
    await client.sendMessage(phone + '@c.us', message)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/ready', (req, res) => {
  res.json({ 
    ready: client.info ? true : false,
    authenticated: currentQR ? false : true 
  })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

client.initialize()

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down...')
  await client.destroy()
  
  // Clean temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch (e) {}
  
  process.exit(0)
})

