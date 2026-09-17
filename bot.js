const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// DATA
// ============================================================

let repliesData = {};
let currentQR = null;
let clientReady = false;

let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;

// ============================================================
// LOAD REPLIES
// ============================================================

function loadData() {
  try {
    const filePath = path.join(__dirname, 'replies.json');

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ replies.json not found at: ${filePath}`);
      repliesData = {};
      return;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    /*
      replies.json supports:

      [
        {
          "keywords": ["حجاب", "حجاب كامل"],
          "reply": "حجاب كامل ب 500"
        }
      ]
    */

    if (Array.isArray(parsed)) {
      repliesData = {};

      for (const item of parsed) {
        if (
          !item ||
          !Array.isArray(item.keywords) ||
          !item.reply
        ) {
          continue;
        }

        for (const keyword of item.keywords) {
          if (
            typeof keyword === 'string' &&
            keyword.trim()
          ) {
            repliesData[
              keyword.toLowerCase().trim()
            ] = item.reply;
          }
        }
      }
    }

    // Also support object format if used later
    else if (
      parsed &&
      typeof parsed === 'object'
    ) {
      repliesData = parsed;
    }

    else {
      repliesData = {};
    }

    console.log(
      `📚 Loaded ${Object.keys(repliesData).length} reply keywords`
    );

  } catch (error) {
    console.error(
      `❌ Failed to load replies.json: ${error.message}`
    );

    repliesData = {};
  }
}

loadData();

// ============================================================
// ARABIC NORMALIZATION
// ============================================================

function normalizeArabic(text = '') {
  return String(text)
    .toLowerCase()
    .trim()

    // Arabic letters normalization
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')

    // Remove tatweel
    .replace(/ـ/g, '')

    // Remove Arabic diacritics
    .replace(/[ًٌٍَُِّْـ]/g, '')

    // Normalize spaces
    .replace(/\s+/g, ' ');
}

// ============================================================
// FIND REPLY
// ============================================================

function findReply(messageText = '') {

  const text = normalizeArabic(messageText);

  if (!text) {
    return null;
  }

  // ----------------------------------------------------------
  // Exact match first
  // ----------------------------------------------------------

  for (const [keyword, reply] of Object.entries(repliesData)) {

    if (
      normalizeArabic(keyword) === text
    ) {
      return reply;
    }
  }

  // ----------------------------------------------------------
  // Search longest keywords first
  // ----------------------------------------------------------

  const entries = Object.entries(repliesData)
    .sort(
      (a, b) =>
        normalizeArabic(b[0]).length -
        normalizeArabic(a[0]).length
    );

  // ----------------------------------------------------------
  // Keyword inside message
  // ----------------------------------------------------------

  for (const [keyword, reply] of entries) {

    const normalizedKeyword =
      normalizeArabic(keyword);

    if (
      normalizedKeyword &&
      text.includes(normalizedKeyword)
    ) {
      return reply;
    }
  }

  return null;
}

// ============================================================
// DELAYS
// ============================================================

function humanDelay(
  min = 1000,
  max = 2500
) {
  return new Promise(resolve => {

    const delay =
      min +
      Math.random() * (max - min);

    setTimeout(resolve, delay);
  });
}

function outgoingMessageDelay(
  min = 500,
  max = 1200
) {
  return new Promise(resolve => {

    const delay =
      min +
      Math.random() * (max - min);

    setTimeout(resolve, delay);
  });
}

// ============================================================
// WHATSAPP AUTH PATH
// ============================================================

/*
  Replit:
  Uses .wwebjs_auth inside the project.

  Railway:
  If you create a Persistent Volume, you can set:

  WWEBJS_AUTH_PATH=/app/.wwebjs_auth

  in Railway Variables.
*/

const authPath =
  process.env.WWEBJS_AUTH_PATH ||
  path.join(__dirname, '.wwebjs_auth');

fs.mkdirSync(
  authPath,
  {
    recursive: true
  }
);

console.log(
  `📁 WhatsApp auth path: ${authPath}`
);

// ============================================================
// WHATSAPP CLIENT
// ============================================================

const client = new Client({

  authStrategy: new LocalAuth({

    clientId: 'samia-bot',

    dataPath: authPath

  }),

  puppeteer: {

    headless: true,

    args: [

      '--no-sandbox',

      '--disable-setuid-sandbox',

      '--disable-dev-shm-usage',

      '--disable-gpu',

      '--disable-software-rasterizer',

      '--disable-extensions',

      '--disable-background-networking',

      '--disable-background-timer-throttling',

      '--disable-renderer-backgrounding',

      '--disable-features=Translate,BackForwardCache',

      '--no-first-run',

      '--no-default-browser-check',

      '--disable-popup-blocking',

      '--disable-notifications',

      '--disable-sync'

    ],

    timeout: 60000,

    dumpio: false
  },

  webVersionCache: {

    type: 'local',

    path: path.join(
      __dirname,
      '.wwebjs_cache'
    )

  }

});

// ============================================================
// QR
// ============================================================

client.on(
  'qr',
  async qr => {

    console.log(
      '📱 [QR] New QR code generated'
    );

    console.log(
      '📱 [QR] Scan the QR code with WhatsApp'
    );

    currentQR = qr;

    try {

      qrcodeTerminal.generate(
        qr,
        {
          small: true
        }
      );

    } catch (error) {

      console.error(
        `❌ [QR] Terminal error: ${error.message}`
      );

    }

  }
);

// ============================================================
// AUTHENTICATED
// ============================================================

client.on(
  'authenticated',
  () => {

    console.log(
      '✅ [AUTH] Bot authenticated'
    );

    currentQR = null;

    restartAttempts = 0;

  }
);

// ============================================================
// READY
// ============================================================

client.on(
  'ready',
  () => {

    console.log(
      '🟢 [READY] Bot online and listening for messages'
    );

    clientReady = true;

    currentQR = null;

    restartAttempts = 0;

  }
);

// ============================================================
// AUTH FAILURE
// ============================================================

client.on(
  'auth_failure',
  message => {

    clientReady = false;

    console.error(
      `❌ [AUTH_FAILURE] ${message}`
    );

  }
);

// ============================================================
// DISCONNECTED
// ============================================================

client.on(
  'disconnected',
  reason => {

    clientReady = false;

    console.log(
      `❌ [DISCONNECT] Reason: ${reason}`
    );

    if (
      restartAttempts <
      MAX_RESTART_ATTEMPTS
    ) {

      restartAttempts++;

      console.log(
        `🔄 [RESTART] Attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}`
      );

      setTimeout(
        () => {

          client
            .initialize()
            .catch(
              error => {

                console.error(
                  `❌ [RESTART_ERROR] ${error.message}`
                );

              }
            );

        },
        3000
      );

    }

    else {

      console.log(
        '⚠️ [ERROR] Max restart attempts reached. Manual intervention needed.'
      );

    }

  }
);

// ============================================================
// GENERAL ERROR
// ============================================================

client.on(
  'error',
  error => {

    console.error(
      `❌ [ERROR] ${error.message}`
    );

  }
);

// ============================================================
// RECEIVE MESSAGE
// ============================================================

client.on(
  'message',
  async msg => {

    try {

      // Ignore our own messages
      if (msg.fromMe) {
        return;
      }

      // Ignore groups
      if (msg.isGroupMsg) {
        return;
      }

      // Extra protection against group messages
      if (
        typeof msg.from === 'string' &&
        msg.from.endsWith('@g.us')
      ) {
        return;
      }

      // Ignore WhatsApp status
      if (
        typeof msg.from === 'string' &&
        msg.from === 'status@broadcast'
      ) {
        return;
      }

      const text =
        (msg.body || '').trim();

      // Ignore empty messages
      if (!text) {
        return;
      }

      console.log(
        `📨 [MSG] From: ${
          (msg.from || '')
            .replace('@c.us', '')
        } | "${text}"`
      );

      // Human-like delay
      await humanDelay();

      // Find reply
      const reply =
        findReply(text);

      // No reply found
      if (!reply) {

        console.log(
          `✗ [NO_MATCH] "${text}"`
        );

        return;
      }

      console.log(
        `✓ [REPLY] "${reply}"`
      );

      await outgoingMessageDelay();

      // Send reply
      try {

        await msg.reply(reply);

        console.log(
          '✓ [SENT] Message delivered'
        );

      } catch (sendError) {

        console.error(
          `✗ [SEND_ERROR] ${sendError.message}`
        );

      }

    } catch (error) {

      console.error(
        `✗ [MESSAGE_ERROR] ${error.message}`
      );

    }

  }
);

// ============================================================
// EXPRESS
// ============================================================

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.static(__dirname)
);

// ============================================================
// QR API
// ============================================================

app.get(
  '/api/qr',
  async (req, res) => {

    try {

      // No QR available
      if (!currentQR) {

        return res.send(`

<!doctype html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta http-equiv="refresh" content="10">

<title>WhatsApp Bot Status</title>

<style>

body {
  font-family: Arial, sans-serif;
  text-align: center;
  padding: 40px;
  background: #f0f0f0;
}

.container {
  background: white;
  padding: 30px;
  border-radius: 15px;
  max-width: 500px;
  margin: auto;
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
}

h1 {
  color: #25d366;
}

.badge {
  display: inline-block;
  background: #25d366;
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: bold;
}

</style>

</head>

<body>

<div class="container">

<h1>
${
  clientReady
    ? '✅ Bot Connected'
    : '⏳ Waiting for QR'
}
</h1>

<p>
${
  clientReady
    ? 'WhatsApp bot is authenticated and running.'
    : 'QR code is not available yet. Refresh in a few seconds.'
}
</p>

<span class="badge">
${
  clientReady
    ? 'ONLINE'
    : 'STARTING'
}
</span>

</div>

</body>

</html>

`);

      }

      // Generate QR image
      const qrImage =
        await qrcode.toDataURL(
          currentQR
        );

      res.send(`

<!doctype html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta http-equiv="refresh" content="3">

<title>WhatsApp Bot QR</title>

<style>

body {
  font-family: Arial, sans-serif;
  text-align: center;
  padding: 30px;
  background: #f0f0f0;
}

.container {
  background: white;
  padding: 30px;
  border-radius: 15px;
  max-width: 500px;
  margin: auto;
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
}

h1 {
  color: #25d366;
}

img {
  width: 100%;
  max-width: 300px;
  border: 2px solid #25d366;
  border-radius: 10px;
  padding: 10px;
  box-sizing: border-box;
}

.info {
  color: #666;
  margin-top: 20px;
}

</style>

</head>

<body>

<div class="container">

<h1>
📱 Scan QR Code
</h1>

<p>
Use WhatsApp on your phone to scan.
</p>

<img
  src="${qrImage}"
  alt="WhatsApp QR Code"
>

<p class="info">
Page refreshes automatically.
</p>

</div>

</body>

</html>

`);

    } catch (error) {

      res
        .status(500)
        .send(
          `Error: ${error.message}`
        );

    }

  }
);

// ============================================================
// STATUS API
// ============================================================

app.get(
  '/api/status',
  (req, res) => {

    res.json({

      authenticated:
        !currentQR &&
        clientReady,

      botReady:
        clientReady,

      repliesLoaded:
        Object.keys(
          repliesData
        ).length,

      uptime:
        process.uptime(),

      restartAttempts

    });

  }
);

// ============================================================
// SEND MESSAGE API
// ============================================================

app.post(
  '/api/send',
  async (req, res) => {

    const {
      phone,
      message
    } = req.body || {};

    if (
      !phone ||
      !message
    ) {

      return res
        .status(400)
        .json({
          error:
            'Phone and message required'
        });

    }

    if (!clientReady) {

      return res
        .status(503)
        .json({
          error:
            'Bot not ready'
        });

    }

    try {

      // Remove spaces, +, -, etc.
      const cleanPhone =
        String(phone)
          .replace(/[^\d]/g, '');

      await client.sendMessage(
        `${cleanPhone}@c.us`,
        String(message)
      );

      res.json({

        success: true,

        message:
          'Message sent'

      });

    } catch (error) {

      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/health',
  (req, res) => {

    res.json({

      status: 'ok',

      bot:
        clientReady
          ? 'online'
          : 'offline'

    });

  }
);

// ============================================================
// START SERVER
// ============================================================

const server =
  app.listen(
    PORT,
    () => {

      console.log(
        `🚀 Server running on port ${PORT}`
      );

      console.log(
        '📊 API endpoints:'
      );

      console.log(
        '   /api/qr - QR code page'
      );

      console.log(
        '   /api/status - Bot status'
      );

      console.log(
        '   /api/send - Send WhatsApp message'
      );

      console.log(
        '   /health - Health check'
      );

    }
  );

// ============================================================
// START WHATSAPP
// ============================================================

async function startClient() {

  try {

    console.log(
      '🔧 Initializing WhatsApp client...'
    );

    await client.initialize();

  } catch (error) {

    clientReady = false;

    console.error(
      `❌ Failed to initialize client: ${error.message}`
    );

    process.exitCode = 1;

  }

}

startClient();

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {

  console.log(
    `\n🛑 ${signal} received. Shutting down...`
  );

  try {

    await client.destroy();

    console.log(
      '✓ Client destroyed'
    );

  } catch (error) {

    console.error(
      `Error destroying client: ${error.message}`
    );

  }

  server.close(
    () => {

      console.log(
        '✓ HTTP server closed'
      );

      process.exit(0);

    }
  );

  // Force exit if server does not close
  setTimeout(
    () => process.exit(0),
    5000
  ).unref();

}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);
