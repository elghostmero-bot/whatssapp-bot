const FB_PAGE_TOKEN = "EAA49g0ZBaS9QBQzz3ZCrH07U5BtZBLF053ZCG55UoXVekIwDKqPnZCgJogt53msJxPOcqWHRDiZBzbyehgQmlHkZBxibBOXqT1l2IZBKcCbptFYK1P46KRYXvuGefHYW67Onq8NSom1b5Pesm5TQ7ewd7aPVgMQ7Xd6UD4ZBfZCgLIunMMqvLWOQmXBd11XoPZCIxtwxIS6GKU1MpWAJAlRo4cqQ5Y4mgZDZD"
const IG_PAGE_TOKEN = "EAA49g0ZBaS9QBQ85J5oO2C4qZBJyMzdjRPXGDwtNZB3ZBXR24ovxUGbq15ZBoRiiaxvsPTogZA5SJywx5EyT9UFc22FjmfbhAqoNRNbJMAb8hbQhTZCSZAnZCvdDZAQ40uJMeG6BVapmEQGZAxfVcaeqrNh1xcavgZAiEBHjT0hPCKsZCP7GmUszfrNilrjMVduGazXZBam7Hg0C7OZAg7gjNpfjhJRwIvNPwZDZD"

const express = require("express")
const app = express()
app.use(express.json({ limit: "20mb" }))

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

const { Client, LocalAuth } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const QRCode = require("qrcode")

const APP_URL       = process.env.APP_URL
const AI_SECRET_KEY = process.env.AI_SECRET_KEY
const BRANCH_ID     = Number(process.env.BRANCH_ID || 1)

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

/* استقبال رسائل واتساب */

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
    console.log("ERROR:",err.message)
  }

})

/* ارسال رسالة واتساب من التطبيق */

/* استقبال رسائل ماسنجر و انستجرام */

app.post("/webhook",async(req,res)=>{

  console.log("BODY:",JSON.stringify(req.body,null,2))

  const body=req.body

  if(body.object!=="page"&&body.object!=="instagram"){
    return res.sendStatus(200)
  }

  for(const entry of body.entry){

    const events=entry.messaging||entry.changes

    if(!events) continue

    for(const ev of events){

      let sender_psid=null
      let text=null
      let platform="facebook"

      if(ev.sender&&ev.message){
        sender_psid=ev.sender.id
        text=ev.message.text
        platform="facebook"
      }

      if(ev.value && ev.value.messages){
        console.log("INSTAGRAM EVENT:", JSON.stringify(ev,null,2))
        sender_psid = ev.value.messages[0].from.id
        text = ev.value.messages[0].text || ev.value.messages[0].message
        platform="instagram"
      }

      if(!sender_psid||!text) continue

      console.log("MESSAGE FROM:",sender_psid)
      console.log("TEXT:",text)

      try{

        const response=await fetch(`${APP_URL}/api/ai/respond`,{
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

        if(!response.ok){
          console.log("AI error:",response.status)
          continue
        }

        const {reply}=await response.json()

        if(reply){

          const token = platform === "instagram"
            ? IG_PAGE_TOKEN
            : FB_PAGE_TOKEN

          await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,{
            method:"POST",
            headers:{
              "Content-Type":"application/json"
            },
            body:JSON.stringify({
              messaging_type:"RESPONSE",
              recipient:{id:sender_psid},
              message:{text:reply}
            })
          })

        }

      }catch(err){

        console.log("Webhook error:",err.message)

      }

    }

  }

  res.status(200).send("EVENT_RECEIVED")

})
/* استقبال رسائل ماسنجر و انستجرام */

app.post("/webhook",async(req,res)=>{

  console.log("BODY:",JSON.stringify(req.body,null,2))

  const body=req.body

  if(body.object!=="page"&&body.object!=="instagram"){
    return res.sendStatus(200)
  }

  for(const entry of body.entry){

    const events=entry.messaging||entry.changes

    if(!events) continue

    for(const ev of events){

      let sender_psid=null
      let text=null

      if(ev.sender&&ev.message){
        sender_psid=ev.sender.id
        text=ev.message.text
      }

      if(ev.value && ev.value.messages){
        console.log("INSTAGRAM EVENT:", JSON.stringify(ev,null,2))
  sender_psid = ev.value.messages[0].from.id
  text = ev.value.messages[0].text || ev.value.messages[0].message
}

      if(!sender_psid||!text) continue

      console.log("MESSAGE FROM:",sender_psid)
      console.log("TEXT:",text)

      try{

        const response=await fetch(`${APP_URL}/api/ai/respond`,{
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

        if(!response.ok){
          console.log("AI error:",response.status)
          continue
        }

        const {reply}=await response.json()

        if(reply){

          await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,{
            method:"POST",
            headers:{
              "Content-Type":"application/json"
            },
            body:JSON.stringify({
              recipient:{id:sender_psid},
              message:{text:reply}
            })
          })

        }

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
