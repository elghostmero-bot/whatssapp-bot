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

/* ضع رقمك هنا */
const ADMIN_NUMBER = "201098266665@c.us"

/* وضع التدريب */
let trainingMode = false
let trainingEnd = 0
let lastQuestion = null

/* QR */
client.on("qr", qr => qrcode.generate(qr, { small: true }))

client.on("authenticated",()=>console.log("WhatsApp authenticated"))
client.on("ready",()=>console.log("WhatsApp Bot Ready"))

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

function isEmojiOnly(text){
  const cleaned=text.replace(/[\p{Emoji}\u200d\u2640-\u2642\uFE0F]/gu,'').trim()
  return cleaned.length===0
}

function isLowValueMessage(text){
  const msg=text.trim().toLowerCase()
  const ignore=["ok","okay","تمام","تم","شكرا","شكراً","thanks","thx","👍","👌"]
  return ignore.includes(msg)
}

function loadMemory(){
  try{
    return JSON.parse(fs.readFileSync("ai-memory.json"))
  }catch{
    return []
  }
}

function saveMemory(question,answer){
  let memory = loadMemory()
  memory.push({
    question:question,
    answer:answer
  })
  fs.writeFileSync("ai-memory.json",JSON.stringify(memory,null,2))
}

/* فحص هل السؤال موجود بالفعل */
function questionExists(question){

  const q = question.toLowerCase()

  if(salonData.toLowerCase().includes(q)) return true

  const memory = loadMemory()

  for(const item of memory){
    if(item.question.toLowerCase().includes(q) || q.includes(item.question.toLowerCase())){
      return true
    }
  }

  return false
}

/* استقبال الرسائل */

client.on("message", async message=>{

  if(!message.body) return
  if(message.from==="status@broadcast") return
  if(message.from.includes("@g.us")) return

  /* تشغيل التدريب */
  if(message.from === ADMIN_NUMBER && message.body.startsWith("تدريب")){

    const minutes = parseInt(message.body.split(" ")[1]) || 30

    trainingMode = true
    trainingEnd = Date.now() + minutes*60000

    await client.sendMessage(
      ADMIN_NUMBER,
      "تم تشغيل وضع التدريب لمدة "+minutes+" دقيقة"
    )

    return
  }

  /* التعلم من ردك */
  if(message.fromMe && lastQuestion){

    saveMemory(lastQuestion,message.body)

    console.log("Learned new reply")

    lastQuestion = null
    return
  }

  if(isEmojiOnly(message.body)) return
  if(isLowValueMessage(message.body)) return

  try{

    await humanDelay(2000,4500)

    let memory = loadMemory()

    let memoryText = memory
      .map(x=>"سؤال: "+x.question+"\nالرد: "+x.answer)
      .join("\n\n")

    const ai = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages:[
        {
          role:"system",
          content:`انت موظف خدمة عملاء لصالون تجميل.

هذه معلومات الصالون:

${salonData}

هذه ردود تعلمتها من صاحب الصالون:

${memoryText}

استخدم هذه الردود عندما تكون مناسبة.

الرد يكون قصير وباللهجة المصرية.`
        },
        {
          role:"user",
          content:message.body
        }
      ]
    })

    const reply = ai.choices?.[0]?.message?.content

    if(!reply) return

    /* أثناء التدريب */

    if(trainingMode){

      if(Date.now() > trainingEnd){
        trainingMode = false
        console.log("Training ended")
      }else{

        if(!questionExists(message.body)){

          lastQuestion = message.body

          await client.sendMessage(
            ADMIN_NUMBER,
            "سؤال العميل:\n"+message.body+"\n\nرد AI:\n"+reply
          )

          return
        }

      }

    }

    await message.reply(reply)

  }catch(err){
    console.log("AI ERROR:",err.message)
  }

})

/* ارسال رسالة */

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

app.get("/",(req,res)=>{
  res.send("WhatsApp bot is running")
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("Server running on port "+PORT)
})

client.initialize()

module.exports={client}

