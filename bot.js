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

function isIgnoredText(text) {
  if (!text) return true
  const cleaned = text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu, "").trim()
  if (!cleaned) return true
  const low = text.trim().toLowerCase()
  return ["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"].includes(low)
}

/* جلب إعدادات البوت من السيرفر */
async function getBotSettings() {
  try {
    const res = await fetch(`${APP_URL}/api/branches/${BRANCH_ID}/bot-settings`, {
      headers: { "x-api-key": AI_SECRET_KEY },
    })
    if (!res.ok) return { botActive: true, voiceReply: false }
    return await res.json()
  } catch (err) {
    console.error("getBotSettings error:", err.message)
    return { botActive: true, voiceReply: false }
  }
}

/* تحويل الصوت لنص باستخدام Whisper */
async function transcribeAudio(audioBase64, mimeType) {
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64")
    const ext = mimeType?.includes("ogg") ? "ogg" : mimeType?.includes("mp4") ? "mp4" : "ogg"
    const { toFile } = require("openai")
    const audioFile = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType || "audio/ogg" })
    const transcription = await openai.audio.transcriptions.create({
      file:     audioFile,
      model:    "whisper-1",
      language: "ar",
      prompt:   "صالون تجميل، حجز، ميكب، تسريحة، عروسة، حمام مغربي، كيراتين، مانيكير، باديكير، سعر، موعد، فرع، خدمة، بشرة، بروتين، بليتش، هايلايت، سواريه، خطوبة، زفاف، حنة، فستان، إكسسوار، تسريحة عروسة، مكياج سواريه",
    })
    return transcription.text || null
  } catch (err) {
    console.error("Whisper transcription error:", err.message)
    return null
  }
}

/* إرسال الرسالة للـ AI وجلب الرد */
async function getAIReply({ phone, message, imageBase64, messageType }) {
  try {
    const res = await fetch(`${APP_URL}/api/ai/respond`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-api-key": AI_SECRET_KEY },
      body:    JSON.stringify({ branchId: BRANCH_ID, phone, message, imageBase64, messageType }),
    })
    if (!res.ok) {
      console.log("AI API error:", res.status, await res.text())
      return null
    }
    const { reply } = await res.json()
    return reply || null
  } catch (err) {
    console.error("AI fetch error:", err.message)
    return null
  }
}

/* تنظيف النص من التنسيق قبل إرساله للـ TTS */
function cleanTextForTTS(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")   // إزالة bold **نص**
    .replace(/\*(.+?)\*/g, "$1")        // إزالة italic *نص*
    .replace(/_{1,2}(.+?)_{1,2}/g, "$1") // إزالة _نص_
    .replace(/#+\s*/g, "")              // إزالة عناوين markdown #
    .replace(/^\s*[-•*]\s+/gm, "")      // إزالة bullet points في بداية السطر
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // إزالة روابط [نص](url)
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // إزالة code blocks
    .replace(/\n{3,}/g, "\n\n")         // تقليل الأسطر الفاضية المتكررة
    .replace(/\n/g, "، ")               // تحويل الأسطر لفاصل منطوق
    .replace(/،\s*،/g, "،")             // تنظيف الفواصل المتكررة
    .trim()
}

/* تحويل الأرقام والنص لنطق صوتي عربي طبيعي مع تشكيل كامل */
async function prepareTextForTTS(text) {
  const cleaned = cleanTextForTTS(text)
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `أنت متخصص في تحويل النصوص المكتوبة لنطق صوتي عربي طبيعي وسلس تمامًا.
مهامك بالترتيب:
1. حوّل كل الأرقام لكلمات عربية منطوقة: 3500 → ثَلاثَةُ آلافٍ وَخَمْسُمِئَةٍ، 10:30 → الْعَاشِرَةُ وَالنِّصْفُ، 2 → اثْنَيْنِ
2. احذف أي رموز أو تنسيق متبقٍّ مثل النجمات والشرطات والأقواس
3. اجعل النص يُقرأ بشكل محادثة طبيعية مريحة — لا قوائم ولا نقاط
4. أضِف تشكيلاً كاملاً ودقيقاً على كل كلمة عربية في النص (فتحة، ضمة، كسرة، سكون، شدة، تنوين) حتى يُنطق الصوت بشكل صحيح وواضح
5. احتفظ بكل المعلومات والمعنى كاملاً
6. أرجع النص النهائي المشكَّل فقط بدون أي تعليق أو مقدمة`
        },
        { role: "user", content: cleaned }
      ],
      max_tokens: 1200,
      temperature: 0.1,
    })
    return completion.choices?.[0]?.message?.content || cleaned
  } catch (err) {
    console.error("prepareTextForTTS error:", err.message)
    return cleaned
  }
}

