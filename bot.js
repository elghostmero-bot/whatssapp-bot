const express = require("express")
const app = express()

app.use(express.json({ limit: "20mb" }))

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
const fs = require("fs")
const OpenAI = require("openai")

// قراءة بيانات الصالون
const salonData = fs.readFileSync("salon-data.txt","utf8")

// تشغيل OpenAI
console.log("OPENAI KEY:", process.env.OPENAI_API_KEY)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// تشغيل واتساب
const client = new Client({
  authStrategy: new LocalAuth(),
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

// QR
client.on("qr", qr => {
  qrcode.generate(qr,{small:true})
})

// Ready
client.on("ready", () => {
  console.log("WhatsApp Bot Ready")
})

// قراءة الردود
function getReplies(){
  try{
    return JSON.parse(fs.readFileSync("replies.json"))
  }catch{
    return []
  }
}

// تنظيف النص العربي
function normalizeText(text){

text = text.toLowerCase()

text = text.replace(/[أإآ]/g,"ا")
text = text.replace(/ى/g,"ي")
text = text.replace(/ة/g,"ه")

text = text.replace(/[؟?!.,]/g,"")

text = text.replace(/\bو([^\s]+)/g,"و $1")

return text
}

// استقبال الرسائل
client.on("message", async message => {

if (!message.body) return

// تجاهل الستاتيس
if (message.from === "status@broadcast") return

// تجاهل الجروبات
if (message.from.includes("@g.us")) return

let msg = normalizeText(message.body)

let words = msg.split(/\s+/)

const replies = getReplies()

let responses = []

for(const item of replies){

let found = false

for(const keyword of item.keywords){

let key = normalizeText(keyword)

for(const word of words){

if(word.length < 2) continue

let cleanWord = word.replace(/^و/,"")
cleanWord = cleanWord.replace(/^ال/,"")
cleanWord = cleanWord.replace(/(.)\1+$/,"$1")

if(
word === key ||
cleanWord === key ||
cleanWord.includes(key) ||
key.includes(cleanWord)
){
found = true
}

}

}

if(found){
if(!responses.includes(item.reply)){
responses.push(item.reply)
}
}

}

try{

const ai = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{
role: "system",
content: `
انت موظف خدمة عملاء لصالون تجميل.

هذه معلومات الصالون:

${salonData}

استخدم هذه المعلومات فقط للرد على العملاء.
لو السؤال خارج هذه المعلومات اطلب توضيح.
الرد يكون قصير وباللهجة المصرية.
`
},
{
role: "user",
content: message.body
}
]
})

const reply = ai.choices?.[0]?.message?.content

if(reply){
await message.reply(reply)
}

}catch(err){

console.log("AI ERROR:",err.message)

}

// حفظ الرسائل غير المفهومة
const unknown = message.body

let data = []

try{
data = JSON.parse(fs.readFileSync("unknown.json"))
}catch{
data=[]
}

data.push({
msg:unknown,
date:new Date().toISOString()
})

fs.writeFileSync("unknown.json",JSON.stringify(data,null,2))

})

// إرسال الفواتير
app.post("/send-invoice", async (req,res)=>{
console.log("BODY RECEIVED:", req.body)
let { bride, groom, imageBase64 } = req.body

function formatNumber(num){
  num = num.replace(/\D/g,"")
  if(num.startsWith("0")){
    num = "20" + num.slice(1)
  }
  return num
}

bride = formatNumber(bride)
groom = formatNumber(groom)

try{

const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "")

const media = new MessageMedia(
"image/jpeg",
base64Data,
"invoice.jpg"
)

await client.sendMessage(bride+"@c.us", media,{
caption:"دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄"
})

await client.sendMessage(groom+"@c.us", media,{
caption:"دي الفاتورة الخاصة بالحجز في Samia Makeup Artist 💄"
})

res.send("sent")

}catch(err){

console.log(err)

res.status(500).send("error")

}

})

// الصفحة الرئيسية
app.get("/", (req,res)=>{
res.send("WhatsApp bot is running")
})

const PORT = process.env.PORT || 3000

app.listen(PORT, ()=>{
console.log("Server running on port " + PORT)
})

client.initialize()

module.exports = { client }




