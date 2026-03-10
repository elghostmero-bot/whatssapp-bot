const express = require("express")
const app = express()

app.use(express.json({ limit: "20mb" }))
const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const OpenAI = require("openai")

const salonData = fs.readFileSync("salon-data.txt","utf8")

const openai = new OpenAI({
apiKey: "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"
})

const client = new Client({
authStrategy: new LocalAuth(),
puppeteer: {
headless: true,
args: ['--no-sandbox','--disable-setuid-sandbox'],
}
})

client.on('qr', qr => {
qrcode.generate(qr,{small:true})
})

client.on('ready', () => {
console.log("WhatsApp Bot Ready")
})

function getReplies(){
return JSON.parse(fs.readFileSync('replies.json'))
}

function normalizeText(text){

text = text.toLowerCase()

text = text.replace(/[أإآ]/g,"ا")
text = text.replace(/ى/g,"ي")
text = text.replace(/ة/g,"ه")

text = text.replace(/[؟?!.,]/g,"")

text = text.replace(/\bو([^\s]+)/g,"و $1")

return text
}

client.on('message', async message => {


// ❌ تجاهل الستاتيس
if (message.from === "status@broadcast") {
return
}

// ❌ تجاهل الجروبات
if (message.from.includes("@g.us")) {
return
}


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
وتكون مناسبة لنوع الجنس اللي بيكلمك بناء عن اسمه لو بنات كلمهم بطريقة فرفوشة
`
},
{
role: "user",
content: message.body
}
]
})

await message.reply(ai.choices[0].message.content)

}catch(err){

console.log(err)

}

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
const { MessageMedia } = require('whatsapp-web.js')

app.post("/send-invoice", async (req,res)=>{

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

  const { MessageMedia } = require("whatsapp-web.js")

  // إزالة الجزء الزائد من base64
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

app.listen(3001,()=>{
console.log("Invoice API running")
})

client.initialize()


module.exports = { client }
