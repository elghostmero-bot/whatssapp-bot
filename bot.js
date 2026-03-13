const express = require("express")
const app = express()

app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const fs = require("fs")
const OpenAI = require("openai")

const salonData = fs.readFileSync("salon-data.txt","utf8")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "samia-bot" }),
  puppeteer:{
    headless:true,
    args:[
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
})

/* QR */
client.on("qr", qr=>{
  console.log("SCAN QR:")
  console.log("https://api.qrserver.com/v1/create-qr-code/?size=300x300&data="+qr)
})

client.on("authenticated",()=>console.log("WhatsApp authenticated"))
client.on("ready",()=>console.log("WhatsApp Bot Ready"))

/* helpers */

function getReplies(){
  try{
    return JSON.parse(fs.readFileSync("replies.json"))
  }catch{
    return []
  }
}

function formatNumber(num){

  num = num.replace(/\D/g,"")

  if(num.startsWith("20")) return num
  if(num.startsWith("0")) return "20"+num.slice(1)
  if(num.length===10) return "20"+num

  return num
}

function humanDelay(min=1500,max=4000){
  const ms = min + Math.random()*(max-min)
  return new Promise(r=>setTimeout(r,ms))
}

function normalizeText(text){
  text=text.toLowerCase()
  text=text.replace(/[أإآ]/g,"ا")
  text=text.replace(/ى/g,"ي")
  text=text.replace(/ة/g,"ه")
  text=text.replace(/[؟?!.,]/g,"")
  text=text.replace(/\bو([^\s]+)/g,"و $1")
  return text
}

function isEmojiOnly(text){
  const cleaned=text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu,'').trim()
  return cleaned.length===0
}

function isLowValueMessage(text){
  const msg=text.trim().toLowerCase()
  const ignore=["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"]
  return ignore.includes(msg)
}

let spamTracker={}

/* استقبال رسائل واتساب */

client.on("message", async message=>{

  if(!message.body) return
  if(message.from==="status@broadcast") return
  if(message.from.includes("@g.us")) return

  if(isEmojiOnly(message.body)){
    if(!spamTracker[message.from]) spamTracker[message.from]=0
    spamTracker[message.from]++
    return
  }

  if(isLowValueMessage(message.body)) return

  spamTracker[message.from]=0

  try{

    await humanDelay(2000,4500)

    const ai = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages:[
        {
          role:"system",
          content:`انت موظف خدمة عملاء لصالون تجميل.

هذه معلومات الصالون:

${salonData}

استخدم هذه المعلومات فقط للرد على العملاء.
لو السؤال خارج هذه المعلومات اطلب توضيح.
الرد يكون قصير وباللهجة المصرية.`
        },
        {
          role:"user",
          content:message.body
        }
      ]
    })

    const reply=ai.choices?.[0]?.message?.content

    if(reply){
      await message.reply(reply)
    }

  }catch(err){
    console.log("AI ERROR:",err.message)
  }

})

/* ارسال رسالة نصية */

app.post("/send-message", async(req,res)=>{

  let {phone,message}=req.body

  if(!phone || !message)
    return res.status(400).json({error:"phone and message required"})

  phone=formatNumber(phone)

  try{

    await humanDelay(1500,4000)

    await client.sendMessage(phone+"@c.us",message)

    console.log("Message sent to",phone)

    res.json({success:true})

  }catch(err){

    console.log("SEND MESSAGE ERROR:",err.message)

    res.status(500).json({error:err.message})
  }

})

/* ارسال صورة او ملف */

app.post("/send-media", async(req,res)=>{

  let {phone,mediaBase64,mimeType,caption}=req.body

  if(!phone || !mediaBase64)
    return res.status(400).json({error:"phone and mediaBase64 required"})

  phone=formatNumber(phone)

  try{

    await humanDelay(1500,4000)

    const base64Data=mediaBase64.replace(/^data:[^;]+;base64,/,"")

    const media=new MessageMedia(
      mimeType || "image/jpeg",
      base64Data,
      "media-file"
    )

    await client.sendMessage(phone+"@c.us",media,{
      caption:caption || ""
    })

    res.json({success:true})

  }catch(err){

    console.log("SEND MEDIA ERROR:",err.message)

    res.status(500).json({error:err.message})
  }

})

/* ارسال الفاتورة */

app.post("/send-invoice", async(req,res)=>{

  let {bride,groom,imageBase64}=req.body

  if(!imageBase64)
    return res.status(400).send("no image")

  bride=formatNumber(bride)
  groom=formatNumber(groom)

  try{

    const base64Data=imageBase64.replace(/^data:image\/\w+;base64,/,"")

    const media=new MessageMedia("image/jpeg",base64Data,"invoice.jpg")

    await client.sendMessage(bride+"@c.us",media,{
      caption:"دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄"
    })

    await client.sendMessage(groom+"@c.us",media,{
      caption:"دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄"
    })

    res.send("sent")

  }catch(err){

    console.log("INVOICE ERROR:",err)

    res.status(500).send("error")
  }

})

/* فحص السيرفر */

app.get("/",(req,res)=>{
  res.send("WhatsApp bot is running")
})

app.get("/health",(req,res)=>{
  res.json({status:"ok"})
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("Server running on port "+PORT)
})

client.initialize()

module.exports={client}
