require('dotenv').config()
const express = require("express")
const app = express()
app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")

// ← متغيرات البيئة الجديدة في Railway
const APP_URL       = process.env.APP_URL         https://samiamakeupartist.replit.app/
const AI_SECRET_KEY = process.env.AI_SECRET_KEY   cinderella-bot-api-2026
const BRANCH_ID     = Number(process.env.BRANCH_ID || 1)
const ADMIN_NUMBER  = "201098266665@c.us"

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "samia-bot" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"]
  }
})

client.on("qr", qr => qrcode.generate(qr, { small: true }))
client.on("authenticated", () => console.log("WhatsApp authenticated"))
client.on("ready",        () => console.log("WhatsApp Bot Ready"))

function formatNumber(num){
  num = num.replace(/\D/g,"")
  if(num.startsWith("20"))  return num
  if(num.startsWith("0"))   return "20"+num.slice(1)
  if(num.length === 10)     return "20"+num
  return num
}

function humanDelay(min=1500, max=4000){
  return new Promise(r => setTimeout(r, min + Math.random()*(max-min)))
}

function isIgnored(text){
  if(!text) return true
  const cleaned = text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu,"").trim()
  if(!cleaned) return true
  const low = text.trim().toLowerCase()
  return ["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"].includes(low)
}

/* استقبال رسائل العملاء */
client.on("message", async msg => {
  if(msg.fromMe)                         return
  if(msg.from === "status@broadcast")    return
  if(msg.from.includes("@g.us"))         return
  if(isIgnored(msg.body))                return

  const phone = formatNumber(msg.from.replace("@c.us",""))

  try{
    await humanDelay(2000, 4500)

    // ← هنا بيسأل تطبيقك بدل الملف الثابت
    const res = await fetch(`${APP_URL}/api/ai/respond`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key":    AI_SECRET_KEY
      },
      body: JSON.stringify({ branchId: BRANCH_ID, phone, message: msg.body })
    })

    if(!res.ok){
      console.log("AI API error:", res.status, await res.text())
      return
    }

    const { reply } = await res.json()
    if(reply) await msg.reply(reply)

  }catch(err){
    console.log("ERROR:", err.message)
  }
})

/* إرسال رسالة من التطبيق */
app.post("/send-message", async(req,res)=>{
  let { phone, message } = req.body
  if(!phone || !message) return res.status(400).json({error:"phone and message required"})
  phone = formatNumber(phone)
  try{
    await humanDelay(1500, 4000)
    await client.sendMessage(phone+"@c.us", message)
    res.json({success:true})
  }catch(err){
    res.status(500).json({error: err.message})
  }
})

app.get("/", (req,res) => res.send("WhatsApp bot is running"))
app.listen(process.env.PORT || 3000, () => console.log("Server running"))
client.initialize()
module.exports = {client}
