const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "node_modules",
  "whatsapp-web.js",
  "src",
  "util",
  "Injected",
  "Utils.js"
);

console.log("WhatsApp patch: checking...");
console.log("Target:", target);

if (!fs.existsSync(target)) {
  console.log("WhatsApp patch: Utils.js NOT FOUND");
  process.exit(0);
}

let source = fs.readFileSync(target, "utf8");

if (source.includes("delete message.__x_id;")) {
  console.log("WhatsApp patch: ALREADY APPLIED");
  process.exit(0);
}

const marker =
  "        // Bot's won't reply if canonicalUrl is set (linking)";

if (!source.includes(marker)) {
  console.error("WhatsApp patch: TARGET MARKER NOT FOUND");
  process.exit(1);
}

source = source.replace(
  marker,
  "        // Fix WhatsApp Web media __x_id collision\n" +
  "        delete message.__x_id;\n" +
  marker
);

fs.writeFileSync(target, source, "utf8");

console.log("========================================");
console.log("WhatsApp patch: SUCCESS");
console.log("delete message.__x_id; added");
console.log("========================================");
