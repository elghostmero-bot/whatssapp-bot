const express = require("express")
const app = express()
app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const OpenAI = require("openai")

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN
const APP_URL       = process.env.APP_URL
const AI_SECRET_KEY = process.env.AI_SECRET_KEY
const BRANCH_ID     = Number(process.env.BRANCH_ID || 1)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

function isIgnoredText(text) {
  if (!text) return true
  const cleaned = text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu, "").trim()
  if (!cleaned) return true
  const low = text.trim().toLowerCase()
  return ["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"].includes(low)
}

async function transcribeAudio(audioBase64, mimeType) {
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64")
    const ext = mimeType?.includes("ogg") ? "ogg" : mimeType?.includes("mp4") ? "mp4" : "ogg"
    const { toFile } = require("openai")
    const audioFile = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType || "audio/ogg" })
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile, model: "whisper-1", language: "ar",
    })
    return transcription.text || null
  } catch (err) {
    console.error("Whisper error:", err.message)
    return null
  }
}

async function getAIReply({ phone, message, imageBase64, messageType }) {
  try {
    const res = await fetch(`${APP_URL}/api/ai/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": AI_SECRET_KEY },
      body: JSON.stringify({ branchId: BRANCH_ID, phone, message, imageBase64, messageType }),
    })
    if (!res.ok) return null
    const { reply } = await res.json()
    return reply || null
  } catch (err) {
    console.error("AI fetch error:", err.message)
    return null
  }
}

client.on("message", async msg => {
  if (msg.fromMe) return
  if (msg.from === "status@broadcast") return
  if (msg.from.includes("@g.us")) return

  const phone = formatNumber(msg.from.replace("@c.us", ""))
  await humanDelay(2000, 4500)

  if (msg.type === "chat") {
    if (isIgnoredText(msg.body)) return
    const reply = await getAIReply({ phone, message: msg.body, messageType: "text" })
    if (reply) await msg.reply(reply)
    return
  }

  if (msg.type === "ptt" || msg.type === "audio") {
    try {
      const media = await msg.downloadMedia()
      if (!media?.data) return
      const transcribed = await transcribeAudio(media.data, media.mimetype)
      if (!transcribed) {
        await msg.reply("عذراً، مقدرتش أسمع الرسالة. ممكن تكتبيلي؟ 😊")
        return
      }
      const reply = await getAIReply({ phone, message: transcribed, messageType: "audio" })
      if (reply) await msg.reply(reply)
    } catch (err) { console.error("Voice error:", err.message) }
    return
  }

  if (msg.type === "image") {
    try {
      const media = await msg.downloadMedia()
      if (!media?.data) return
      const reply = await getAIReply({ phone, message: msg.body || "", imageBase64: media.data, messageType: "image" })
      if (reply) await msg.reply(reply)
    } catch (err) { console.error("Image error:", err.message) }
    return
  }
})

app.post("/send-message", async (req, res) => {
  let { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" })
  phone = formatNumber(phone)
  try {
    await humanDelay(1500, 4000)
    await client.sendMessage(phone + "@c.us", message)
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/send-media", async (req, res) => {
  let { phone, mediaBase64, mimeType, caption } = req.body
  if (!phone || !mediaBase64) return res.status(400).json({ error: "phone and mediaBase64 required" })
  phone = formatNumber(phone)
  try {
    await humanDelay(1500, 4000)
    const base64Data = mediaBase64.replace(/^data:[^;]+;base64,/, "")
    const media = new MessageMedia(mimeType || "image/jpeg", base64Data, "invoice.jpg")
    await client.sendMessage(phone + "@c.us", media, { caption: caption || "" })
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/webhook", async (req, res) => {
  const body = req.body
  if (body.object !== "page") return res.sendStatus(200)
  for (const entry of body.entry) {
    const events = entry.messaging
    if (!events) continue
    for (const ev of events) {
      if (!ev.sender || !ev.message?.text) continue
      try {
        const reply = await getAIReply({ phone: ev.sender.id, message: ev.message.text, messageType: "text" })
        if (!reply) continue
        await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${FB_PAGE_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_type: "RESPONSE", recipient: { id: ev.sender.id }, message: { text: reply } }),
        })
      } catch (err) { console.log("Messenger error:", err.message) }
    }
  }
  res.status(200).send("EVENT_RECEIVED")
})

app.get("/qr", (req, res) => {
  if (!currentQR) return res.send("<h2>QR لسه ما اتولدش</h2>")
  res.send(`<html><body style="text-align:center;padding:40px"><h2>Scan WhatsApp QR</h2><img src="${currentQR}" width="300"/></body></html>`)
})

app.get("/", (req, res) => res.send("WhatsApp bot v2 - voice + image"))
app.listen(process.env.PORT || 3000, () => console.log("Server running"))
client.initialize()
module.exports = { client }
