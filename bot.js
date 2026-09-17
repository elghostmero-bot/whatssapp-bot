const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;

let botReady = false;
let latestQR = null;
let client = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// =========================
// Load Replies
// =========================

function loadData() {
    try {
        const filePath = path.join(__dirname, 'replies.json');

        if (!fs.existsSync(filePath)) {
            console.error('❌ replies.json not found');
            return [];
        }

        const data = JSON.parse(
            fs.readFileSync(filePath, 'utf8')
        );

        if (Array.isArray(data)) {
            console.log(`📚 Loaded ${data.length} reply keywords`);
            return data;
        }

        if (data && typeof data === 'object') {
            const result = [];

            for (const [category, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    result.push({
                        category,
                        keywords: [category],
                        reply: value
                    });
                } else if (value && typeof value === 'object') {
                    result.push({
                        category,
                        keywords: value.keywords || [category],
                        reply: value.reply || value.response || ''
                    });
                }
            }

            console.log(`📚 Loaded ${result.length} reply keywords`);
            return result;
        }

        console.error('❌ Invalid replies.json format');
        return [];

    } catch (error) {
        console.error(
            '❌ Error loading replies.json:',
            error.message
        );

        return [];
    }
}

const replies = loadData();

// =========================
// Arabic Normalization
// =========================

function normalizeArabic(text) {
    if (!text) return '';

    return String(text)
        .toLowerCase()
        .replace(/[إأآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ـ/g, '')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// =========================
// Find Reply
// =========================

function findReply(messageText) {
    const text = normalizeArabic(messageText);

    if (!text) {
        return null;
    }

    // Exact match first
    for (const item of replies) {
        const keywords = Array.isArray(item.keywords)
            ? item.keywords
            : [item.keywords];

        for (const keyword of keywords) {
            const normalizedKeyword = normalizeArabic(keyword);

            if (
                normalizedKeyword &&
                text === normalizedKeyword
            ) {
                return item.reply;
            }
        }
    }

    // Longest matching keyword
    let bestMatch = null;
    let bestLength = 0;

    for (const item of replies) {
        const keywords = Array.isArray(item.keywords)
            ? item.keywords
            : [item.keywords];

        for (const keyword of keywords) {
            const normalizedKeyword = normalizeArabic(keyword);

            if (
                normalizedKeyword &&
                text.includes(normalizedKeyword) &&
                normalizedKeyword.length > bestLength
            ) {
                bestMatch = item.reply;
                bestLength = normalizedKeyword.length;
            }
        }
    }

    return bestMatch;
}

// =========================
// Delay
// =========================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =========================
// WhatsApp Auth Path
// =========================

const authPath =
    process.env.WWEBJS_AUTH_PATH ||
    path.join(__dirname, '.wwebjs_auth');

console.log(`📁 WhatsApp auth path: ${authPath}`);

// =========================
// Remove Stale Chromium Locks
// =========================

function removeChromiumLocks(dir) {
    if (!fs.existsSync(dir)) {
        return;
    }

    const lockNames = [
        'SingletonLock',
        'SingletonSocket',
        'SingletonCookie'
    ];

    try {
        const entries = fs.readdirSync(dir, {
            withFileTypes: true
        });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                removeChromiumLocks(fullPath);
                continue;
            }

            if (lockNames.includes(entry.name)) {
                try {
                    fs.unlinkSync(fullPath);

                    console.log(
                        `🧹 Removed stale Chromium lock: ${fullPath}`
                    );
                } catch (error) {
                    console.log(
                        `⚠️ Could not remove lock ${fullPath}: ${error.message}`
                    );
                }
            }
        }
    } catch (error) {
        console.log(
            `⚠️ Could not scan ${dir}: ${error.message}`
        );
    }
}

// =========================
// Prepare WhatsApp Profile
// =========================

