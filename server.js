// Sé una IA por un d-IA — servidor central (alpha)
// Corre en un PC de la universidad. Los iPads de la misma red entran con http://seunaia.local
// (nombre anunciado por mDNS) o escaneando el QR de la pantalla /conectar.
// Todo el estado vive en memoria; se guarda un respaldo en data/sesion.json por si el servidor se reinicia.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const red = require("./lib/red");

// Configuración: variables de entorno > config.json (lo crea INSTALAR.bat) > valores por defecto
let FILE_CFG = {};
try { FILE_CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (_) { /* sin config.json */ }
const WANTED_PORT = Number(process.env.PORT) || Number(FILE_CFG.puerto) || 80;
const FALLBACK_PORT = 3000;
let PORT = WANTED_PORT;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || FILE_CFG.claveAdmin || "crea2026";
const NOMBRE = String(FILE_CFG.nombre || "seunaia").toLowerCase().replace(/[^a-z0-9-]/g, "") || "seunaia";
const HOTSPOT = process.argv.includes("--hotspot") ? { nombre: FILE_CFG.hotspotNombre || "SeUnaIA-CREA", clave: FILE_CFG.hotspotClave || "crea2026ia" } : null;
let MDNS = { ok: false, host: NOMBRE + ".local" };
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const SNAPSHOT = path.join(DATA_DIR, "sesion.json");
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// Autoría (se muestra en la landing, al pie de cada pantalla y en la consola)
const AUTHORS = ["David Octavio Ibarra", "Sebastián Suárez", "Francisco Santamaría", "Ángel Peñaranda"];

// ---------- Reglas del juego (ver especificación) ----------
// Modelo: piensa · Arnés: ejecuta lo que diga el Modelo · Revisor: describe las acciones del Arnés
const ROLES = ["modelo", "arnes", "revisor"];
const CORE = ["modelo", "arnes"];
// Canales: U Usuario (profesor)↔Modelo: el único que habla con el Usuario es el Modelo
//          C Modelo→Arnés · R Revisor→Modelo (retroalimentación; el Arnés también la lee)
// El Modelo no le escribe al Revisor ni el Revisor al Arnés: al Revisor no le llega nada del Modelo.
const READ = { modelo: ["U", "C", "R"], arnes: ["C", "R"], revisor: ["R"] };
const SEND_TO = { modelo: { arnes: "C", usuario: "U" }, revisor: { modelo: "R" }, arnes: {} };
const MAX_TEAMS = 8;
const MAX_MSG = 280;
const BONUS = 40;
const IMG_COST = 120; // una foto ocupa lo mismo que 120 caracteres de contexto
const MAX_IMG = 1500000; // ~1,1 MB en base64; el cliente la reduce antes de enviarla

const QUESTIONS = [
  ["¿Qué pasa cuando se llena la ventana de contexto?", "Se olvida lo más viejo", "Se guarda todo para siempre", "El agente se apaga"],
  ["Un token es…", "Un pedazo de texto que procesa el modelo", "Una contraseña", "Un tipo de robot"],
  ["¿Quién le da instrucciones concretas al Arnés?", "El Modelo", "El Revisor", "El profesor"],
  ["¿Para qué sirve el Revisor en un agente?", "Detectar errores y dar feedback", "Escribir más rápido", "Borrar el contexto"],
  ["Si escribes mensajes muy largos…", "Se gasta el contexto más rápido", "El agente siempre piensa mejor", "No pasa nada"],
  ["El arnés de un agente es…", "Lo que ejecuta acciones en el mundo", "Quien escribe el prompt", "Un tipo de memoria"],
  ["¿Qué es un prompt?", "La instrucción que recibe la IA", "La respuesta de la IA", "Un error del sistema"],
  ["¿Quién es el único que habla con el Usuario?", "El Modelo", "El Arnés", "El Revisor"],
  ["¿Por qué un agente necesita varios roles?", "Para dividir el trabajo y revisarlo", "Para gastar más energía", "No los necesita"],
  ["¿Qué hace una IA con lo que ya no cabe en su contexto?", "Ya no lo puede ver", "Lo resume sola siempre", "Lo manda a otra IA"],
];

// ---------- Estado ----------
let S = freshState();
const adminTokens = new Set();

function freshState() {
  return {
    code: "CREA-" + Math.floor(100 + Math.random() * 900),
    phase: "lobby", // lobby | activity | rotate | end
    // queueSec: espera mínima en la cola para hablar con el Usuario · coolSec: espera tras cada conversación
    // liveSec: la conversación se cierra sola si pasa este tiempo sin mensajes
    cfg: { limit: 500, mode: "mensaje", rotSec: 300, autoRot: true, queueSec: 60, coolSec: 60, liveSec: 60 },
    images: {}, // imageId -> dataURL (fotos del Revisor)
    devices: {}, // deviceId -> { id, pc, role, team, personId, online }
    persons: {}, // personId -> { id, nick, history: [], deviceId }
    teams: [], // [{ msgs, bonus, bonusLog, forgot, forgotTotal, sent }]
    nextPc: 1,
    nextId: 1,
    timerLeft: 300,
    paused: false,
    rot: null, // { assign: {personId: deviceId}, ready: {personId: true} }
    round: 1,
    questions: {}, // deviceId -> { qi, order }
    queue: [], // modelos esperando al Usuario: [{ team, text, at, author }]
    live: null, // conversación abierta entre el Usuario y un Modelo: { team, since, lastAt }
  };
}
function newTeam() { return { msgs: [], bonus: 0, bonusLog: "", forgot: null, forgotTotal: 0, sent: 0, coolUntil: 0 }; }

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const devList = () => Object.values(S.devices);
const teamDevices = (t) => devList().filter((d) => d.team === t);
const deviceAt = (t, role) => devList().find((d) => d.team === t && d.role === role);
const limitOf = (t) => S.cfg.limit + S.teams[t].bonus;
const costOf = (m) => m.text.length + (m.img ? IMG_COST : 0);
const usedOf = (t) => S.teams[t].msgs.reduce((n, m) => n + costOf(m), 0);
const autoRot = () => S.cfg.autoRot !== false;
// consumo del contexto por componente (quién lo escribió), para la barra por colores
function usedBy(t) {
  const by = {};
  S.teams[t].msgs.forEach((m) => (by[m.role] = (by[m.role] || 0) + costOf(m)));
  return by;
}
const hasRevisor = (t) => !!deviceAt(t, "revisor");
const cleanText = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

// ---------- Equipos ----------
function placeInTeam(dev) {
  // primer equipo al que le falte ese rol; si todos lo tienen, se abre uno nuevo
  for (let t = 0; t < S.teams.length; t++) if (!deviceAt(t, dev.role)) { dev.team = t; return; }
  if (S.teams.length < MAX_TEAMS) { S.teams.push(newTeam()); dev.team = S.teams.length - 1; return; }
  dev.team = null;
}
function reshuffleTeams() {
  const by = {};
  ROLES.forEach((r) => (by[r] = shuffle(devList().filter((d) => d.role === r))));
  const n = Math.min(MAX_TEAMS, Math.max(1, ...CORE.map((r) => by[r].length)));
  S.teams = Array.from({ length: n }, newTeam);
  ROLES.forEach((r) => by[r].forEach((d, i) => (d.team = i < n ? i : null)));
}
function pruneEmptyTeams() {
  // solo en el lobby: quita equipos vacíos del final
  while (S.teams.length && teamDevices(S.teams.length - 1).length === 0) S.teams.pop();
}
function teamWarnings(t) {
  const w = [];
  CORE.forEach((r) => { if (!deviceAt(t, r)) w.push("falta " + r); });
  if (!hasRevisor(t)) w.push("sin revisor: nadie retroalimenta al Modelo");
  ROLES.forEach((r) => { if (teamDevices(t).filter((d) => d.role === r).length > 1) w.push("dos " + r); });
  return w;
}

// ---------- Mensajes y ventana de contexto (FIFO) ----------
// quién firma un mensaje; dev = null es el profesor (Usuario)
function authorOf(dev) {
  if (!dev) return { role: "profesor", nick: "profesor", pc: null };
  const person = S.persons[dev.personId];
  return { role: dev.role, nick: person ? person.nick : "?", pc: dev.pc };
}
function addMsg(t, ch, author, text, imgData) {
  const team = S.teams[t];
  let img = null;
  if (imgData) { img = crypto.randomBytes(9).toString("hex"); S.images[img] = imgData; }
  team.msgs.push({ id: S.nextId++, ch, text, img, role: author.role, nick: author.nick, pc: author.pc, at: Date.now() });
  if (ch === "U" && S.live && S.live.team === t) S.live.lastAt = Date.now();
  team.sent++;
  enforce(t);
}
function dropMsg(team) {
  const m = team.msgs.shift();
  if (m && m.img) delete S.images[m.img];
  return m;
}
function enforce(t) {
  const team = S.teams[t], lim = limitOf(t);
  let total = usedOf(t), removed = 0;
  while (total > lim && team.msgs.length) {
    const first = team.msgs[0];
    // una foto no se puede recortar: se olvida completa
    if ((S.cfg.mode === "mensaje" && team.msgs.length > 1) || first.img) {
      const c = costOf(first); dropMsg(team); removed += c; total -= c;
    } else {
      const cut = Math.min(total - lim, first.text.length);
      first.text = first.text.slice(cut); first.cut = true; removed += cut; total -= cut;
      if (!first.text.length) dropMsg(team);
    }
  }
  if (removed) { team.forgot = { n: removed, at: Date.now() }; team.forgotTotal += removed; }
}

// ---------- Cola de los Modelos para hablar con el Usuario ----------
// El Usuario atiende a un Modelo a la vez. Cada Modelo que le escribe entra a la cola y espera
// al menos queueSec; además espera a que el Usuario termine con los que llegaron antes.
// Con modelo 1, 2 y 3 en cola: el 1 espera 1 min, el 2 espera 1 min + lo que tome atender al 1, etc.
// Dentro de la conversación los mensajes van al instante; al cerrarla, ese Modelo entra en enfriamiento (coolSec).
// Si el admin no la cierra, se cierra sola tras liveSec sin mensajes, para que la cola no se quede detenida.
const queuePos = (t) => S.queue.findIndex((q) => q.team === t);
function serveQueue() {
  if (S.phase !== "activity" || S.paused || S.live) return false;
  const head = S.queue[0];
  if (!head || Date.now() < head.at + S.cfg.queueSec * 1000) return false;
  S.queue.shift();
  if (!S.teams[head.team]) return serveQueue();
  S.live = { team: head.team, since: Date.now(), lastAt: Date.now() };
  addMsg(head.team, "U", head.author, head.text);
  return true;
}
function endLive() {
  if (!S.live) return;
  const team = S.teams[S.live.team];
  if (team) team.coolUntil = Date.now() + S.cfg.coolSec * 1000;
  S.live = null;
  serveQueue();
}
const liveEndsAt = () => (S.live ? (S.live.lastAt || S.live.since) + S.cfg.liveSec * 1000 : null);
function liveTimeout() {
  if (!S.live || Date.now() < liveEndsAt()) return false;
  endLive();
  return true;
}
function queueInfo(t) {
  const i = queuePos(t);
  if (i < 0) return null;
  const q = S.queue[i];
  return { text: q.text, pos: i + 1, ahead: i + (S.live ? 1 : 0), readyAt: q.at + S.cfg.queueSec * 1000 };
}

// ---------- Reconexión por nickname ----------
// Si un iPad se apaga, se recarga o pierde su memoria, la persona escribe el mismo nickname
// (en ese iPad o en otro) y el sistema le devuelve su puesto: mismo PC, rol, equipo y chat.
const findByNick = (nick) => Object.values(S.persons).find((p) => p.nick.toLowerCase() === nick.toLowerCase());
function moveDevice(oldId, newId) {
  const d = S.devices[oldId];
  delete S.devices[oldId];
  d.id = newId;
  S.devices[newId] = d;
  Object.values(S.persons).forEach((p) => { if (p.deviceId === oldId) p.deviceId = newId; });
  if (S.rot) Object.keys(S.rot.assign).forEach((pid) => { if (S.rot.assign[pid] === oldId) S.rot.assign[pid] = newId; });
  if (S.questions[oldId]) { S.questions[newId] = S.questions[oldId]; delete S.questions[oldId]; }
  return d;
}

// ---------- Rotación ----------
function seated() {
  // personas sentadas en un PC con equipo; ellas rotan entre esos PCs
  return devList().filter((d) => d.team !== null && d.personId && S.persons[d.personId]);
}
function computeAssignment(level) {
  const devs = seated();
  const persons = shuffle(devs.map((d) => S.persons[d.personId]));
  const used = new Set(), res = {};
  const ok = (p, d) => {
    if (d.id === p.deviceId) return devs.length === 1;
    if (level === 0) return !p.history.includes(d.role);
    if (level === 1) return d.role !== S.devices[p.deviceId].role;
    return true;
  };
  const bt = (i) => {
    if (i === persons.length) return true;
    const p = persons[i];
    for (const d of shuffle(devs)) {
      if (used.has(d.id) || !ok(p, d)) continue;
      used.add(d.id); res[p.id] = d.id;
      if (bt(i + 1)) return true;
      used.delete(d.id);
    }
    return false;
  };
  return bt(0) ? res : null;
}
function startRotation() {
  const assign = computeAssignment(0) || computeAssignment(1) || computeAssignment(2);
  if (!assign) return false;
  S.rot = { assign, ready: {} };
  S.phase = "rotate";
  return true;
}
function finishRotation() {
  const moves = Object.entries(S.rot.assign);
  devList().forEach((d) => { if (moves.some(([, did]) => did === d.id)) d.personId = null; });
  moves.forEach(([pid, did]) => {
    const p = S.persons[pid], d = S.devices[did];
    if (!p || !d) return;
    d.personId = p.id; p.deviceId = d.id; p.history.push(d.role);
  });
  S.rot = null; S.phase = "activity"; S.timerLeft = S.cfg.rotSec; S.round++; S.questions = {};
}
function checkRotationDone() {
  if (S.phase !== "rotate") return;
  if (Object.keys(S.rot.assign).every((pid) => S.rot.ready[pid])) finishRotation();
}

// ---------- Minijuego ----------
function questionFor(devId) {
  if (!S.questions[devId]) {
    const qi = Math.floor(Math.random() * QUESTIONS.length);
    S.questions[devId] = { qi, order: shuffle([1, 2, 3]) };
  }
  const q = S.questions[devId];
  return { id: q.qi, text: QUESTIONS[q.qi][0], options: q.order.map((k) => ({ k, text: QUESTIONS[q.qi][k] })) };
}
function neighborTeam(t) { return S.teams.length > 1 ? (t + 1) % S.teams.length : null; }

// ---------- Vistas (filtradas por rol en el servidor) ----------
function deviceView(dev) {
  const base = { kind: "device", phase: S.phase, code: S.code, paused: S.paused, round: S.round, now: Date.now() };
  if (!dev) return { ...base, registered: false };
  const person = S.persons[dev.personId];
  const v = {
    ...base, registered: true,
    you: { pc: dev.pc, role: dev.role, team: dev.team, nick: person ? person.nick : null },
    counts: { devices: devList().length, online: devList().filter((d) => d.online).length },
  };
  if (S.phase === "rotate") {
    const outPid = dev.personId;
    const inPid = Object.keys(S.rot.assign).find((pid) => S.rot.assign[pid] === dev.id);
    v.rotation = {
      outgoing: outPid && S.rot.assign[outPid] ? { nick: S.persons[outPid].nick, toPc: S.devices[S.rot.assign[outPid]].pc } : null,
      incoming: inPid ? { id: Number(inPid), nick: S.persons[inPid].nick, ready: !!S.rot.ready[inPid] } : null,
      ready: Object.keys(S.rot.ready).length, total: Object.keys(S.rot.assign).length,
    };
  }
  if (dev.team !== null && (S.phase === "activity" || S.phase === "end")) {
    const t = dev.team, team = S.teams[t];
    v.sendTo = Object.keys(SEND_TO[dev.role]); // destinos posibles; el Arnés no escribe
    v.context = { used: usedOf(t), by: usedBy(t), limit: limitOf(t), base: S.cfg.limit, bonus: team.bonus, bonusLog: team.bonusLog, forgot: team.forgot, oldestId: team.msgs[0] ? team.msgs[0].id : null };
    v.msgs = team.msgs.filter((m) => READ[dev.role].includes(m.ch)).map((m) => msgOut(m, dev.pc));
    if (dev.role === "modelo") {
      v.usuario = { live: !!S.live && S.live.team === t, liveEndsAt: liveEndsAt(), queue: queueInfo(t), coolUntil: team.coolUntil || 0, waiting: S.queue.length, queueSec: S.cfg.queueSec, coolSec: S.cfg.coolSec };
    }
    if (S.phase === "activity") {
      v.question = questionFor(dev.id);
      const nt = neighborTeam(t);
      const n = nt === null ? null : deviceAt(nt, dev.role);
      v.neighborPc = n ? n.pc : null;
    }
  }
  return v;
}

// las fotos viajan como enlace (/img/<id>), no dentro de la vista, para no mandar megas cada segundo
const msgOut = (m, pc) => ({ id: m.id, ch: m.ch, text: m.text, cut: !!m.cut, role: m.role, nick: m.nick, img: m.img ? "/img/" + m.img : null, mine: pc !== undefined && m.pc === pc });

function adminView() {
  return {
    kind: "admin", phase: S.phase, code: S.code, cfg: S.cfg, paused: S.paused, round: S.round, timerLeft: S.timerLeft, acceso: acceso(), now: Date.now(),
    live: S.live ? { ...S.live, endsAt: liveEndsAt() } : null,
    queue: S.queue.map((q) => ({ team: q.team, text: q.text, nick: q.author.nick, readyAt: q.at + S.cfg.queueSec * 1000 })),
    devices: devList().sort((a, b) => a.pc - b.pc).map((d) => ({
      id: d.id, pc: d.pc, role: d.role, team: d.team, online: d.online,
      nick: d.personId && S.persons[d.personId] ? S.persons[d.personId].nick : null,
    })),
    teams: S.teams.map((tm, t) => ({
      used: usedOf(t), by: usedBy(t), limit: limitOf(t), bonus: tm.bonus, sent: tm.sent, forgotTotal: tm.forgotTotal,
      warnings: teamWarnings(t), msgs: tm.msgs.map((m) => msgOut(m)), coolUntil: tm.coolUntil || 0,
    })),
    rotation: S.rot ? Object.entries(S.rot.assign).map(([pid, did]) => ({
      nick: S.persons[pid] ? S.persons[pid].nick : "?", toPc: S.devices[did] ? S.devices[did].pc : null, ready: !!S.rot.ready[pid],
      online: S.devices[did] ? S.devices[did].online : false,
    })) : null,
  };
}

// ---------- Cómo entran los iPads ----------
function acceso() {
  const port = PORT === 80 ? "" : ":" + PORT;
  const ips = red.ipv4s().map((i) => ({ ip: i.address, url: `http://${i.address}${port}`, hotspot: red.isHotspotIp(i.address) }));
  // con hotspot, la IP del hotspot primero; si no, las demás primero
  ips.sort((a, b) => (HOTSPOT ? b.hotspot - a.hotspot : a.hotspot - b.hotspot));
  return { host: MDNS.host, url: `http://${MDNS.host}${port}`, mdns: MDNS.ok, ips, qrUrl: ips[0] ? ips[0].url : `http://localhost${port}`, hotspot: HOTSPOT ? { nombre: HOTSPOT.nombre } : null };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Pantalla para proyectar en la sala: QR de la WiFi (si hay hotspot) y QR de la app
function conectarPage() {
  const a = acceso();
  const paso = (n, titulo, qr, cuerpo) => `<section class="paso"><span class="n">${n}</span><h2>${titulo}</h2><div class="qr">${qr}</div>${cuerpo}</section>`;
  const wifi = HOTSPOT ? paso(1, "Conéctate a la WiFi", red.qrSvg(red.wifiUri(HOTSPOT.nombre, HOTSPOT.clave)),
    `<p>Red: <b>${escHtml(HOTSPOT.nombre)}</b><br>Clave: <b>${escHtml(HOTSPOT.clave)}</b></p><p class="muted">Abre la cámara y apunta al código.</p>`) : "";
  // El QR es la vía principal: lleva la dirección numérica, que funciona aunque la red bloquee los nombres .local
  const app = paso(HOTSPOT ? 2 : 1, "Escanea para jugar", red.qrSvg(a.qrUrl),
    `<p class="muted">Abre la cámara del iPad y apunta al código.</p><p>O escribe en Safari:</p><p class="host">${escHtml(a.qrUrl.replace("http://", ""))}</p><p class="muted" style="font-size:14px">En algunas redes también funciona ${escHtml(a.url.replace("http://", ""))}</p>`);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Conéctate · Sé una IA por un d-IA</title><meta http-equiv="refresh" content="60">
<link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/styles.css">
<style>
.wrap{position:relative;z-index:1;min-height:100dvh;display:flex;flex-direction:column;gap:24px;padding:24px max(16px,env(safe-area-inset-left,0px))}
.top{display:flex;justify-content:space-between;align-items:center}
.pasos{flex:1;display:flex;flex-wrap:wrap;gap:28px;align-items:stretch;justify-content:center}
.paso{flex:1 1 340px;max-width:520px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:28px;padding:28px}
.paso .n{width:48px;height:48px;border-radius:50%;background:var(--t);color:#000;display:flex;align-items:center;justify-content:center;font:900 26px var(--display)}
.paso h2{margin:0;font:700 28px var(--ui)}
.paso p{margin:0;font-size:20px;color:var(--soft)}
.paso b{color:#fff}
.qr{width:min(320px,70vw);background:#fff;border-radius:18px;padding:8px}
.qr svg{display:block;width:100%;height:auto}
.host{font:900 clamp(30px,4.5vw,52px) var(--display)!important;color:var(--t)!important;letter-spacing:-.03em;overflow-wrap:anywhere}
</style></head><body><div class="wrap">
<div class="top"><img class="logo-crea" src="/assets/crea.png" alt="CREA"><h1 class="lockup" style="font-size:0" aria-label="Sé una IA por un día"><span class="lines"><span class="dots" style="font-size:clamp(22px,3vw,40px)">SÉ UNA</span><span class="dots" style="font-size:clamp(22px,3vw,40px)">POR UN D-</span></span><span class="dots ia" style="font-size:clamp(56px,8vw,104px)">IA</span></h1><img class="logo-ua" src="/assets/uniandes-blanco.png" alt="Universidad de los Andes, Facultad de Ingeniería"></div>
<div class="pasos">${wifi}${app}</div>
<footer class="credits">Creado por ${AUTHORS.map(escHtml).join(" · ")} y el equipo CREA · Facultad de Ingeniería, Universidad de los Andes</footer></div><script src="/fx.js"></script></body></html>`;
}

// ---------- Servidor HTTP estático ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/conectar" || urlPath === "/conectar/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(conectarPage());
  }
  const im = urlPath.match(/^\/img\/([0-9a-f]{18})$/);
  if (im) {
    const data = S.images[im[1]];
    const m = data && data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": m[1], "Cache-Control": "private, max-age=3600" });
    return res.end(Buffer.from(m[2], "base64"));
  }
  const rel = urlPath === "/" || urlPath === "/admin" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
});
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000, maxHttpBufferSize: 3e6 });

// ---------- Sincronización ----------
let syncQueued = false;
function sync() {
  if (syncQueued) return;
  syncQueued = true;
  setImmediate(() => {
    syncQueued = false;
    const admin = adminView();
    for (const [, sock] of io.sockets.sockets) {
      if (sock.data.admin) sock.emit("view", admin);
      else if (sock.data.deviceId !== undefined) sock.emit("view", deviceView(S.devices[sock.data.deviceId]));
    }
    saveSoon();
  });
}
function syncAdmins() {
  const admin = adminView();
  for (const [, sock] of io.sockets.sockets) if (sock.data.admin) sock.emit("view", admin);
}

// ---------- Respaldo en disco ----------
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = SNAPSHOT + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), state: S }));
      fs.renameSync(tmp, SNAPSHOT);
    } catch (e) { console.error("No se pudo guardar el respaldo:", e.message); }
  }, 2000);
}
function loadSnapshot() {
  if (process.argv.includes("--nueva")) return;
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    if (Date.now() - raw.savedAt > SNAPSHOT_MAX_AGE_MS) return;
    const fresh = freshState();
    // un respaldo de la versión con Thinking no sirve: se empieza de cero
    if (Object.values(raw.state.devices || {}).some((d) => !ROLES.includes(d.role))) return;
    S = { ...fresh, ...raw.state, cfg: { ...fresh.cfg, ...raw.state.cfg } };
    devList().forEach((d) => (d.online = false));
    console.log(`Sesión ${S.code} recuperada del respaldo (${devList().length} dispositivos).`);
  } catch (_) { /* sin respaldo: sesión nueva */ }
}

// ---------- Eventos ----------
io.on("connection", (sock) => {
  const reply = (cb, payload) => { if (typeof cb === "function") cb(payload); };
  const isAdmin = () => sock.data.admin === true;
  const myDevice = () => S.devices[sock.data.deviceId];

  sock.on("hello", ({ deviceId } = {}, cb) => {
    const id = cleanText(deviceId, 64);
    if (!id) return reply(cb, { ok: false });
    sock.data.deviceId = id;
    const dev = S.devices[id];
    if (dev) dev.online = true;
    reply(cb, { ok: true });
    sock.emit("view", deviceView(dev));
    if (dev) syncAdmins();
  });

  // Volver al puesto con el mismo nickname (también se intenta solo desde "join")
  function reclaim(nick) {
    const id = sock.data.deviceId;
    const p = findByNick(nick);
    if (!p) return { error: `No hay nadie jugando como "${nick}". Revisa cómo lo escribiste.` };
    const dev = S.devices[p.deviceId];
    if (!dev) return { error: "Tu puesto ya no existe. Pide al admin que te agregue de nuevo." };
    if (dev.id === id) { dev.online = true; return { ok: true, reclaimed: true, pc: dev.pc }; }
    const other = [...io.sockets.sockets.values()].some((s) => s !== sock && s.data.deviceId === dev.id);
    if (dev.online && other) return { error: `"${p.nick}" está conectado en el PC ${dev.pc}. Si ese iPad se apagó o se trabó, espera unos segundos o pide al admin que lo libere.` };
    if (S.devices[id]) return { error: "Este iPad ya tiene otro puesto. Usa uno libre o pide ayuda al admin." };
    moveDevice(dev.id, id);
    dev.online = true;
    return { ok: true, reclaimed: true, pc: dev.pc };
  }
  sock.on("reclaim", ({ nick } = {}, cb) => {
    nick = cleanText(nick, 16);
    if (!sock.data.deviceId) return reply(cb, { error: "Recarga la página e inténtalo de nuevo." });
    if (!nick) return reply(cb, { error: "Escribe el nickname con el que estabas jugando." });
    const r = reclaim(nick);
    reply(cb, r);
    if (r.ok) sync();
  });

  sock.on("join", ({ nick, role } = {}, cb) => {
    const id = sock.data.deviceId;
    nick = cleanText(nick, 16);
    if (!id) return reply(cb, { error: "Recarga la página e inténtalo de nuevo." });
    if (!nick) return reply(cb, { error: "Escribe tu nickname para entrar." });
    if (!ROLES.includes(role)) return reply(cb, { error: "Escoge un rol." });
    if (S.devices[id]) return reply(cb, { error: "Este PC ya está registrado." });
    if (findByNick(nick)) {
      // el nickname ya existe: si su iPad está desconectado, es la misma persona volviendo
      const r = reclaim(nick);
      if (r.ok) { reply(cb, r); return sync(); }
      return reply(cb, { error: r.error.startsWith(`"`) ? r.error : `El nickname "${nick}" ya está en uso. Escoge otro.` });
    }
    const pid = S.nextId++;
    S.persons[pid] = { id: pid, nick, history: [role], deviceId: id };
    const dev = { id, pc: S.nextPc++, role, team: null, personId: pid, online: true };
    S.devices[id] = dev;
    if (S.phase === "lobby") placeInTeam(dev);
    reply(cb, { ok: true });
    sync();
  });

  // to: Modelo → "arnes" | "usuario" · Revisor → "modelo" | "arnes"; image: dataURL de una foto (solo el Revisor)
  sock.on("send", ({ text, to, image } = {}, cb) => {
    const dev = myDevice();
    text = cleanText(text, MAX_MSG);
    if (!dev || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Ahora no se puede enviar." });
    if (S.paused) return reply(cb, { error: "La actividad está en pausa." });
    const dests = SEND_TO[dev.role];
    if (!Object.keys(dests).length) return reply(cb, { error: "Tu rol no escribe: ejecutas lo que diga el Modelo." });
    if (to !== undefined && !dests[to]) return reply(cb, { error: "Tu rol no le puede escribir a ese rol." });
    const ch = dests[to || Object.keys(dests)[0]];
    let img = null;
    if (image !== undefined && image !== null) {
      if (dev.role !== "revisor") return reply(cb, { error: "Solo el Revisor puede mandar fotos." });
      if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMG) return reply(cb, { error: "La foto no es válida o es muy grande." });
      img = image;
    }
    if (!text && !img) return reply(cb, { error: "Escribe algo antes de enviar." });
    const t = dev.team;
    if (ch === "U" && !(S.live && S.live.team === t)) {
      // fuera de una conversación abierta, el Modelo entra a la cola del Usuario
      if (queuePos(t) >= 0) return reply(cb, { error: `Ya estás en la cola del Usuario (puesto ${queuePos(t) + 1}). Espera tu turno.` });
      const left = Math.ceil(((S.teams[t].coolUntil || 0) - Date.now()) / 1000);
      if (left > 0) return reply(cb, { error: `Debes esperar ${left} s para volver a escribirle al Usuario.` });
      S.queue.push({ team: t, text, at: Date.now(), author: authorOf(dev) });
      serveQueue();
      reply(cb, { ok: true, queued: queuePos(t) >= 0, pos: queuePos(t) + 1 });
      return sync();
    }
    addMsg(t, ch, authorOf(dev), text, img);
    reply(cb, { ok: true, sent: text });
    sync();
  });

  sock.on("answer", ({ qid, k } = {}, cb) => {
    const dev = myDevice();
    if (!dev || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Ahora no." });
    const q = S.questions[dev.id];
    if (!q || q.qi !== qid) return reply(cb, { error: "Esa pregunta ya cambió." });
    delete S.questions[dev.id];
    const correct = k === 1;
    let toPc = null;
    if (correct) {
      const nt = neighborTeam(dev.team);
      if (nt !== null) {
        const team = S.teams[nt], person = S.persons[dev.personId], n = deviceAt(nt, dev.role);
        team.bonus += BONUS;
        team.bonusLog = `+${BONUS} de ${person ? person.nick : "un vecino"} (PC ${dev.pc})`;
        toPc = n ? n.pc : null;
      }
    }
    reply(cb, { ok: true, correct, correctText: QUESTIONS[qid][1], toPc, bonus: BONUS });
    sync();
  });

  sock.on("ready", ({ personId } = {}, cb) => {
    const dev = myDevice();
    if (!dev || S.phase !== "rotate" || S.rot.assign[personId] !== dev.id) return reply(cb, { error: "Este no es tu PC." });
    S.rot.ready[personId] = true;
    reply(cb, { ok: true });
    checkRotationDone();
    sync();
  });

  // ----- Admin -----
  sock.on("admin:login", ({ password, token } = {}, cb) => {
    if ((token && adminTokens.has(token)) || password === ADMIN_PASSWORD) {
      const t = token && adminTokens.has(token) ? token : crypto.randomBytes(16).toString("hex");
      adminTokens.add(t);
      sock.data.admin = true;
      reply(cb, { ok: true, token: t });
      sock.emit("view", adminView());
    } else reply(cb, { error: "Clave incorrecta." });
  });

  const adminOn = (ev, fn) => sock.on(ev, (data = {}, cb) => {
    if (!isAdmin()) return reply(cb, { error: "Solo el admin." });
    const err = fn(data);
    reply(cb, err ? { error: err } : { ok: true });
    sync();
  });

  // se puede cambiar en cualquier momento, también en plena actividad
  adminOn("admin:config", ({ limit, mode, rotSec, autoRot, queueSec, coolSec, liveSec }) => {
    if (queueSec !== undefined) S.cfg.queueSec = Math.max(0, Math.min(900, Math.round(Number(queueSec)) || 0));
    if (liveSec !== undefined) S.cfg.liveSec = Math.max(1, Math.min(1800, Math.round(Number(liveSec)) || 60));
    if (coolSec !== undefined) S.cfg.coolSec = Math.max(0, Math.min(1800, Math.round(Number(coolSec)) || 0));
    if (limit !== undefined) S.cfg.limit = Math.max(50, Math.min(5000, Math.round(Number(limit)) || 500));
    if (mode === "mensaje" || mode === "recortar") S.cfg.mode = mode;
    if (rotSec !== undefined) {
      const prev = S.cfg.rotSec;
      S.cfg.rotSec = Math.max(30, Math.min(3600, Number(rotSec) || 300));
      // en la actividad, el tiempo que queda se ajusta a la nueva duración
      if (S.phase === "lobby") S.timerLeft = S.cfg.rotSec;
      else S.timerLeft = Math.max(5, Math.min(S.cfg.rotSec, S.timerLeft + (S.cfg.rotSec - prev)));
    }
    if (autoRot !== undefined) S.cfg.autoRot = !!autoRot;
    S.teams.forEach((_, t) => enforce(t));
    serveQueue();
  });
  adminOn("admin:setTimer", ({ sec }) => {
    const n = Math.round(Number(sec));
    if (!(n >= 5 && n <= 3600)) return "Escribe entre 5 segundos y 60 minutos.";
    S.timerLeft = n;
  });
  // el Usuario (profesor) le escribe al Modelo de un equipo (canal U); llega al instante
  adminOn("admin:reply", ({ team, text }) => {
    text = cleanText(text, MAX_MSG);
    const t = Number(team);
    if (S.phase !== "activity" && S.phase !== "rotate") return "Solo durante la actividad.";
    if (!S.teams[t]) return "Equipo inválido.";
    if (!text) return "Escribe la respuesta.";
    addMsg(t, "U", authorOf(null), text);
  });
  // cierra la conversación abierta y pasa al siguiente Modelo de la cola
  adminOn("admin:endLive", () => { if (!S.live) return "No hay ninguna conversación abierta."; endLive(); });
  // suelta un puesto trabado para que su persona vuelva desde otro iPad con su nickname
  adminOn("admin:release", ({ deviceId }) => {
    const dev = S.devices[deviceId];
    if (!dev) return "Ese dispositivo ya no existe.";
    for (const s of io.sockets.sockets.values()) if (s.data.deviceId === dev.id) { s.data.deviceId = undefined; s.emit("released"); }
    dev.online = false;
  });
  adminOn("admin:reshuffle", () => { if (S.phase !== "lobby") return "Solo antes de iniciar."; reshuffleTeams(); });
  adminOn("admin:assign", ({ deviceId, team, role }) => {
    const dev = S.devices[deviceId];
    if (!dev) return "Ese dispositivo ya no existe.";
    if (role !== undefined && ROLES.includes(role)) dev.role = role;
    if (team !== undefined) {
      const target = team === null || team === "" ? null : Number(team);
      if (target !== null && (target < 0 || target > S.teams.length)) return "Equipo inválido.";
      if (target === S.teams.length) { if (S.teams.length >= MAX_TEAMS) return "Máximo 8 equipos."; S.teams.push(newTeam()); }
      const other = target === null ? null : deviceAt(target, dev.role);
      if (other && other !== dev) other.team = dev.team; // intercambio
      dev.team = target;
    }
    const p = S.persons[dev.personId];
    if (p && S.phase === "lobby") p.history = [dev.role];
    if (S.phase === "lobby") pruneEmptyTeams();
  });
  adminOn("admin:kick", ({ deviceId }) => {
    const dev = S.devices[deviceId];
    if (!dev) return;
    if (S.phase === "rotate") return "Espera a que termine la rotación.";
    if (dev.personId) delete S.persons[dev.personId];
    if (dev.role === "modelo" && dev.team !== null) {
      S.queue = S.queue.filter((q) => q.team !== dev.team);
      if (S.live && S.live.team === dev.team) endLive();
    }
    delete S.devices[deviceId];
    delete S.questions[deviceId];
    if (S.phase === "lobby") pruneEmptyTeams();
  });
  adminOn("admin:start", () => {
    if (S.phase !== "lobby") return "La actividad ya empezó.";
    if (!S.teams.some((_, t) => CORE.every((r) => deviceAt(t, r)))) return "Se necesita al menos un equipo con Modelo y Arnés.";
    S.phase = "activity"; S.timerLeft = S.cfg.rotSec; S.paused = false;
  });
  adminOn("admin:prompt", ({ text, team }) => {
    text = cleanText(text, 600);
    if (S.phase !== "activity") return "Inicia la actividad primero.";
    if (!text) return "Escribe el prompt.";
    S.teams.forEach((_, t) => { if (team === "all" || Number(team) === t) addMsg(t, "U", authorOf(null), text); });
  });
  adminOn("admin:pause", () => {
    if (S.phase !== "activity") return "Solo durante la actividad.";
    S.paused = !S.paused;
    if (!S.paused && S.live) S.live.lastAt = Date.now(); // la pausa no cuenta para el cierre automático
  });
  adminOn("admin:addTime", ({ sec }) => { S.timerLeft = Math.max(0, S.timerLeft + (Number(sec) || 60)); });
  adminOn("admin:rotate", () => {
    if (S.phase !== "activity") return "Solo durante la actividad.";
    if (!startRotation()) return "No hay suficientes personas para rotar.";
  });
  adminOn("admin:forceResume", () => { if (S.phase !== "rotate") return; Object.keys(S.rot.assign).forEach((pid) => (S.rot.ready[pid] = true)); finishRotation(); });
  adminOn("admin:end", () => { S.phase = "end"; S.rot = null; S.paused = false; S.queue = []; S.live = null; });
  adminOn("admin:reset", () => { S = freshState(); });

  sock.on("disconnect", () => {
    const dev = myDevice();
    if (!dev) return;
    const stillHere = [...io.sockets.sockets.values()].some((s) => s !== sock && s.data.deviceId === dev.id);
    if (!stillHere) { dev.online = false; syncAdmins(); }
  });
});

// ---------- Reloj: rotación y cola del Usuario ----------
setInterval(() => {
  if (S.phase !== "activity" || S.paused) return;
  let all = liveTimeout() || serveQueue();
  if (autoRot()) {
    S.timerLeft = Math.max(0, S.timerLeft - 1);
    if (S.timerLeft === 0) { if (startRotation()) all = true; else S.timerLeft = S.cfg.rotSec; }
  }
  if (all) sync(); else syncAdmins();
}, 1000);

// ---------- Arranque ----------
loadSnapshot();
function onListening() {
  if (!process.env.SEUNAIA_SIN_MDNS) MDNS = red.anunciar(NOMBRE);
  const a = acceso();
  console.log("\n  SÉ UNA IA POR UN D-IA · servidor alpha");
  console.log(`  Creado por ${AUTHORS.join(", ")} y el equipo CREA\n`);
  console.log(`  Sesión: ${S.code}`);
  console.log(`  Clave admin: ${ADMIN_PASSWORD === "crea2026" ? "crea2026 (cámbiala en config.json)" : "(la que está en config.json)"}`);
  if (PORT !== WANTED_PORT) console.log(`  (El puerto ${WANTED_PORT} estaba ocupado; se usa el ${PORT}.)`);
  if (HOTSPOT) console.log(`\n  1) Conecta los iPads a la WiFi  ${HOTSPOT.nombre}  (clave: ${HOTSPOT.clave})`);
  // el QR lleva la dirección numérica: funciona aunque la red bloquee los nombres .local
  console.log(`\n  ${HOTSPOT ? "2) " : ""}En cada iPad escanea este código con la cámara:\n`);
  console.log(red.qrTerminal(a.qrUrl));
  console.log("\n  O escribe en Safari:");
  a.ips.forEach((x) => console.log(`     ${x.url.replace("http://", "")}${x.hotspot ? "   <- red del hotspot" : ""}`));
  console.log(`     (en algunas redes también funciona ${a.url.replace("http://", "")})`);
  console.log(`\n  Panel admin:          http://localhost${PORT === 80 ? "" : ":" + PORT}/admin`);
  console.log(`  Pantalla para proyectar (QR): http://localhost${PORT === 80 ? "" : ":" + PORT}/conectar`);
  if (!MDNS.ok && !process.env.SEUNAIA_SIN_MDNS) console.log(`  (No se pudo anunciar ${MDNS.host}: ${MDNS.error}. Usa el QR o la dirección numérica.)`);
  console.log("\n  Para apagar el servidor cierra esta ventana o presiona Ctrl+C.\n");
  if (process.argv.includes("--abrir") && process.platform === "win32") {
    require("child_process").exec(`start "" "http://localhost${PORT === 80 ? "" : ":" + PORT}/admin"`);
  }
}
server.on("listening", onListening);
server.on("error", (e) => {
  // el puerto 80 suele estar libre en Windows, pero si otro programa lo usa se cae al 3000
  if ((e.code === "EADDRINUSE" || e.code === "EACCES") && PORT === WANTED_PORT && WANTED_PORT !== FALLBACK_PORT && !process.env.PORT) {
    PORT = FALLBACK_PORT;
    return server.listen(PORT, "0.0.0.0");
  }
  if (e.code === "EADDRINUSE") console.error(`\n  El puerto ${PORT} ya está en uso: ¿el servidor ya está abierto en otra ventana?\n  Ciérrala o cambia "puerto" en config.json.\n`);
  else console.error(e);
  process.exitCode = 1;
});
server.listen(PORT, "0.0.0.0");

module.exports = { server };
