const express = require("express")
const app = express()

app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth, MessageMedia } = require("whatssapp-web.js")
const qrcode = require("qrcode-terminal")
const fs = require("fs")
const OpenAI = require("openai")

const salonData = fs.readFileSync("salon-data.txt", "utf8")

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
client.on("authenticated", () => console.log("WhatsApp authenticated"))
client.on("ready", () => console.log("WhatsApp Bot Ready"))

let spamTracker = {}

function getReplies() {
  try { return JSON.parse(fs.readFileSync("replies.json")) } catch { return [] }
}

function formatNumber(num) {
  num = num.replace(/\D/g, "")
  if (num.startsWith("0")) num = "20" + num.slice(1)
  return num
}

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

function isEmojiOnly(text){
  const cleaned = text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu,'').trim()
  return cleaned.length === 0
}

function isLowValueMessage(text){
  const msg = text.trim().toLowerCase()
  const ignoreList = ["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"]
  return ignoreList.includes(msg)
}

client.on("message", async message => {

  if (!message.body) return
  if (message.from === "status@broadcast") return
  if (message.from.includes("@g.us")) return

  if(isEmojiOnly(message.body)){
    if(!spamTracker[message.from]) spamTracker[message.from] = 0
    spamTracker[message.from]++
    if(spamTracker[message.from] >= 3){
      console.log("Spam ignored:", message.from)
    }
    return
  }

  if(isLowValueMessage(message.body)) return

  spamTracker[message.from] = 0

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

    await humanDelay(2000,4500)

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `انت موظف خدمة عملاء لصالون تجميل.

هذه معلومات الصالون:

${salonData}

استخدم هذه المعلومات فقط للرد على العملاء.
لو السؤال خارج هذه المعلومات اطلب توضيح.
الرد يكون قصير وباللهجة المصرية.`
        },
        {
          role: "user",
          content: message.body
        }
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

app.post("/send-invoice", async (req, res) => {

  let { bride, groom, imageBase64 } = req.body

  if (!imageBase64) return res.status(400).send("no image")

  bride = formatNumber(bride)
  groom = formatNumber(groom)

  try {

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "")
    const media = new MessageMedia("image/jpeg", base64Data, "invoice.jpg")

    await client.sendMessage(bride + "@c.us", media, {
      caption: "دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄"
    })

    await client.sendMessage(groom + "@c.us", media, {
      caption: "دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄"
    })

    res.send("sent")

  } catch (err) {
    console.log(err)
    res.status(500).send("error")
  }

})

app.get("/", (req, res) => res.send("WhatsApp bot is running"))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Server running on port " + PORT))

client.initialize()

module.exports = { client }





