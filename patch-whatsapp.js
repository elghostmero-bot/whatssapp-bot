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

if (!fs.existsSync(target)) {
  console.log("WhatsApp patch: Utils.js not found, skipping.");
  process.exit(0);
}

let source = fs.readFileSync(target, "utf8");

if (source.includes("delete message.__x_id;")) {
  console.log("WhatsApp patch: already applied.");
  process.exit(0);
}

const marker = `        // Bot's won't reply if canonicalUrl is set (linking)`;

const objectEnd = `        };${marker}`;

if (!source.includes(objectEnd)) {
  console.error("WhatsApp patch: target code pattern not found.");
  console.error("No changes were made.");
  process.exit(1);
}

source = source.replace(
  objectEnd,
  `        };\n        // Fix WhatsApp Web media __x_id collision (Sep 2026)\n        delete message.__x_id;\n${marker}`
);

fs.writeFileSync(target, source, "utf8");

console.log("WhatsApp patch: media sending fix applied successfully.");