function prepareWhatsAppProfile() {
    console.log('🧹 Checking for old Chromium locks...');

    removeChromiumLocks(authPath);

    console.log('✅ Chromium lock cleanup finished');
}

// =========================
// Create WhatsApp Client
// =========================

function createClient() {
    return new Client({
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
            ]
        }
    });
}

// =========================
// Client Event Registration
// =========================

function registerClientEvents(currentClient) {

    // QR
    currentClient.on('qr', async qr => {
        console.log('📱 QR Code received');

        latestQR = qr;
        botReady = false;

        qrcodeTerminal.generate(qr, {
            small: true
        });

        try {
            await qrcode.toDataURL(qr);
        } catch (error) {
            console.error(
                '❌ QR conversion error:',
                error.message
            );
        }
    });

    // Authenticated
    currentClient.on('authenticated', () => {
        console.log('✅ WhatsApp authenticated');
    });

    // Ready
    currentClient.on('ready', () => {
        console.log('================================');
        console.log('✅ WhatsApp BOT IS READY');
        console.log('================================');

        botReady = true;
        latestQR = null;
        reconnectAttempts = 0;
    });

    // Auth failure
    currentClient.on('auth_failure', msg => {
        console.error(
            '❌ WhatsApp authentication failure:',
            msg
        );

        botReady = false;
    });

    // Error
    currentClient.on('error', error => {
        console.error(
            '❌ WhatsApp client error:',
            error
        );
    });

    // Disconnected
    currentClient.on('disconnected', async reason => {
        console.log(
            '⚠️ WhatsApp disconnected:',
            reason
        );

        botReady = false;

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(
                '❌ Maximum reconnect attempts reached'
            );

            return;
        }

        reconnectAttempts++;

        console.log(
            `🔄 Reconnecting... attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`
        );

        await delay(5000);

        try {
            await currentClient.destroy();
        } catch (error) {
            console.log(
                '⚠️ Destroy warning:',
                error.message
            );
        }

        try {
            prepareWhatsAppProfile();

            client = createClient();

            registerClientEvents(client);

            registerMessageHandler(client);

            await client.initialize();

        } catch (error) {
            console.error(
                '❌ Reconnect failed:',
                error.message
            );
        }
    });
}

// =========================
// Message Handler
// =========================

function registerMessageHandler(currentClient) {

    currentClient.on('message', async msg => {

        try {
            // Ignore own messages
            if (msg.fromMe) {
                return;
            }

            // Ignore groups
            if (
                msg.from &&
                msg.from.endsWith('@g.us')
            ) {
                return;
            }

            // Ignore status
            if (msg.from === 'status@broadcast') {
                return;
            }

            const body = (msg.body || '').trim();

            if (!body) {
                return;
            }

            console.log(
                `📩 Message from ${msg.from}: ${body}`
            );

            const reply = findReply(body);

            if (!reply) {
                console.log(
                    '❓ No matching reply found'
                );

                return;
            }

            console.log(
                `💬 Reply: ${reply}`
            );

            await delay(800);

            await msg.reply(reply);

            console.log(
                '✅ Reply sent'
            );

        } catch (error) {
            console.error(
                '❌ Message handling error:',
                error.message
            );
        }
    });
}

// =========================
// API: QR
// =========================

