// Descarga las tipografías de Google Fonts a public/fonts para que la app funcione sin internet.
// Uso (con internet, una sola vez): node tools/descargar-fuentes.js
// Licencias: Doto, Inter y Share Tech Mono son SIL Open Font License 1.1.
const fs = require("fs");
const path = require("path");

const CSS_URL = "https://fonts.googleapis.com/css2?family=Doto:wght@700;900&family=Inter:wght@400;500;600;700&family=Share+Tech+Mono&display=swap";
const OUT = path.join(__dirname, "..", "public", "fonts");
const KEEP = ["latin", "latin-ext"]; // español completo
// Google entrega woff2 solo a navegadores modernos
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

(async () => {
  const css = await (await fetch(CSS_URL, { headers: { "User-Agent": UA } })).text();
  const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]+})/g)].filter((m) => KEEP.includes(m[1]));
  if (!blocks.length) throw new Error("Google Fonts no devolvió reglas @font-face");
  fs.mkdirSync(OUT, { recursive: true });
  const out = ["/* Tipografías locales (SIL Open Font License 1.1). Generado por tools/descargar-fuentes.js */"];
  for (const [, subset, rule] of blocks) {
    const family = rule.match(/font-family:\s*'([^']+)'/)[1];
    const weight = rule.match(/font-weight:\s*(\d+)/)[1];
    const url = rule.match(/url\(([^)]+)\)/)[1];
    const name = `${family.replace(/\s+/g, "")}-${weight}-${subset}.woff2`;
    const file = path.join(OUT, name);
    if (!fs.existsSync(file)) {
      const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
      fs.writeFileSync(file, buf);
    }
    out.push(`/* ${subset} */\n` + rule.replace(/url\([^)]+\)/, `url(/fonts/${name})`));
    console.log("  " + name);
  }
  fs.writeFileSync(path.join(OUT, "fonts.css"), out.join("\n") + "\n");
  console.log(`Listo: ${blocks.length} archivos en public/fonts`);
})().catch((e) => { console.error("No se pudieron descargar las tipografías:", e.message); process.exit(1); });
