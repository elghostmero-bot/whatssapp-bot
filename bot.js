```js
const express = require("express");
const app = express();

app.use(express.json({ limit: "20mb" }));

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

// =========================
// Environment Variables
// =========================

const APP_URL = process.env.APP_URL;
const AI_SECRET_KEY = process.env.AI_SECRET_KEY;
const BRANCH_ID = Number(process.env.BRANCH_ID || 1);
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;

const ADMIN_NUMBER = "201098266665@c.us";

// =========================
// WhatsApp Client
// =========================

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "samia-bot"
    }),

    puppeteer: {
        headless: true,

        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    }
});

// =========================
// WhatsApp Events
// =========================

client.on("qr", qr => {
    console.log("📱 WhatsApp QR Code received");
    qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
    console.log("WhatsApp authenticated");
});

client.on("ready", () => {
    console.log("================================");
    console.log("WhatsApp Bot Ready");
    console.log("================================");
});

client.on("auth_failure", msg => {
    console.log(
        "WhatsApp authentication failure:",
        msg
    );
});

client.on("disconnected", reason => {
    console.log(
        "WhatsApp disconnected:",
        reason
    );
});

client.on("error", err => {
    console.log(
        "WhatsApp client error:",
        err.message
    );
});

// =========================
// Format Phone Number
// =========================

function formatNumber(num) {

    num = String(num).replace(/\D/g, "");

    if (num.startsWith("20")) {
        return num;
    }

    if (num.startsWith("0")) {
        return "20" + num.slice(1);
    }

    if (num.length === 10) {
        return "20" + num;
    }

    return num;
}

// =========================
// Human Delay
// =========================

function humanDelay(min = 1500, max = 4000) {

    return new Promise(resolve => {

        setTimeout(
            resolve,
            min + Math.random() * (max - min)
        );

    });
}

// =========================
// Ignored Messages
// =========================

function isIgnored(text) {

    if (!text) {
        return true;
    }

    const cleaned = text
        .replace(
            /[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu,
            ""
        )
        .trim();

    if (!cleaned) {
        return true;
    }

    const low =
        text.trim().toLowerCase();

    return [
        "ok",
        "okay",
        "تمام",
        "تم",
        "شكرا",
        "شكراً",
        "thanks",
        "thx",
        "👍",
        "👌"
    ].includes(low);
}

// =========================
// WhatsApp Customer Messages
// =========================

client.on("message", async msg => {

    if (msg.fromMe) {
        return;
    }

    if (msg.from === "status@broadcast") {
        return;
    }

    if (msg.from.includes("@g.us")) {
        return;
    }

    if (isIgnored(msg.body)) {
        return;
    }

    const phone =
        formatNumber(
            msg.from.replace("@c.us", "")
        );

    console.log(
        "WhatsApp message from " +
        phone +
        ": " +
        msg.body
    );

    try {

        await humanDelay(2000, 4500);

        // =========================
        // Ask Application AI
        // =========================

        if (!APP_URL || !AI_SECRET_KEY) {

            console.log(
                "AI API configuration is missing"
            );

            return;
        }

        const response =
            await fetch(
                APP_URL + "/api/ai/respond",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "x-api-key":
                            AI_SECRET_KEY
                    },

                    body: JSON.stringify({
                        branchId: BRANCH_ID,
                        phone: phone,
                        message: msg.body
                    })
                }
            );

        if (!response.ok) {

            console.log(
                "AI API error:",
                response.status,
                await response.text()
            );

            return;
        }

        const data =
            await response.json();

        const reply =
            data.reply;

        if (reply) {

            await msg.reply(reply);

            console.log(
                "AI reply sent to " +
                phone
            );
        }

    } catch (err) {

        console.log(
            "ERROR:",
            err.message
        );
    }
});

// =========================
// Send Message From App
// =========================

app.post(
    "/send-message",
    async (req, res) => {

        let phone =
            req.body.phone;

        const message =
            req.body.message;

        if (!phone || !message) {

            return res
                .status(400)
                .json({
                    error:
                        "phone and message required"
                });
        }

        phone =
            formatNumber(phone);

        try {

            await humanDelay(
                1500,
                4000
            );

            await client.sendMessage(
                phone + "@c.us",
                message
            );

            console.log(
                "Message sent to " +
                phone
            );

            res.json({
                success: true
            });

        } catch (err) {

            console.log(
                "Send message error:",
                err.message
            );

            res
                .status(500)
                .json({
                    error:
                        err.message
                });
        }
    }
);

// =========================
// Messenger Webhook Verify
// =========================

app.get(
    "/webhook",
    (req, res) => {

        const VERIFY_TOKEN =
            "samia_bot_verify";

        const mode =
            req.query["hub.mode"];

        const token =
            req.query["hub.verify_token"];

        const challenge =
            req.query["hub.challenge"];

        if (
            mode === "subscribe" &&
            token === VERIFY_TOKEN
        ) {

            console.log(
                "WEBHOOK VERIFIED"
            );

            return res
                .status(200)
                .send(challenge);
        }

        res.sendStatus(403);
    }
);

// =========================
// Messenger Webhook
// =========================

app.post(
    "/webhook",
    async (req, res) => {

        const body = req.body;

        if (body.object !== "page") {
            return res.sendStatus(200);
        }

        for (
            const entry of
            body.entry || []
        ) {

            const events =
                entry.messaging;

            if (!events) {
                continue;
            }

            for (
                const ev of events
            ) {

                if (
                    !ev.sender ||
                    !ev.message
                ) {
                    continue;
                }

                const sender_psid =
                    ev.sender.id;

                const text =
                    ev.message.text;

                if (!text) {
                    continue;
                }

                try {

                    if (
                        !APP_URL ||
                        !AI_SECRET_KEY
                    ) {

                        console.log(
                            "AI API configuration is missing"
                        );

                        continue;
                    }

                    const ai =
                        await fetch(
                            APP_URL +
                            "/api/ai/respond",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json",

                                    "x-api-key":
                                        AI_SECRET_KEY
                                },

                                body:
                                    JSON.stringify({
                                        branchId:
                                            BRANCH_ID,

                                        phone:
                                            sender_psid,

                                        message:
                                            text
                                    })
                            }
                        );

                    if (!ai.ok) {

                        console.log(
                            "Messenger AI API error:",
                            ai.status,
                            await ai.text()
                        );

                        continue;
                    }

                    const data =
                        await ai.json();

                    const reply =
                        data.reply;

                    if (!reply) {
                        continue;
                    }

                    if (!FB_PAGE_TOKEN) {

                        console.log(
                            "FB_PAGE_TOKEN is missing"
                        );

                        continue;
                    }

                    await fetch(
                        "https://graph.facebook.com/v18.0/me/messages?access_token=" +
                        FB_PAGE_TOKEN,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    messaging_type:
                                        "RESPONSE",

                                    recipient: {
                                        id:
                                            sender_psid
                                    },

                                    message: {
                                        text:
                                            reply
                                    }
                                })
                        }
                    );

                    console.log(
                        "Messenger reply sent to " +
                        sender_psid
                    );

                } catch (err) {

                    console.log(
                        "Messenger error:",
                        err.message
                    );
                }
            }
        }

        res
            .status(200)
            .send("EVENT_RECEIVED");
    }
);

// =========================
// Home
// =========================

app.get(
    "/",
    (req, res) => {

        res.send(
            "WhatsApp bot is running"
        );
    }
);

// =========================
// Health
// =========================

app.get(
    "/health",
    (req, res) => {

        res.status(200).json({
            status: "ok"
        });
    }
);

// =========================
// Start Server
// =========================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log(
            "Server running on port " +
            PORT
        );
    }
);

// =========================
// Initialize WhatsApp
// =========================

console.log(
    "Initializing WhatsApp client..."
);

client.initialize();

module.exports = {
    client
};
```
