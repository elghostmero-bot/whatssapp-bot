const express = require('express')
const { Client, LocalAuth, MessageMedia, RemoteAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode')
const fs = require('fs')
const path = require('path')
const { Store } = require('express-session')

const app = express()
const PORT = process.env.PORT || 3000

// Use temporary session directory - NO PERSISTENT VOLUME
// This forces fresh browser instance each restart (avoids lock issues)
const sessionDir = `/tmp/whatsapp_session_${Date.now()}`
const authPath = `${sessionDir}/auth`

fs.mkdirSync(authPath, { recursive: true })

console.log(`📁 Using session directory: ${sessionDir}`)

let currentQR = null
let clientReady = false

const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: "samia-bot",
    dataPath: authPath
  }),
  puppeteer: {
    headless: 'new',
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
      '--disable-component-extensions-with-background-pages',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync-preferences',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-pings',
      '--no-service-autorun',
      '--password-store=basic',
      '--use-mock-keychain',
      '--use-gl=swiftshader'
    ],
    timeout: 30000,
    dumpio: false
  },
  webVersionCache: {
    type: 'local',
    path: `${sessionDir}/cache`
  }
})

// Restart handler
let restartAttempts = 0
const MAX_RESTART_ATTEMPTS = 5

client.on('disconnected', async (reason) => {
  console.log(`❌ [DISCONNECT] Reason: ${reason}`)
  clientReady = false
  
  if (restartAttempts < MAX_RESTART_ATTEMPTS) {
    restartAttempts++
    console.log(`🔄 [RESTART] Attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}`)
    setTimeout(() => client.initialize(), 2000)
  } else {
    console.log('⚠️ [ERROR] Max restart attempts reached. Manual intervention needed.')
  }
})

client.on('error', (error) => {
  console.error(`❌ [ERROR] ${error.message}`)
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
  console.log('📱 [QR] New QR code generated - scan within 5 minutes')
  currentQR = qr
  const qrTerminal = require('qrcode-terminal')
  qrTerminal.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log('✅ [AUTH] Successfully authenticated')
  currentQR = null
  restartAttempts = 0
})

client.on('ready', () => {
  console.log('🟢 [READY] Bot online and listening for messages')
  clientReady = true
})

client.on('message', async msg => {
  // Skip groups and own messages
  if (msg.isGroupMsg || msg.fromMe) return
  
  try {
    const senderName = msg.author || msg.from
    const text = msg.body.toLowerCase().trim()
    
    console.log(`📨 [MSG] ${senderName}: "${msg.body}"`)
    
    // Skip empty messages
    if (!text) return
    
    await humanDelay()
    
    const reply = repliesData[text] || null
    
    if (reply) {
      console.log(`✓ [FOUND] Sending: "${reply}"`)
      await outgoingMessageDelay()
      
      try {
        await msg.reply(reply)
        console.log(`✓ [SENT] Message delivered`)
      } catch (sendError) {
        console.error(`✗ [SEND_ERROR] ${sendError.message}`)
      }
    } else {
      console.log(`✗ [NO_MATCH] No reply for: "${text}"`)
    }
  } catch (error) {
    console.error(`✗ [MESSAGE_ERROR] ${error.message}`)
  }
})

// Express routes
app.use(express.json())
app.use(express.static('.'))

// QR Code endpoint
app.get('/api/qr', async (req, res) => {
  if (!currentQR) {
    return res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>WhatsApp Bot Status</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 15px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #25d366; margin-bottom: 10px; font-size: 28px; }
            .status { color: #666; font-size: 16px; margin-bottom: 20px; }
            .badge {
              display: inline-block;
              background: #25d366;
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              font-size: 14px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Bot Connected</h1>
            <p class="status">WhatsApp bot is authenticated and running</p>
            <span class="badge">🟢 ONLINE</span>
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
          <meta charset="UTF-8">
          <title>WhatsApp Bot - Scan QR</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 15px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #25d366; margin-bottom: 20px; font-size: 28px; }
            .qr-box {
              background: #f5f5f5;
              border: 2px solid #25d366;
              border-radius: 10px;
              padding: 20px;
              margin: 20px 0;
            }
            img { width: 100%; max-width: 300px; }
            .info { color: #666; font-size: 14px; margin-top: 20px; }
            .timer { color: #e74c3c; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 Scan QR Code</h1>
            <p>Use WhatsApp on your phone to scan:</p>
            <div class="qr-box">
              <img src="${qrImage}" alt="QR Code">
            </div>
            <p class="info">Valid for 5 minutes. <span class="timer">Auto-refreshing...</span></p>
          </div>
          <script>
            setInterval(() => location.reload(), 3000)
          </script>
        </body>
      </html>
    `)
  } catch (error) {
    res.status(500).send(`<html><body><h1>Error</h1><p>${error.message}</p></body></html>`)
  }
})

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !currentQR,
    botReady: clientReady,
    repliesLoaded: Object.keys(repliesData).length,
    uptime: process.uptime(),
    restartAttempts
  })
})

// Send message endpoint
app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body
  
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message required' })
  }

  if (!clientReady) {
    return res.status(503).json({ error: 'Bot not ready' })
  }
  
  try {
    await client.sendMessage(phone + '@c.us', message)
    res.json({ success: true, message: 'Message sent' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    bot: clientReady ? 'online' : 'offline'
  })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 API endpoints:`)
  console.log(`   /api/qr - QR code page`)
  console.log(`   /api/status - Bot status`)
  console.log(`   /health - Health check`)
})

// Initialize client
console.log('🔧 Initializing WhatsApp client...')
client.initialize().catch(err => {
  console.error('Failed to initialize client:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...')
  try {
    await client.destroy()
    console.log('✓ Client destroyed')
  } catch (e) {
    console.error('Error destroying client:', e)
  }
  
  // Clean temp directory
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true })
    console.log('✓ Temp directory cleaned')
  } catch (e) {}
  
  process.exit(0)
})

