const express = require("express")
const app = express()
app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN

const APP_URL       = process.env.APP_URL
const AI_SECRET_KEY = process.env.AI_SECRET_KEY
const BRANCH_ID     = Number(process.env.BRANCH_ID || 1)

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "samia-bot" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"]
  }
})

let currentQR = null

client.on("qr", async qr => {
  qrcode.generate(qr, { small: true })
  currentQR = await require("qrcode").toDataURL(qr)
  console.log("QR ready at /qr")
})
client.on("authenticated", () => console.log("WhatsApp authenticated"))
client.on("ready",         () => console.log("WhatsApp Bot Ready"))

function formatNumber(num) {
  num = num.replace(/\D/g, "")
  if (num.startsWith("20")) return num
  if (num.startsWith("0"))  return "20" + num.slice(1)
  if (num.length === 10)    return "20" + num
  return num
}

function humanDelay(min = 1500, max = 4000) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)))
}

function isIgnored(text) {
  if (!text) return true
  const cleaned = text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu, "").trim()
  if (!cleaned) return true
  const low = text.trim().toLowerCase()
  return ["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"].includes(low)
}

/* استقبال رسائل واتساب */
client.on("message", async msg => {
  if (msg.fromMe)                       return
  if (msg.from === "status@broadcast")  return
  if (msg.from.includes("@g.us"))       return
  if (isIgnored(msg.body))              return

  const phone = formatNumber(msg.from.replace("@c.us", ""))

  try {
    await humanDelay(2000, 4500)
    const res = await fetch(`${APP_URL}/api/ai/respond`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-api-key": AI_SECRET_KEY },
      body:    JSON.stringify({ branchId: BRANCH_ID, phone, message: msg.body })
    })
    if (!res.ok) { console.log("AI API error:", res.status); return }
    const { reply } = await res.json()
    if (reply) await msg.reply(reply)
  } catch (err) {
    console.log("WhatsApp message error:", err.message)
  }
})

/* إرسال رسالة نصية (تذكيرات وبرودكاست) */
app.post("/send-message", async (req, res) => {
  let { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" })
  phone = formatNumber(phone)
  try {
    await humanDelay(1500, 4000)
    await client.sendMessage(phone + "@c.us", message)
    console.log("Message sent to", phone)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* إرسال صورة/فاتورة */
app.post("/send-media", async (req, res) => {
  let { phone, mediaBase64, mimeType, caption } = req.body
  if (!phone || !mediaBase64) return res.status(400).json({ error: "phone and mediaBase64 required" })
  phone = formatNumber(phone)
  try {
    await humanDelay(1500, 4000)
    const base64Data = mediaBase64.replace(/^data:[^;]+;base64,/, "")
    const media = new MessageMedia(mimeType || "image/jpeg", base64Data, "invoice.jpg")
    await client.sendMessage(phone + "@c.us", media, { caption: caption || "" })
    console.log("Media sent to", phone)
    res.json({ success: true })
  } catch (err) {
    console.error("send-media error:", err.message)
    res.status(500).json({ error: err.message })
  }
})

/* استقبال ماسنجر */
app.post("/webhook", async (req, res) => {
  const body = req.body
  if (body.object !== "page") return res.sendStatus(200)

  for (const entry of body.entry) {
    const events = entry.messaging
    if (!events) continue
    for (const ev of events) {
      if (!ev.sender || !ev.message) continue
      const sender_psid = ev.sender.id
      const text = ev.message.text
      if (!text) continue
      try {
        const ai = await fetch(`${APP_URL}/api/ai/respond`, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "x-api-key": AI_SECRET_KEY },
          body:    JSON.stringify({ branchId: BRANCH_ID, phone: sender_psid, message: text })
        })
        const { reply } = await ai.json()
        if (!reply) continue
        await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${FB_PAGE_TOKEN}`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            messaging_type: "RESPONSE",
            recipient: { id: sender_psid },
            message:   { text: reply }
          })
        })
      } catch (err) {
        console.log("Messenger error:", err.message)
      }
    }
  }
  res.status(200).send("EVENT_RECEIVED")
})

/* صفحة QR */
app.get("/qr", (req, res) => {
  if (!currentQR) return res.send("<h2>QR لسه ما اتولدش</h2>")
  res.send(`<html><body style="text-align:center;padding:40px"><h2>Scan WhatsApp QR</h2><img src="${currentQR}" width="300"/></body></html>`)
})

app.get("/", (req, res) => res.send("WhatsApp bot is running"))
app.listen(process.env.PORT || 3000, () => console.log("Server running"))
client.initialize()
module.exports = { client }
