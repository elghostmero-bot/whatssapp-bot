const express = require("express")
const app = express()

app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const fs = require("fs")
const OpenAI = require("openai")

const salonData = fs.readFileSync("salon-data.txt", "utf8")

console.log("OPENAI KEY:", process.env.OPENAI_API_KEY)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const client = new Client({
  authStrategy: new LocalAuth(),
  clientId: "samia-bot",
  puppeteer: {
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"]
  }
})

client.on("qr", qr => qrcode.generate(qr, { small: true }))
client.on("authenticated", () => console.log("WhatsApp authenticated and session saved"))
client.on("ready", () => console.log("WhatsApp Bot Ready"))

function getReplies() {
  try { return JSON.parse(fs.readFileSync("replies.json")) } catch { return [] }
}

function formatNumber(num) {
  num = num.replace(/\D/g, "")
  if (num.startsWith("0")) num = "20" + num.slice(1)
  return num
}

// تأخير عشوائي لمحاكاة السلوك البشري وتجنب الحظر
function humanDelay(minMs = 1500, maxMs = 4000) {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeText(text) {
  text = text.toLowerCase()
  text = text.replace(/[أإآ]/g, "ا")
  text = text.replace(/ى/g, "ي")
  text = text.replace(/ة/g, "ه")
  text = text.replace(/[؟?!.,]/g, "")
  text = text.replace(/\bو([^\s]+)/g, "و $1")
  return text
}

client.on("message", async message => {
  if(message.hasMedia){

const media = await message.downloadMedia()

if(media.mimetype.includes("audio")){

await message.reply(
"ممكن تبعتي السؤال كتابة علشان أقدر أرد بدقة؟ 🤍"
)

return

}

}
  if (!message.body) return
  if (message.from === "status@broadcast") return
  if (message.from.includes("@g.us")) return

  let msg = normalizeText(message.body)
  let words = msg.split(/\s+/)
  const replies = getReplies()
  let responses = []

  for (const item of replies) {
    let found = false
    for (const keyword of item.keywords) {
      let key = normalizeText(keyword)
      for (const word of words) {
        if (word.length < 2) continue
        let cleanWord = word.replace(/^و/, "").replace(/^ال/, "").replace(/(.)\1+$/, "$1")
        if (word === key || cleanWord === key || cleanWord.includes(key) || key.includes(cleanWord)) found = true
      }
    }
    if (found && !responses.includes(item.reply)) responses.push(item.reply)
  }

  try {
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `انت موظف خدمة عملاء لصالون تجميل.\n\nهذه معلومات الصالون:\n\n${salonData}\n\nاستخدم هذه المعلومات فقط للرد على العملاء.\nلو السؤال خارج هذه المعلومات اطلب توضيح.\nالرد يكون قصير وباللهجة المصرية.` },
        { role: "user", content: message.body }
      ]
    })
    const reply = ai.choices?.[0]?.message?.content
    if (reply) await message.reply(reply)
  } catch (err) {
    console.log("AI ERROR:", err.message)
  }

  let data = []
  try { data = JSON.parse(fs.readFileSync("unknown.json")) } catch { data = [] }
  data.push({ msg: message.body, date: new Date().toISOString() })
  fs.writeFileSync("unknown.json", JSON.stringify(data, null, 2))
})

// ── إرسال الفواتير ──
app.post("/send-invoice", async (req, res) => {
  console.log("REQ BODY:", req.body)
  let { bride, groom, imageBase64 } = req.body
  if (!imageBase64) { console.log("NO IMAGE RECEIVED"); return res.status(400).send("no image") }
  bride = formatNumber(bride)
  groom = formatNumber(groom)
  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "")
    const media = new MessageMedia("image/jpeg", base64Data, "invoice.jpg")
    await client.sendMessage(bride + "@c.us", media, { caption: "دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄" })
    await client.sendMessage(groom + "@c.us", media, { caption: "دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄" })
    res.send("sent")
  } catch (err) { console.log(err); res.status(500).send("error") }
})
// ── إرسال صورة أو ملف مع caption ──
app.post("/send-media", async (req, res) => {
  let { phone, mediaBase64, mimeType, caption } = req.body
  if (!phone || !mediaBase64) return res.status(400).json({ error: "phone and mediaBase64 required" })
  phone = formatNumber(phone)
  try {
    await humanDelay(1500, 4000)
    const base64Data = mediaBase64.replace(/^data:[^;]+;base64,/, "")
    const media = new MessageMedia(mimeType || "image/jpeg", base64Data, "media-file")
    await client.sendMessage(phone + "@c.us", media, { caption: caption || "" })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
// ── إرسال رسالة نصية (للتذكيرات والبرودكاست) ──
app.post("/send-message", async (req, res) => {
  let { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" })
  phone = formatNumber(phone)
  try {
    await humanDelay(1500, 4000)  // تأخير لمحاكاة سلوك بشري
    await client.sendMessage(phone + "@c.us", message)
    console.log("Message sent to", phone)
    res.json({ success: true })
  } catch (err) {
    console.error("send-message error:", err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get("/", (req, res) => res.send("WhatsApp bot is running"))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on port " + PORT))
client.initialize()
module.exports = { client }