app.get('/api/qr', async (req, res) => {

    try {

        if (!latestQR) {

            return res.send(`
                <!DOCTYPE html>
                <html lang="ar">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport"
                          content="width=device-width, initial-scale=1.0">

                    <title>WhatsApp QR</title>

                    <style>
                        body {
                            font-family: Arial;
                            text-align: center;
                            padding: 40px;
                            background: #111;
                            color: #fff;
                        }
                    </style>
                </head>

                <body>

                    <h2>
                        ${
                            botReady
                                ? '✅ البوت متصل بالفعل'
                                : '⏳ لم يتم إنشاء QR Code حتى الآن'
                        }
                    </h2>

                </body>
                </html>
            `);
        }

        const qrData =
            await qrcode.toDataURL(latestQR);

        res.send(`
            <!DOCTYPE html>
            <html lang="ar">

            <head>

                <meta charset="UTF-8">

                <meta name="viewport"
                      content="width=device-width, initial-scale=1.0">

                <title>WhatsApp QR</title>

                <style>

                    body {
                        margin: 0;
                        padding: 30px;
                        background: #111;
                        color: #fff;
                        font-family: Arial, sans-serif;
                        text-align: center;
                    }

                    img {
                        width: 300px;
                        max-width: 90%;
                        background: #fff;
                        padding: 15px;
                        border-radius: 10px;
                    }

                </style>

            </head>

            <body>

                <h2>
                    📱 امسح QR من واتساب
                </h2>

                <img
                    src="${qrData}"
                    alt="WhatsApp QR"
                >

                <p>
                    افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز
                </p>

            </body>

            </html>
        `);

    } catch (error) {

        console.error(
            '❌ QR API error:',
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =========================
// API: Status
// =========================

app.get('/api/status', (req, res) => {

    res.json({
        success: true,
        ready: botReady,
        hasQR: !!latestQR,
        status: botReady
            ? 'connected'
            : 'disconnected'
    });

});

// =========================
// API: Send Message
// =========================

app.post('/api/send', async (req, res) => {

    try {

        const {
            phone,
            message
        } = req.body;

        if (!phone || !message) {

            return res.status(400).json({
                success: false,
                error: 'phone and message are required'
            });

        }

        if (!botReady) {

            return res.status(503).json({
                success: false,
                error: 'WhatsApp bot is not ready'
            });

        }

        const cleanPhone =
            String(phone).replace(/\D/g, '');

        if (!cleanPhone) {

            return res.status(400).json({
                success: false,
                error: 'Invalid phone number'
            });

        }

        const chatId =
            `${cleanPhone}@c.us`;

        const sentMessage =
            await client.sendMessage(
                chatId,
                String(message)
            );

        res.json({
            success: true,
            messageId:
                sentMessage.id._serialized
        });

    } catch (error) {

        console.error(
            '❌ Send message error:',
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

// =========================
// Health
// =========================

app.get('/health', (req, res) => {

    res.status(200).json({
        status: 'ok',
        whatsapp: botReady
            ? 'ready'
            : 'not_ready'
    });

});

// =========================
// Start Server
// =========================

app.listen(PORT, () => {

    console.log(
        `🚀 Server running on port ${PORT}`
    );

    console.log(
        '  /api/status - Bot status'
    );

    console.log('📊 API endpoints:');

    console.log(
        '  /api/send - Send WhatsApp message'
    );

    console.log(
        '  /api/qr - QR code page'
    );

    console.log(
        '  /health - Health check'
    );

});

// =========================
// Initialize WhatsApp
// =========================

async function startClient() {

    try {

        console.log(
            '🧹 Preparing WhatsApp profile...'
        );

        prepareWhatsAppProfile();

        console.log(
            '🔧 Creating WhatsApp client...'
        );

        client = createClient();

        registerClientEvents(client);

        registerMessageHandler(client);

        console.log(
            '🔧 Initializing WhatsApp client...'
        );

        await client.initialize();

    } catch (error) {

        console.error(
            '❌ Failed to initialize client:',
            error.message
        );

        botReady = false;

        setTimeout(() => {

            console.log(
                '🔄 Trying to initialize again...'
            );

            startClient();

        }, 10000);
    }
}

startClient();

// =========================
// Graceful Shutdown
// =========================

async function shutdown(signal) {

    console.log(
        `\n🛑 Received ${signal}`
    );

    try {

        if (client) {
            await client.destroy();
        }

    } catch (error) {

        console.error(
            '⚠️ Shutdown error:',
            error.message
        );

    }

    process.exit(0);
}

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);