/* تحويل النص لصوت OGG عالي الجودة باستخدام OpenAI TTS */
async function textToVoiceBase64(text) {
  try {
    const ttsText = await prepareTextForTTS(text)
    const response = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "shimmer",
      input: ttsText,
      response_format: "opus",
      speed: 1.15,
    })
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.toString("base64")
  } catch (err) {
    console.error("TTS error:", err.message)
    return null
  }
}

/* استقبال رسائل واتساب */
client.on("message", async msg => {
  if (msg.fromMe)                      return
  if (msg.from === "status@broadcast") return
  if (msg.from.includes("@g.us"))      return

  const phone = formatNumber(msg.from.replace("@c.us", ""))

  await humanDelay(2000, 4500)

  /* رسالة نصية */
  if (msg.type === "chat") {
    if (isIgnoredText(msg.body)) return
    const reply = await getAIReply({ phone, message: msg.body, messageType: "text" })
    if (reply) await msg.reply(reply)
    return
  }

  /* رسالة صوتية (voice note أو audio) */
  if (msg.type === "ptt" || msg.type === "audio") {
    try {
      console.log(`Voice message from ${phone}`)
      const media = await msg.downloadMedia()
      if (!media?.data) return

      const transcribed = await transcribeAudio(media.data, media.mimetype)
      if (!transcribed) {
        await msg.reply("عذراً، مقدرتش أسمع الرسالة الصوتية. ممكن تكتبيلي؟ 😊")
        return
      }
      console.log(`Transcribed: ${transcribed}`)

      const reply = await getAIReply({ phone, message: transcribed, messageType: "audio" })
      if (!reply) return

      // جلب إعداد الرد الصوتي
      const settings = await getBotSettings()
      if (settings.voiceReply) {
        console.log("Sending voice reply...")
        const oggBase64 = await textToVoiceBase64(reply)
        if (oggBase64) {
          const voiceMedia = new MessageMedia("audio/ogg; codecs=opus", oggBase64, "reply.ogg")
          await client.sendMessage(msg.from, voiceMedia, { sendAudioAsVoice: true })
          return
        }
        console.log("Voice conversion failed, falling back to text")
      }

      await msg.reply(reply)
    } catch (err) {
      console.error("Voice message error:", err.message)
    }
    return
  }

  /* رسالة صورة */
  if (msg.type === "image") {
    try {
      console.log(`Image message from ${phone}`)
      const media = await msg.downloadMedia()
      if (!media?.data) return

      const caption = msg.body || ""
      const reply = await getAIReply({
        phone,
        message:     caption,
        imageBase64: media.data,
        messageType: "image",
      })
      if (reply) await msg.reply(reply)
    } catch (err) {
      console.error("Image message error:", err.message)
    }
    return
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
        const reply = await getAIReply({ phone: sender_psid, message: text, messageType: "text" })
        if (!reply) continue
        await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${FB_PAGE_TOKEN}`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            messaging_type: "RESPONSE",
            recipient: { id: sender_psid },
            message:   { text: reply },
          }),
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

app.get("/", (req, res) => res.send("WhatsApp bot is running — v8 (whisper prompt + normal speed)"))
app.listen(process.env.PORT || 3000, () => console.log("Server running"))
client.initialize()
module.exports = { client }
