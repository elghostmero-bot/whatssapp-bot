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
  } catch (e) {
    repliesData = {}
  }
  try {
    salonData = JSON.parse(fs.readFileSync('salon-data.txt', 'utf8'))
  } catch (e) {
    salonData = {}
  }
}

loadData()

client.on('qr', async qr => {
  console.log('QR code generated')
  currentQR = qr
  // Also print to terminal for quick scan
  const qrTerminal = require('qrcode-terminal')
  qrTerminal.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log('Bot authenticated')
  currentQR = null
})

client.on('ready', () => {
  console.log('Bot is ready')
})

client.on('message', async msg => {
  await humanDelay()
  
  const text = msg.body.toLowerCase()
  const phone = msg.from.replace('@c.us', '')

  // Try to find reply
  let reply = repliesData[text] || null
  
  if (reply) {
    await outgoingMessageDelay()
    await msg.reply(reply)
  } else {
    console.log(`No reply for: ${text}`)
  }
})

// Express routes
app.use(express.json())
app.use(express.static('.'))

// QR Code endpoint
app.get('/api/qr', async (req, res) => {
  if (!currentQR) {
    return res.json({ 
      authenticated: true, 
      message: 'Bot is already authenticated' 
    })
  }
  
  try {
    const qrImage = await qrcode.toDataURL(currentQR)
    res.json({ 
      qr: qrImage,
      authenticated: false
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
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
  console.log(`Server running on port ${PORT}`)
})

client.initialize()

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await client.destroy()
  
  // Clean temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch (e) {}
  
  process.exit(0)
})

