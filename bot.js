
const express = require("express")
const app = express()
app.use(express.json({ limit: "20mb" }))

const fs = require("fs")
const FormData = require("form-data")

const { Client, LocalAuth } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const QRCode = require("qrcode")

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args))

const APP_URL = process.env.APP_URL
const AI_SECRET_KEY = process.env.AI_SECRET_KEY
const BRANCH_ID = Number(process.env.BRANCH_ID || 1)

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN
const IG_PAGE_TOKEN = process.env.IG_PAGE_TOKEN

let currentQR = null

/* واتساب */

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "samia-bot" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
})

client.on("qr", async qr => {
  qrcode.generate(qr, { small: true })
  currentQR = await QRCode.toDataURL(qr)
  console.log("QR ready at /qr")
})

client.on("authenticated", () => console.log("WhatsApp authenticated"))
client.on("ready", () => console.log("WhatsApp Bot Ready"))

function formatNumber(num){
  num = num.replace(/\D/g,"")
  if(num.startsWith("20")) return num
  if(num.startsWith("0")) return "20"+num.slice(1)
  if(num.length === 10) return "20"+num
  return num
}

function humanDelay(min=1500,max=4000){
  return new Promise(r => setTimeout(r,min+Math.random()*(max-min)))
}

function isIgnored(text){
  if(!text) return true
  const cleaned = text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu,"").trim()
  if(!cleaned) return true
  const low = text.trim().toLowerCase()
  return ["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"].includes(low)
}

/* استقبال واتساب */

client.on("message", async msg => {

  if(msg.fromMe) return
  if(msg.from === "status@broadcast") return
  if(msg.from.includes("@g.us")) return

  let text = msg.body

  /* تحويل الصوت لنص */

  if (msg.type === "ptt" || msg.type === "audio") {

    try {

      console.log("VOICE MESSAGE RECEIVED")

      const media = await msg.downloadMedia()
      if(!media) return

      const buffer = Buffer.from(media.data, "base64")
      fs.writeFileSync("voice.ogg", buffer)

      console.log("VOICE SAVED")

      const form = new FormData()
      form.append("file", fs.createReadStream("voice.ogg"))
      form.append("model","whisper-1")

      const whisper = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method:"POST",
          headers:{
            Authorization:`Bearer ${process.env.OPENAI_API_KEY}`
          },
          body:form
        }
      )

      const data = await whisper.json()

      text = data.text || ""

      console.log("VOICE TEXT:",text)

    }catch(err){

      console.log("VOICE ERROR:",err.message)
      return

    }

  }

  if(isIgnored(text)) return

  const phone = formatNumber(msg.from.replace("@c.us",""))

  try{

    await humanDelay(2000,4500)

    const res = await fetch(`${APP_URL}/api/ai/respond`,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-api-key":AI_SECRET_KEY
      },
      body:JSON.stringify({
        branchId:BRANCH_ID,
        phone,
        message:text
      })
    })

    if(!res.ok){
      console.log("AI API error:",res.status)
      return
    }

    const {reply} = await res.json()

    if(reply){
      await msg.reply(reply)
    }

  }catch(err){

    console.log("WhatsApp error:",err.message)

  }

})

/* VERIFY WEBHOOK */

app.get("/webhook",(req,res)=>{

  const VERIFY_TOKEN="samia_bot_verify"

  const mode=req.query["hub.mode"]
  const token=req.query["hub.verify_token"]
  const challenge=req.query["hub.challenge"]

  if(mode==="subscribe" && token===VERIFY_TOKEN){
    console.log("WEBHOOK VERIFIED")
    res.status(200).send(challenge)
  }else{
    res.sendStatus(403)
  }

})

/* استقبال ماسنجر */

app.post("/webhook",async(req,res)=>{

  const body=req.body

  if(body.object!=="page") return res.sendStatus(200)

  for(const entry of body.entry){

    const events = entry.messaging
    if(!events) continue

    for(const ev of events){

      if(!ev.sender || !ev.message) continue

      const sender_psid = ev.sender.id
      const text = ev.message.text

      if(!text) continue

      try{

        const ai = await fetch(`${APP_URL}/api/ai/respond`,{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "x-api-key":AI_SECRET_KEY
          },
          body:JSON.stringify({
            branchId:BRANCH_ID,
            phone:sender_psid,
            message:text
          })
        })

        const {reply} = await ai.json()

        if(!reply) continue

        await fetch(
          `https://graph.facebook.com/v18.0/me/messages?access_token=${FB_PAGE_TOKEN}`,
          {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body:JSON.stringify({
              messaging_type:"RESPONSE",
              recipient:{ id: sender_psid },
              message:{ text: reply }
            })
          }
        )

      }catch(err){

        console.log("Messenger error:",err.message)

      }

    }

  }

  res.status(200).send("EVENT_RECEIVED")

})

/* صفحة QR */

app.get("/qr",(req,res)=>{

  if(!currentQR){
    return res.send("<h2>No QR yet</h2>")
  }

  res.send(`
  <html>
  <body style="text-align:center;padding:40px">
  <h2>Scan WhatsApp QR</h2>
  <img src="${currentQR}" width="300"/>
  </body>
  </html>
  `)

})

app.listen(process.env.PORT||3000,()=>console.log("Server running"))

client.initialize()

module.exports={client}
