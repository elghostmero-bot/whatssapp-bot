const express = require("express")
const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const QRCode = require("qrcode")

const app = express()

let currentQR = null

async function startBot() {

  const { state, saveCreds } = await useMultiFileAuthState("auth")

  const sock = makeWASocket({
    auth: state
  })

  sock.ev.on("connection.update", async (update) => {

    const { connection, qr } = update

    if(qr){
      currentQR = await QRCode.toDataURL(qr)
      console.log("QR ready at /qr")
    }

    if(connection === "open"){
      console.log("WhatsApp Connected ✅")
    }

  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("messages.upsert", async ({ messages }) => {

    const msg = messages[0]

    if(!msg.message) return

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text

    const from = msg.key.remoteJid

    if(!text) return

    console.log("Message:", text)

    await sock.sendMessage(from,{
      text: "وصلت رسالتك 👍"
    })

  })

}

startBot()

app.get("/qr",(req,res)=>{

  if(!currentQR){
    return res.send("<h2>QR لسه ما اتولدش</h2>")
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

app.listen(process.env.PORT || 3000,()=>{
  console.log("Server running")
})
