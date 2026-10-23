// Acceso fácil desde los iPads:
// 1) anuncia un nombre fijo en la red local (p. ej. seunaia.local) por mDNS/Bonjour, que iPads y Macs resuelven solos;
// 2) genera códigos QR (SVG para la pantalla /conectar y bloques de texto para la consola).
const os = require("os");
const makeMdns = require("multicast-dns");
const qrcode = require("qrcode-generator");

const toInt = (ip) => ip.split(".").reduce((n, x) => ((n << 8) + Number(x)) >>> 0, 0);
function ipv4s() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."));
}
const isHotspotIp = (ip) => ip.startsWith("192.168.137.");

// Responde las preguntas "¿quién es <nombre>.local?" con la IP de la interfaz por la que llegó la pregunta,
// para que un iPad en el hotspot reciba 192.168.137.1 y uno en la WiFi de la sala reciba la IP de esa red.
function anunciar(nombre) {
  const host = `${nombre}.local`.toLowerCase();
  let m;
  try { m = makeMdns({ reuseAddr: true }); } catch (e) { return { ok: false, host, error: e.message }; }
  m.on("error", (e) => console.error("  mDNS:", e.message));
  m.on("query", (q, rinfo) => {
    const asks = (q.questions || []).some((x) => String(x.name).toLowerCase() === host && (x.type === "A" || x.type === "ANY"));
    if (!asks) return;
    const list = ipv4s();
    const same = rinfo && list.find((i) => ((toInt(rinfo.address) & toInt(i.netmask)) >>> 0) === ((toInt(i.address) & toInt(i.netmask)) >>> 0));
    const ips = same ? [same.address] : list.map((i) => i.address);
    const answers = ips.map((ip) => ({ name: host, type: "A", ttl: 120, flush: true, data: ip }));
    m.respond({ answers });
    // respuesta directa también: algunas redes filtran el multicast de vuelta
    if (rinfo) m.respond({ id: rinfo.port === 5353 ? 0 : q.id, questions: rinfo.port === 5353 ? [] : q.questions, answers }, { port: rinfo.port, address: rinfo.address });
  });
  // si aparece una red nueva (p. ej. se enciende el hotspot), unirse también a ella
  const t = setInterval(() => { try { m.update(); } catch (_) {} }, 10000);
  t.unref();
  return { ok: true, host, close: () => { clearInterval(t); m.destroy(); } };
}

function qrSvg(text, cell = 8) {
  const q = qrcode(0, "M");
  q.addData(text, "Byte");
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true, alt: text });
}

// QR con medios bloques: blanco = fondo, así se lee en la consola negra de Windows
function qrTerminal(text, indent = "    ") {
  const q = qrcode(0, "L");
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount(), pad = 2;
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c);
  const lines = [];
  for (let r = -pad; r < n + pad; r += 2) {
    let s = indent;
    for (let c = -pad; c < n + pad; c++) {
      const top = dark(r, c), bot = dark(r + 1, c);
      s += top && bot ? " " : top ? "▄" : bot ? "▀" : "█";
    }
    lines.push(s);
  }
  return lines.join("\n");
}

// Formato estándar que leen las cámaras de iPhone/iPad para unirse a una WiFi
function wifiUri(ssid, pass) {
  const e = (s) => String(s).replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:WPA;S:${e(ssid)};P:${e(pass)};;`;
}

module.exports = { anunciar, qrSvg, qrTerminal, wifiUri, ipv4s, isHotspotIp };
