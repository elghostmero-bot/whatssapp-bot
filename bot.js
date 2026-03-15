const FB_PAGE_TOKEN = "EAA49g0ZBaS9QBQzE5IedQ0gJRXkEd0iEWVPWrHNwHfgeKyBuPgPcap25PAFmwGQ4oitlATDOmZA2Ult9baZC20dbauaXJPZAPvh30vNQRE4WWXcCIxhY6o28ryKTZAtD1h25Rk2Tg6fSjd1IFKLGQIbHsVnhWmlJDGuJZCQkB6Ot1WP4tv4ZB7UTDoDtnvXOMhKAmKyYMVqJthLomiJnqwBmf2enAZDZD"
const IG_PAGE_TOKEN = "EAA49g0ZBaS9QBQzE5IedQ0gJRXkEd0iEWVPWrHNwHfgeKyBuPgPcap25PAFmwGQ4oitlATDOmZA2Ult9baZC20dbauaXJPZAPvh30vNQRE4WWXcCIxhY6o28ryKTZAtD1h25Rk2Tg6fSjd1IFKLGQIbHsVnhWmlJDGuJZCQkB6Ot1WP4tv4ZB7UTDoDtnvXOMhKAmKyYMVqJthLomiJnqwBmf2enAZDZD"

const express = require("express")
const app = express()
app.use(express.json({ limit: "20mb" }))

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

const { Client, LocalAuth } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const QRCode = require("qrcode")

const APP_URL = process.env.APP_URL
const AI_SECRET_KEY = process.env.AI_SECRET_KEY
const BRANCH_ID = Number(process.env.BRANCH_ID || 1)

let currentQR = null

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

/* واتساب */

client.on("message", async msg => {

  if(msg.fromMe) return
  if(msg.from === "status@broadcast") return
  if(msg.from.includes("@g.us")) return
  if(isIgnored(msg.body)) return

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
        message:msg.body
      })
    })

    if(!res.ok){
      console.log("AI API error:",res.status)
      return
    }

    const {reply} = await res.json()

    if(reply) await msg.reply(reply)

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

/* استقبال ماسنجر + انستجرام */

app.post("/webhook",async(req,res)=>{

  const body=req.body
  console.log("BODY:",JSON.stringify(body,null,2))

  if(body.object!=="page" && body.object!=="instagram"){
    return res.sendStatus(200)
  }

  for(const entry of body.entry){
/* Facebook comments */

if(entry.changes){

  for(const change of entry.changes){

    if(change.field === "feed" && change.value.comment_id){

  const comment = change.value.message
  const comment_id = change.value.comment_id

  console.log("NEW COMMENT:", comment)

  try{

    const reply = await fetch(
      `https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${FB_PAGE_TOKEN}`,
      {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          message:"أهلاً ❤️ ابعتلنا رسالة ماسنجر وهنبعتلك التفاصيل."
        })
      }
    )

    const result = await reply.text()
    console.log("COMMENT REPLY:", result)

  }catch(err){
    console.log("COMMENT ERROR:",err.message)
  }

}
    }

  }
    const events = entry.messaging || entry.changes || entry.standby
    if(!events) continue

    for(const ev of events){

      let sender_psid=null
      let text=null
      let platform="facebook"

      /* Messenger */

      if(ev.sender && ev.message){
        sender_psid = ev.sender.id
        text = ev.message.text
        platform="facebook"
      }

      /* Instagram */

      if(ev.value && ev.value.messages){
        sender_psid = ev.value.messages[0].from.id
        text = ev.value.messages[0].text
        platform="instagram"
      }
      if(ev.message && ev.sender){
  sender_psid = ev.sender.id
  text = ev.message.text
  platform = "instagram"
}

      if(!sender_psid || !text) continue

      console.log("PLATFORM:",platform)
      console.log("USER:",sender_psid)
      console.log("TEXT:",text)

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

        if(!ai.ok){
          console.log("AI error:",ai.status)
          continue
        }

        const {reply}=await ai.json()

        if(!reply) continue

        const token = platform==="instagram"
          ? IG_PAGE_TOKEN
          : FB_PAGE_TOKEN

        const send = await fetch(
          `https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,
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

        const result = await send.text()
        console.log("SEND RESULT:",result)

      }catch(err){
        console.log("Webhook error:",err.message)
      }

    }

  }

  res.status(200).send("EVENT_RECEIVED")

})

app.listen(process.env.PORT||3000,()=>console.log("Server running"))

client.initialize()

module.exports={client}
