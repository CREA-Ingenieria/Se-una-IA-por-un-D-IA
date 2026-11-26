// Sé una IA por un d-IA — servidor central (alpha)
// Corre en un PC de la universidad (o en un servidor en la nube). Los celulares entran escaneando el QR
// de su sala (pantalla /conectar) o con la dirección numérica.
// VARIAS SALAS SIMULTÁNEAS en la misma dirección: cada sala tiene su propio estado, su admin, sus equipos,
// su cola del Usuario, su rotación, sus archivos y su respaldo en data/sala-<n>/sesion.json.
// Todo el estado vive en memoria; cada sala guarda un respaldo por si el servidor se reinicia.

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
// Si se despliega detrás de un dominio/proxy (p. ej. GCP + Caddy), PUBLIC_URL hace que el QR y la
// dirección que se muestra sean la URL pública real, no la IP interna del servidor.
const PUBLIC_URL = (process.env.PUBLIC_URL || FILE_CFG.publicUrl || "").replace(/\/+$/, "");
const NOMBRE = String(FILE_CFG.nombre || "seunaia").toLowerCase().replace(/[^a-z0-9-]/g, "") || "seunaia";
const HOTSPOT = process.argv.includes("--hotspot") ? { nombre: FILE_CFG.hotspotNombre || "SeUnaIA-CREA", clave: FILE_CFG.hotspotClave || "crea2026ia" } : null;
let MDNS = { ok: false, host: NOMBRE + ".local" };
const PUBLIC = path.join(__dirname, "public");
// Carpeta de datos. SEUNAIA_DATA permite separarla (p. ej. en las pruebas, para no tocar la de la actividad).
const DATA_ROOT = process.env.SEUNAIA_DATA ? path.resolve(process.env.SEUNAIA_DATA) : path.join(__dirname, "data");
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_VERSION = 4; // v4: el rol se ata a la persona (teléfono), no al asiento; los respaldos v3 no se cargan

// ---------- Salas simultáneas ----------
// Cuántas salas corren a la vez en este servidor (1 a 10; por defecto 3). Con 1 sala todo funciona como antes
// (no se pregunta la sala). Cada sala es independiente: su admin, sus equipos, su cola, su rotación, sus archivos.
const N_SALAS = Math.max(1, Math.min(10, Math.round(Number(process.env.SEUNAIA_SALAS) || Number(FILE_CFG.salas) || 3)));
const MULTI = N_SALAS > 1;
// Clave del admin de cada sala: ADMIN_PASSWORD_<n> > config.json "clavesSalas": {"1": "…"} > la clave general.
const claveDeSala = (id) => String(process.env["ADMIN_PASSWORD_" + id] || (FILE_CFG.clavesSalas && FILE_CFG.clavesSalas[id]) || ADMIN_PASSWORD);
// Nombre visible: config.json "nombresSalas": {"1": "Sala Norte"} > "Sala <n>"
const nombreDeSala = (id) => (FILE_CFG.nombresSalas && cleanText(FILE_CFG.nombresSalas[id], 24)) || "Sala " + id;

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
const MAX_TEAMS = 30; // ~90 personas (3 por equipo) POR SALA. Puestos numerados, un teléfono por persona.
// Gracia: durante los primeros ROT_GRACE_MS no damos por "ida" a una persona desconectada (puede ser un
// parpadeo de red o el celular bloqueándose en plena caminata); así no se finaliza la rotación antes de tiempo.
const ROT_GRACE_MS = Number(process.env.SEUNAIA_ROT_GRACE_MS) || 25 * 1000;
// Tope duro de seguridad: si la rotación no se completa (p. ej. alguien online que nunca marca "ya llegué"),
// se finaliza sola. Holgado para una sala grande buscando puestos numerados.
const ROT_SAFETY_MS = Number(process.env.SEUNAIA_ROT_SAFETY_MS) || 180 * 1000;
// El botón "¡Ya llegué!" no se puede tocar hasta pasado este tiempo desde que arranca la rotación,
// para que la persona camine a su puesto en vez de marcar listo al instante sin moverse.
const READY_COOLDOWN_MS = process.env.SEUNAIA_READY_COOLDOWN_MS !== undefined ? Number(process.env.SEUNAIA_READY_COOLDOWN_MS) : 6 * 1000;
const MAX_MSG = 280;
const BONUS = 10; // caracteres que gana el propio equipo por cada acierto del minijuego
const MAX_QUIZ = 3; // preguntas del minijuego por persona en cada turno (entre rotaciones)
const FILE_COST = 120; // un archivo (foto, video, audio…) ocupa lo mismo que 120 caracteres de contexto
const MAX_FILE = 80 * 1024 * 1024; // las fotos se reducen en el iPad; videos y audios suben tal cual

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

// ---------- Utilidades sin estado (compartidas por todas las salas) ----------
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cleanText = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const reply = (cb, payload) => { if (typeof cb === "function") cb(payload); };
// corre fn y, si falla, lo registra sin tumbar el servidor (ni las demás salas)
function guard(tag, fn) {
  try { return fn(); } catch (e) { console.error(`${tag} error:`, e); return undefined; }
}
// 0->A,1->B…25->Z,26->AA (estilo hoja de cálculo) para letras; idx+1 para números.
function axisLabel(style, idx) {
  if (style === "numbers") return String(idx + 1);
  let n = idx, s = "";
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
// Nomenclatura de puestos. Por defecto: letra del rol + número de equipo (M1 = Modelo del equipo 1,
// A1 su Arnés, R1 su Revisor). Si el admin define columnas (board.cols≥1), usa fila+columna (A1, B3…).
const ROLE_LETTER = { modelo: "M", arnes: "A", revisor: "R" };
const fileKind = (type) => (/^image\/(jpeg|png|gif|webp|heic|heif)$/.test(type) ? "image" : /^video\//.test(type) ? "video" : /^audio\//.test(type) ? "audio" : "file");
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Minijuego (preguntas, sin estado) ----------
// Banco fijo (QUESTIONS) + preguntas generadas con números y palabras al azar, así casi nunca se repiten.
// Cada pregunta es [texto, correcta, distractor, distractor]. Máximo MAX_QUIZ por persona en cada turno;
// cada acierto suma BONUS caracteres al contexto de su propio equipo.
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// tres números distintos y no negativos, el correcto primero; los errados van en el mismo paso
// (si la respuesta es múltiplo de 10, los distractores también) para que no se adivine por descarte
function nums(ok, spread, step = 1) {
  const set = new Set([ok]);
  while (set.size < 3) { const d = ok + pick([-1, 1]) * rnd(1, spread) * step; if (d >= 0) set.add(d); }
  return [...set].map(String);
}
const WORDS = ["el plano", "la medida", "la foto", "la orden", "el reporte", "la pregunta", "la idea", "el material", "el video", "la prueba"];
const ROLE_QS = [
  ["¿Quién es el único que puede hablar con el Usuario?", "El Modelo", "El Revisor", "El Arnés"],
  ["¿A quién le escribe el Revisor?", "Al Modelo", "Al Arnés", "Al Usuario"],
  ["¿Qué rol no escribe mensajes?", "El Arnés", "El Modelo", "El Revisor"],
  ["¿Quién ejecuta lo que dice el Modelo?", "El Arnés", "El Revisor", "El Usuario"],
  ["¿Quién describe las acciones del Arnés?", "El Revisor", "El Modelo", "El Usuario"],
  ["¿Quién puede reenviarle al Usuario una foto del Revisor?", "El Modelo", "El Arnés", "El Revisor"],
  ["El Modelo acaba de hablar con el Usuario. ¿Qué pasa si le quiere volver a escribir?", "Espera el enfriamiento", "Pasa primero en la cola", "Le escribe por el Revisor"],
  ["¿Qué ve el Arnés?", "Las órdenes del Modelo y los reportes del Revisor", "Todo lo que dice el Usuario", "Nada"],
];
const GEN = [
  () => { const lim = rnd(3, 12) * 50, used = rnd(1, lim / 10 - 1) * 10; return [`Tu equipo tiene ${lim} caracteres de contexto y ya usó ${used}. ¿Cuántos le quedan?`, ...nums(lim - used, 6, 10)]; },
  () => { const n = rnd(2, 6) * 10, k = rnd(4, 12); return [`Si cada mensaje ocupa ${n} caracteres, ¿cuántos mensajes caben en ${n * k}?`, ...nums(k, 3)]; },
  () => { const free = rnd(1, 6) * FILE_COST + rnd(0, FILE_COST - 1); return [`Una foto ocupa ${FILE_COST} caracteres de contexto. Con ${free} libres, ¿cuántas fotos caben?`, ...nums(Math.floor(free / FILE_COST), 2)]; },
  () => { const ahead = rnd(1, 4), m = rnd(1, 3); return [`Hay ${ahead} Modelo${ahead > 1 ? "s" : ""} antes que tú en la cola, cada conversación dura ${m} min y la espera mínima es 1 min. ¿Cuántos minutos esperas como mínimo?`, ...nums(1 + ahead * m, 3).map((x) => x + " min")]; },
  () => { const w = shuffle(WORDS).slice(0, 4); return [`El contexto guarda, del más viejo al más nuevo: ${w.join(", ")}. Si se llena, ¿qué se olvida primero?`, w[0], w[3], w[1]]; },
  () => { const k = rnd(3, 12); return [`Si cada palabra son unos 2 tokens, ¿cuántos tokens tiene una frase de ${k} palabras?`, ...nums(2 * k, 4)]; },
  () => { const total = rnd(4, 10) * 100, n = rnd(1, MAX_QUIZ); return [`Tu equipo tiene ${total} caracteres y acierta ${n} pregunta${n > 1 ? "s" : ""} del minijuego (+${BONUS} cada una). ¿Cuánto contexto tendrá?`, ...nums(total + n * BONUS, 3, BONUS)]; },
  () => { const msgs = rnd(3, 8), len = rnd(2, 6) * 10; return [`Tu equipo mandó ${msgs} mensajes de ${len} caracteres y una foto (${FILE_COST}). ¿Cuánto contexto usó?`, ...nums(msgs * len + FILE_COST, 4, 10)]; },
  () => pick(ROLE_QS),
];
const makeQuestion = () => (Math.random() < 0.35 ? pick(QUESTIONS) : pick(GEN)());

// ---------- Estado de una sala ----------
function freshState() {
  return {
    code: "CREA-" + Math.floor(100 + Math.random() * 900),
    phase: "lobby", // lobby | activity | rotate | end
    // queueSec: espera mínima en la cola para hablar con el Usuario · coolSec: espera tras cada conversación
    // liveSec: la conversación se cierra sola si pasa este tiempo sin mensajes
    // board: disposición física de la sala. cols=0 → se usa "PC N" (sin tablero). Con cols≥1, cada puesto
    // se nombra por fila+columna (A1, B3…), con filas/columnas en letras o números según defina el admin.
    cfg: { limit: 500, mode: "mensaje", rotSec: 300, autoRot: true, queueSec: 60, coolSec: 60, liveSec: 60, board: { cols: 0, rowStyle: "letters", colStyle: "numbers" } },
    files: {}, // fileId -> { type, name, size, team, at } (el contenido está en data/sala-<n>/archivos/<fileId>)
    devices: {}, // seatId -> { id, pc, role, team, personId } · un ASIENTO físico numerado (pc), independiente del teléfono
    persons: {}, // personId -> { id, nick, history: [], deviceId(asiento actual), browserId(su teléfono), online }
    teams: [], // [{ msgs, bonus, bonusLog, forgot, forgotTotal, sent }]
    nextPc: 1,
    nextId: 1,
    nextSeatId: 1,
    timerLeft: 300,
    paused: false,
    rot: null, // { assign: {personId: deviceId}, ready: {personId: true} }
    round: 1,
    quiz: {}, // deviceId -> { done, q, seen } preguntas del minijuego en este turno
    queue: [], // modelos esperando al Usuario: [{ team, text, at, author }]
    live: null, // conversación abierta entre el Usuario y un Modelo: { team, since, lastAt }
    startedAt: 0, // cuándo se inició la actividad (para decir a los cuántos minutos terminó cada tarea)
    // Tareas que crea el Usuario con "Nueva tarea" (no todo mensaje del Usuario es una tarea: también hay aclaraciones).
    // [{ id: 1, text, at, teams: [índices de equipo], done: { [equipo]: { at, by: "modelo"|"usuario", nick, round } } }]
    tasks: [],
  };
}
// coolFrom: cuándo terminó su última conversación con el Usuario (el enfriamiento se calcula con la config actual)
// lostU: { total, at, tasks: [ids] } mensajes del Usuario que la ventana de contexto le borró al equipo
//        (tasks: de qué tareas se perdió la instrucción original), para avisarle al Modelo
function newTeam() { return { msgs: [], bonus: 0, bonusLog: "", forgot: null, forgotTotal: 0, sent: 0, coolFrom: 0, deliverAt: 0, lostU: null }; }
// un mensaje del Usuario (profesor) al Modelo: el encargo o sus respuestas
const fromUsuario = (m) => m.ch === "U" && m.role === "profesor";

// Crea una sala independiente. Toda la lógica del juego vive dentro de este cierre y usa SU propio estado S,
// así varias salas corren a la vez sin mezclarse (ni sus equipos, ni la cola del Usuario, ni la rotación).
function createRoom(SALA) {
  const SALA_NAME = nombreDeSala(SALA);
  const PASSWORD = claveDeSala(SALA);
  const TAG = `[${SALA_NAME}]`;
  const DATA_DIR = path.join(DATA_ROOT, "sala-" + SALA);
  const SNAPSHOT = path.join(DATA_DIR, "sesion.json");
  const FILES_DIR = path.join(DATA_DIR, "archivos"); // fotos, videos, audios… que manda el Revisor
  let S = freshState();
  const adminTokens = new Set(); // un token de admin solo sirve en su propia sala
  // sockets conectados a ESTA sala (cada socket se ata a una sola sala al saludar o al entrar como admin)
  const sockets = () => [...io.sockets.sockets.values()].filter((s) => s.data.sala === SALA);

  const devList = () => Object.values(S.devices);
  const teamDevices = (t) => devList().filter((d) => d.team === t);
  const deviceAt = (t, role) => devList().find((d) => d.team === t && d.role === role);
  // Identidad: el teléfono pertenece a la PERSONA; la vista sigue a la persona a su asiento actual (person.deviceId).
  const personByBrowser = (bid) => Object.values(S.persons).find((p) => p.browserId === bid);
  const seatOfPerson = (p) => (p ? S.devices[p.deviceId] : null);
  const seatOnline = (seat) => !!(seat && seat.personId && S.persons[seat.personId] && S.persons[seat.personId].online);
  const onlineCount = () => Object.values(S.persons).filter((p) => p.online).length;
  // ¿hay alguna persona SENTADA (con puesto) conectada? Para no auto-rotar en un break aunque quede algún espectador suelto.
  const anySeatedOnline = () => seated().some((d) => S.persons[d.personId] && S.persons[d.personId].online);
  const limitOf = (t) => S.cfg.limit + S.teams[t].bonus;
  const costOf = (m) => m.text.length + (m.file ? FILE_COST : 0);
  const usedOf = (t) => S.teams[t].msgs.reduce((n, m) => n + costOf(m), 0);
  const autoRot = () => S.cfg.autoRot !== false;
  // consumo del contexto por componente (quién lo escribió), para la barra por colores
  function usedBy(t) {
    const by = {};
    S.teams[t].msgs.forEach((m) => (by[m.role] = (by[m.role] || 0) + costOf(m)));
    return by;
  }
  const hasRevisor = (t) => !!deviceAt(t, "revisor");
  // ---- Tablero físico: convierte el número de puesto (pc) en una ubicación fila+columna ----
  function seatWhere(dev) {
    if (!dev) return { label: "—", row: null, col: null, pc: null };
    const b = S.cfg.board || {};
    if (b.cols && b.cols >= 1) {
      const i = dev.pc - 1, r = Math.floor(i / b.cols), c = i % b.cols;
      const row = axisLabel(b.rowStyle, r), col = axisLabel(b.colStyle, c);
      const sep = b.rowStyle === b.colStyle ? "-" : ""; // evita ambigüedad cuando ambos son números ("2-3" en vez de "23")
      return { label: row + sep + col, row, col, pc: dev.pc };
    }
    const letter = ROLE_LETTER[dev.role] || "P";
    const num = dev.team != null ? dev.team + 1 : dev.pc; // una silla por rol por equipo → el número = el equipo
    return { label: letter + num, row: null, col: null, pc: dev.pc };
  }

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
  // file: id de un archivo ya subido por /subir (o null)
  // task: id de la tarea que este mensaje crea (solo el mensaje con que el Usuario inicia una tarea)
  function addMsg(t, ch, author, text, file, task) {
    const team = S.teams[t];
    team.msgs.push({ id: S.nextId++, ch, text, file: file || null, role: author.role, nick: author.nick, pc: author.pc, at: Date.now(), task: task || null });
    if (ch === "U" && S.live && S.live.team === t) S.live.lastAt = Date.now();
    team.sent++;
    enforce(t);
  }
  function dropMsg(team) {
    const m = team.msgs.shift();
    if (m && m.file && !fileInUse(m.file)) dropFile(m.file);
    return m;
  }
  function enforce(t) {
    const team = S.teams[t], lim = limitOf(t);
    let total = usedOf(t), removed = 0;
    while (total > lim && team.msgs.length) {
      const first = team.msgs[0];
      // se pierde (toda o parte de) una instrucción del Usuario: se cuenta una vez por mensaje para avisarle al Modelo
      if (fromUsuario(first) && !first.cut) {
        const prev = team.lostU || { total: 0, tasks: [] };
        const tasks = (prev.tasks || []).slice();
        if (first.task && !tasks.includes(first.task)) tasks.push(first.task); // se perdió el enunciado de esa tarea
        team.lostU = { total: prev.total + 1, at: Date.now(), tasks };
      }
      // un archivo no se puede recortar: se olvida completo
      if ((S.cfg.mode === "mensaje" && team.msgs.length > 1) || first.file) {
        const c = costOf(first); dropMsg(team); removed += c; total -= c;
      } else {
        const cut = Math.min(total - lim, first.text.length);
        first.text = first.text.slice(cut); first.cut = true; removed += cut; total -= cut;
        if (!first.text.length) dropMsg(team);
      }
    }
    if (removed) { team.forgot = { n: removed, at: Date.now() }; team.forgotTotal += removed; }
  }

  // ---------- Archivos del Revisor (fotos, videos, audios…) ----------
  // Se guardan en disco (carpeta de la sala) y viajan como enlace /archivo/<id>. Un archivo puede estar en varios
  // mensajes (el Modelo reenvía al Usuario lo que le mandó el Revisor); se borra cuando ya nadie lo tiene.
  function fileInUse(id) {
    return S.teams.some((tm) => tm.msgs.some((m) => m.file === id)) || S.queue.some((q) => q.file === id);
  }
  function dropFile(id) {
    delete S.files[id];
    fs.rm(path.join(FILES_DIR, id), { force: true }, () => {});
  }
  // archivos subidos que nunca se mandaron o que ya se olvidaron
  function gcFiles() {
    const old = Date.now() - 10 * 60 * 1000;
    Object.keys(S.files).forEach((id) => { if (S.files[id].at < old && !fileInUse(id)) dropFile(id); });
  }
  function wipeFiles() {
    try { fs.rmSync(FILES_DIR, { recursive: true, force: true }); } catch (_) { /* no había archivos */ }
  }
  const fileOut = (id) => {
    const f = id && S.files[id];
    return f ? { url: "/archivo/" + id, kind: fileKind(f.type), name: f.name } : null;
  };

  // ---------- Cola de los Modelos para hablar con el Usuario ----------
  // El Usuario (el admin de ESTA sala) atiende a un Modelo a la vez. Cada Modelo que le escribe entra a la cola
  // y espera al menos queueSec; además espera a que el Usuario termine con los que llegaron antes.
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
    addMsg(head.team, "U", head.author, head.text, head.file);
    return true;
  }
  function endLive() {
    if (!S.live) return;
    const team = S.teams[S.live.team];
    if (team) team.coolFrom = Date.now();
    S.live = null;
    serveQueue();
  }
  // se calcula con la config actual: si el admin cambia el enfriamiento, aplica al instante
  const coolUntilOf = (t) => (S.teams[t] && S.teams[t].coolFrom ? S.teams[t].coolFrom + S.cfg.coolSec * 1000 : 0);
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
  // El teléfono es de la persona. Si se recarga, se queda sin batería o cambia de aparato, escribe el mismo
  // nickname desde cualquier teléfono y el sistema le re-vincula su puesto actual (asiento, rol, equipo y chat).
  // Los nicknames son únicos dentro de cada sala (dos salas pueden tener a una "ana").
  const findByNick = (nick) => Object.values(S.persons).find((p) => p.nick.toLowerCase() === nick.toLowerCase());

  // ---------- Rotación ----------
  function seated() {
    // TODAS las personas sentadas en un PC con equipo (online u offline) rotan.
    // En un taller los celulares se duermen; igual deben recibir su nuevo puesto y verlo al despertar.
    // El deadlock se evita con la gracia + el tope de tiempo en checkRotationDone/el reloj, no excluyendo gente.
    return devList().filter((d) => d.team !== null && d.personId && S.persons[d.personId]);
  }
  function computeAssignment(level) {
    const devs = seated();
    const persons = shuffle(devs.map((d) => S.persons[d.personId]));
    if (!persons.length) return null; // nadie conectado para rotar: que startRotation falle (no una rotación vacía que avanza la ronda)
    const used = new Set(), res = {};
    let budget = 200000; // evita el backtracking exponencial al probar infactibilidad en salas grandes (90 personas)
    const ok = (p, d) => {
      if (d.id === p.deviceId) return devs.length === 1;
      if (level === 0) return !p.history.includes(d.role);
      if (level === 1) return d.role !== S.devices[p.deviceId].role;
      return true;
    };
    const bt = (i) => {
      if (budget-- <= 0) return false; // sin presupuesto: que caiga al siguiente nivel (el nivel 2 siempre encuentra un derangement)
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
    S.rot = { assign, ready: {}, since: Date.now() };
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
    S.rot = null; S.phase = "activity"; S.timerLeft = S.cfg.rotSec; S.round++; S.quiz = {};
    S.teams.forEach((t) => (t.deliverAt = 0)); // nueva ronda: el Arnés puede volver a entregar
  }
  function checkRotationDone() {
    if (S.phase !== "rotate") return;
    const graceOver = Date.now() - S.rot.since > ROT_GRACE_MS;
    // listo cuando cada asignado marcó "ya llegué", o —pasada la gracia— lleva desconectado y no puede marcarlo.
    // La gracia evita finalizar antes de tiempo por un parpadeo de red mientras la gente aún camina.
    const done = Object.keys(S.rot.assign).every((pid) => S.rot.ready[pid] || (graceOver && !(S.persons[pid] && S.persons[pid].online)));
    if (done) finishRotation();
  }

  // ---------- Minijuego ----------
  function quizOf(devId) { return S.quiz[devId] || (S.quiz[devId] = { done: 0, q: null, seen: [] }); }
  function questionFor(devId) {
    const z = quizOf(devId);
    if (z.done >= MAX_QUIZ) return null;
    if (!z.q) {
      let q, tries = 0;
      do q = makeQuestion(); while (z.seen.includes(q[0]) && ++tries < 30);
      z.seen.push(q[0]);
      z.q = { id: S.nextId++, text: q[0], answers: q.slice(1, 4), order: shuffle([0, 1, 2]) };
    }
    return { id: z.q.id, text: z.q.text, options: z.q.order.map((k) => ({ k, text: z.q.answers[k] })), n: z.done + 1 };
  }

  // ---------- Vistas (filtradas por rol en el servidor) ----------
  const salaInfo = () => ({ id: SALA, name: SALA_NAME, multi: MULTI });
  function deviceView(dev) {
    const base = { kind: "device", sala: salaInfo(), phase: S.phase, code: S.code, paused: S.paused, round: S.round, now: Date.now() };
    if (!dev) return { ...base, registered: false };
    const person = S.persons[dev.personId];
    const v = {
      ...base, registered: true,
      you: { pc: dev.pc, role: dev.role, team: dev.team, nick: person ? person.nick : null, where: seatWhere(dev) },
      counts: { devices: devList().length, online: onlineCount() },
    };
    if (S.phase === "rotate") {
      // person-céntrico: TÚ te levantas y vas a tu nuevo asiento; cargas su rol y su historial al llegar
      const myPid = dev.personId;
      const target = myPid != null && S.rot.assign[myPid] ? S.devices[S.rot.assign[myPid]] : null;
      v.rotation = {
        outgoing: target ? { nick: person ? person.nick : "", toPc: target.pc, toRole: target.role, where: seatWhere(target) } : null,
        me: myPid != null && S.rot.assign[myPid] ? { ready: !!S.rot.ready[myPid], readyAt: S.rot.since + READY_COOLDOWN_MS } : null,
        ready: Object.keys(S.rot.ready).length, total: Object.keys(S.rot.assign).length,
      };
    }
    if (dev.team !== null && (S.phase === "activity" || S.phase === "end")) {
      const t = dev.team, team = S.teams[t];
      v.sendTo = Object.keys(SEND_TO[dev.role]); // destinos posibles; el Arnés no escribe
      v.context = { used: usedOf(t), by: usedBy(t), limit: limitOf(t), base: S.cfg.limit, bonus: team.bonus, bonusLog: team.bonusLog, forgot: team.forgot, oldestId: team.msgs[0] ? team.msgs[0].id : null };
      v.msgs = team.msgs.filter((m) => READ[dev.role].includes(m.ch)).map((m) => msgOut(m, dev.pc));
      if (dev.role === "modelo") {
        v.usuario = { live: !!S.live && S.live.team === t, liveEndsAt: liveEndsAt(), queue: queueInfo(t), coolUntil: coolUntilOf(t), waiting: S.queue.length, queueSec: S.cfg.queueSec, coolSec: S.cfg.coolSec,
          // la ventana de contexto le borró instrucciones del Usuario (none: ya no queda ninguna en su memoria;
          // tasks: tareas cuyo enunciado ya no tiene)
          lost: team.lostU ? { total: team.lostU.total, at: team.lostU.at, none: !team.msgs.some(fromUsuario), tasks: team.lostU.tasks || [] } : null };
        // Tareas del equipo, SOLO con su número y si ya la terminó: el enunciado vive en el chat (y se puede olvidar).
        // Solo el Modelo las ve y las marca; el Arnés y el Revisor no saben cuántas tareas hay.
        v.tasks = teamTasks(t).map((k) => ({ id: k.id, done: !!k.done[t] }));
      }
      // el Revisor ve a quién debe revisar: el Arnés de su equipo (su id, p. ej. A1)
      if (dev.role === "revisor") { const a = deviceAt(t, "arnes"); v.reviewTarget = a ? seatWhere(a).label : null; }
      if (S.phase === "activity") { v.question = questionFor(dev.id); v.quizMax = MAX_QUIZ; v.quizBonus = BONUS; }
    }
    return v;
  }

  // los archivos viajan como enlace (/archivo/<id>), no dentro de la vista, para no mandar megas cada segundo
  const msgOut = (m, pc) => ({ id: m.id, ch: m.ch, text: m.text, cut: !!m.cut, role: m.role, nick: m.nick, file: fileOut(m.file), mine: pc !== undefined && m.pc === pc, task: m.task || null });
  // tareas asignadas a un equipo
  const teamTasks = (t) => (S.tasks || []).filter((k) => k.teams.includes(t));

  function adminView() {
    return {
      kind: "admin", sala: salaInfo(), salas: salasList(), phase: S.phase, code: S.code, cfg: S.cfg, paused: S.paused, round: S.round, timerLeft: S.timerLeft, acceso: acceso(SALA), now: Date.now(), maxTeams: MAX_TEAMS, startedAt: S.startedAt || 0,
      live: S.live ? { ...S.live, endsAt: liveEndsAt() } : null,
      queue: S.queue.map((q) => ({ team: q.team, text: q.text, file: !!q.file, nick: q.author.nick, readyAt: q.at + S.cfg.queueSec * 1000 })),
      devices: devList().sort((a, b) => a.pc - b.pc).map((d) => ({
        id: d.id, pc: d.pc, role: d.role, team: d.team, online: seatOnline(d), where: seatWhere(d),
        nick: d.personId && S.persons[d.personId] ? S.persons[d.personId].nick : null,
      })),
      teams: S.teams.map((tm, t) => ({
        used: usedOf(t), by: usedBy(t), limit: limitOf(t), bonus: tm.bonus, sent: tm.sent, forgotTotal: tm.forgotTotal,
        warnings: teamWarnings(t), msgs: tm.msgs.map((m) => msgOut(m)), coolUntil: coolUntilOf(t),
        lostU: tm.lostU ? { total: tm.lostU.total, none: !tm.msgs.some(fromUsuario), tasks: tm.lostU.tasks || [] } : null,
      })),
      // el admin sí ve el enunciado de cada tarea y qué equipos la terminaron
      tasks: (S.tasks || []).map((k) => ({ id: k.id, text: k.text, at: k.at, teams: k.teams, done: k.done })),
      rotation: S.rot ? Object.entries(S.rot.assign).map(([pid, did]) => ({
        nick: S.persons[pid] ? S.persons[pid].nick : "?", toPc: S.devices[did] ? S.devices[did].pc : null, ready: !!S.rot.ready[pid],
        online: !!(S.persons[pid] && S.persons[pid].online), where: S.devices[did] ? seatWhere(S.devices[did]) : null,
      })) : null,
    };
  }

  // Arma el historial de la sesión (para analizar los chats). Se entrega por el socket del admin
  // (ya autenticado), no por HTTP, para no exponer el token en la URL ni en el historial del navegador.
  // Nota: incluye lo que sigue en la ventana de contexto de cada equipo; lo ya olvidado no se guarda.
  function buildExport() {
    return {
      exportadoAt: new Date().toISOString(), sala: SALA, salaNombre: SALA_NAME, sesion: S.code, ronda: S.round, cfg: S.cfg,
      equipos: S.teams.map((tm, t) => ({
        equipo: t + 1, enviados: tm.sent, olvidados: tm.forgotTotal, bonus: tm.bonus,
        instruccionesUsuarioOlvidadas: tm.lostU ? tm.lostU.total : 0,
        tareasOlvidadas: tm.lostU ? tm.lostU.tasks || [] : [],
        mensajes: tm.msgs.map((m) => ({ id: m.id, canal: m.ch, rol: m.role, nick: m.nick, pc: m.pc, texto: m.text, archivo: m.file && S.files[m.file] ? (S.files[m.file].name || m.file) : null, at: m.at })),
      })),
      personas: Object.values(S.persons).map((p) => ({ nick: p.nick, historialRoles: p.history })),
      // cada tarea, a qué equipos se le dio y cuándo la terminó cada uno (y quién la marcó)
      tareas: (S.tasks || []).map((k) => ({
        tarea: k.id, texto: k.text, creadaAt: new Date(k.at).toISOString(), equipos: k.teams.map((t) => t + 1),
        terminadas: Object.entries(k.done).map(([t, d]) => ({ equipo: Number(t) + 1, at: new Date(d.at).toISOString(), ronda: d.round, marcadaPor: d.by === "modelo" ? "Modelo " + d.nick : "Usuario",
          minutosDesdeInicio: S.startedAt ? Math.round((d.at - S.startedAt) / 6000) / 10 : null })),
      })),
    };
  }
  // El Revisor sube un archivo (cuerpo crudo; tipo en Content-Type, nombre en X-Name, su teléfono en X-Device)
  function upload(req, res) {
    const answer = (code, body) => { if (res.headersSent) return; res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
    const fail = (code, error) => { answer(code, { error }); req.resume(); };
    const person = personByBrowser(cleanText(String(req.headers["x-device"] || ""), 64));
    const dev = seatOfPerson(person);
    if (!dev || dev.role !== "revisor" || dev.team === null || S.phase !== "activity") return fail(403, "Solo el Revisor puede mandar archivos durante la actividad.");
    const type = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) return fail(400, "Tipo de archivo no válido.");
    if (Number(req.headers["content-length"]) > MAX_FILE) return fail(413, "El archivo es muy grande (máximo 80 MB).");
    let name = "";
    try { name = cleanText(decodeURIComponent(String(req.headers["x-name"] || "")), 80); } catch (_) { /* nombre ilegible */ }
    const id = crypto.randomBytes(9).toString("hex"), file = path.join(FILES_DIR, id);
    fs.mkdirSync(FILES_DIR, { recursive: true });
    const out = fs.createWriteStream(file);
    let size = 0, failed = false;
    const abort = (code, error) => { if (failed) return; failed = true; req.unpipe(out); out.destroy(); fs.rm(file, { force: true }, () => {}); fail(code, error); };
    req.on("data", (c) => { size += c.length; if (size > MAX_FILE) abort(413, "El archivo es muy grande (máximo 80 MB)."); });
    req.on("aborted", () => abort(400, "Se cortó la subida."));
    out.on("error", () => abort(500, "No se pudo guardar el archivo."));
    out.on("finish", () => {
      if (failed) return;
      if (!size) { fs.rm(file, { force: true }, () => {}); return answer(400, { error: "El archivo está vacío." }); }
      S.files[id] = { type, name, size, team: dev.team, at: Date.now() };
      saveSoon();
      answer(200, { ok: true, id });
    });
    req.pipe(out);
  }
  // Sirve un archivo con soporte de rangos (Safari los necesita para reproducir video)
  function serveFile(req, res, id) {
    const meta = S.files[id], file = path.join(FILES_DIR, id);
    let size;
    try { size = fs.statSync(file).size; } catch (_) { size = -1; }
    if (!meta || size < 0) { res.writeHead(404); return res.end(); }
    // solo fotos, videos y audios se muestran en la página; lo demás se descarga, para que nadie suba una página web
    const kind = fileKind(meta.type), inline = kind !== "file";
    const headers = {
      "Content-Type": inline ? meta.type : "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name || "archivo")}`,
    };
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (r && (r[1] || r[2])) {
      const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2])), end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  }

  // ---------- Sincronización (solo a los sockets de esta sala) ----------
  let syncQueued = false;
  function sync() {
    if (syncQueued) return;
    syncQueued = true;
    setImmediate(() => guard(TAG + " sync", () => {
      syncQueued = false;
      const admin = adminView();
      for (const sock of sockets()) {
        if (sock.data.admin) sock.emit("view", admin);
        else if (sock.data.browserId !== undefined) sock.emit("view", deviceView(seatOfPerson(personByBrowser(sock.data.browserId))));
      }
      saveSoon();
    }));
  }
  function syncAdmins() {
    const admin = adminView();
    for (const sock of sockets()) if (sock.data.admin) sock.emit("view", admin);
  }

  // ---------- Respaldo en disco (uno por sala) ----------
  let saveTimer = null;
  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = SNAPSHOT + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ version: SNAPSHOT_VERSION, savedAt: Date.now(), sala: SALA, state: S }));
        fs.renameSync(tmp, SNAPSHOT);
      } catch (e) { console.error(`${TAG} no se pudo guardar el respaldo:`, e.message); }
    }, 2000);
  }
  function loadSnapshot() {
    if (!process.argv.includes("--nueva")) {
      try {
        const raw = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
        if (raw.version === SNAPSHOT_VERSION && Date.now() - raw.savedAt <= SNAPSHOT_MAX_AGE_MS) {
          const fresh = freshState();
          S = { ...fresh, ...raw.state, cfg: { ...fresh.cfg, ...raw.state.cfg } };
          Object.values(S.persons).forEach((p) => (p.online = false));
          console.log(`${SALA_NAME}: sesión ${S.code} recuperada del respaldo (${devList().length} dispositivos).`);
          return;
        }
      } catch (_) { /* sin respaldo: sesión nueva */ }
    }
    wipeFiles(); // sesión nueva: los archivos de la anterior ya no sirven
  }

  // ---------- Entrada a la sala ----------
  // El socket ya quedó atado a esta sala (ver io.on("connection")); aquí se vincula el teléfono a su persona.
  function hello(sock, bid, cb) {
    sock.data.browserId = bid;
    const person = personByBrowser(bid);
    if (person) person.online = true;
    reply(cb, { ok: true, sala: SALA, salaName: SALA_NAME });
    sock.emit("view", deviceView(seatOfPerson(person)));
    if (person) syncAdmins();
  }
  const checkAdmin = ({ password, token } = {}) => !!((token && adminTokens.has(token)) || (password && password === PASSWORD));
  function adminLogin(sock, { token } = {}, cb) {
    const t = token && adminTokens.has(token) ? token : crypto.randomBytes(16).toString("hex");
    adminTokens.add(t);
    sock.data.admin = true;
    reply(cb, { ok: true, token: t, sala: SALA, salaName: SALA_NAME });
    sock.emit("view", adminView());
  }

  // ---------- Eventos de un socket de esta sala ----------
  function attach(sock) {
    const isAdmin = () => sock.data.admin === true;
    const myPerson = () => personByBrowser(sock.data.browserId);
    const myDevice = () => seatOfPerson(myPerson()); // el asiento que ocupa ahora la persona de este teléfono
    // cada evento corre aislado: un error en una sala se registra y no tumba el servidor (ni las otras salas)
    const on = (ev, fn) => sock.on(ev, (...args) => {
      try { fn(...args); } catch (e) {
        console.error(`${TAG} error en "${ev}":`, e);
        reply(args[args.length - 1], { error: "Error interno del servidor. Inténtalo de nuevo." });
      }
    });

    // Volver al puesto con el mismo nickname (también se intenta solo desde "join").
    // Ya no se mueve el asiento: solo se re-vincula el teléfono (browserId) a la persona.
    function reclaim(nick) {
      const id = sock.data.browserId;
      const p = findByNick(nick);
      if (!p) return { error: `No hay nadie jugando como "${nick}" en la ${SALA_NAME}. Revisa cómo lo escribiste (o si estás en la sala correcta).` };
      const seat = S.devices[p.deviceId];
      if (!seat) return { error: "Tu puesto ya no existe. Pide al admin que te agregue de nuevo." };
      if (p.browserId === id) { p.online = true; return { ok: true, reclaimed: true, pc: seat.pc }; }
      // este teléfono ya es de OTRA persona: no crear un segundo vínculo (si no, un browserId quedaría apuntando a dos personas)
      const mine = personByBrowser(id);
      if (mine && mine !== p) return { error: `Este teléfono ya está jugando como "${mine.nick}". Pide al admin que lo libere antes de entrar con otro nickname.` };
      const elsewhere = roomOfBrowser(id);
      if (elsewhere && elsewhere.id !== SALA) return { error: `Este teléfono ya está jugando en la ${elsewhere.name}.` };
      const other = sockets().some((s) => s !== sock && s.data.browserId === p.browserId);
      if (p.online && other) return { error: `"${p.nick}" está conectado en otro dispositivo (PC ${seat.pc}). Si ese teléfono se apagó o se trabó, espera unos segundos o pide al admin que lo libere.` };
      p.browserId = id; // este teléfono pasa a ser el de la persona
      p.online = true;
      return { ok: true, reclaimed: true, pc: seat.pc };
    }
    on("reclaim", ({ nick } = {}, cb) => {
      nick = cleanText(nick, 16);
      if (!sock.data.browserId) return reply(cb, { error: "Recarga la página e inténtalo de nuevo." });
      if (!nick) return reply(cb, { error: "Escribe el nickname con el que estabas jugando." });
      const r = reclaim(nick);
      reply(cb, r);
      if (r.ok) sync();
    });

    on("join", ({ nick, role } = {}, cb) => {
      const id = sock.data.browserId;
      nick = cleanText(nick, 16);
      if (!id) return reply(cb, { error: "Recarga la página e inténtalo de nuevo." });
      if (!nick) return reply(cb, { error: "Escribe tu nickname para entrar." });
      if (!ROLES.includes(role)) return reply(cb, { error: "Escoge un rol." });
      if (personByBrowser(id)) return reply(cb, { error: "Este teléfono ya está jugando." });
      // un teléfono juega en UNA sola sala a la vez
      const elsewhere = roomOfBrowser(id);
      if (elsewhere && elsewhere.id !== SALA) return reply(cb, { error: `Este teléfono ya está jugando en la ${elsewhere.name}.` });
      if (findByNick(nick)) {
        // el nickname ya existe: si su teléfono está desconectado, es la misma persona volviendo
        const r = reclaim(nick);
        if (r.ok) { reply(cb, r); return sync(); }
        return reply(cb, { error: r.error.startsWith(`"`) ? r.error : `El nickname "${nick}" ya está en uso. Escoge otro.` });
      }
      const pid = S.nextId++;
      const seatId = "seat-" + S.nextSeatId++;
      S.persons[pid] = { id: pid, nick, history: [role], deviceId: seatId, browserId: id, online: true };
      const dev = { id: seatId, pc: S.nextPc++, role, team: null, personId: pid };
      S.devices[seatId] = dev;
      if (S.phase === "lobby") placeInTeam(dev);
      reply(cb, { ok: true });
      sync();
    });

    // El Modelo le escribe al Usuario: dentro de la conversación abierta llega al instante;
    // si no, entra a la cola (salvo que ya esté en ella o en enfriamiento)
    function toUsuario(dev, text, file, cb) {
      const t = dev.team;
      if (S.live && S.live.team === t) {
        addMsg(t, "U", authorOf(dev), text, file);
        reply(cb, { ok: true, sent: text });
        return sync();
      }
      if (queuePos(t) >= 0) return reply(cb, { error: `Ya estás en la cola del Usuario (puesto ${queuePos(t) + 1}). Espera tu turno.` });
      const left = Math.ceil((coolUntilOf(t) - Date.now()) / 1000);
      if (left > 0) return reply(cb, { error: `Debes esperar ${left} s para volver a escribirle al Usuario.` });
      S.queue.push({ team: t, text, file: file || null, at: Date.now(), author: authorOf(dev) });
      serveQueue();
      reply(cb, { ok: true, queued: queuePos(t) >= 0, pos: queuePos(t) + 1 });
      sync();
    }

    // to: Modelo → "arnes" | "usuario" · Revisor → "modelo"; file: id de un archivo subido por /subir (solo el Revisor)
    on("send", ({ text, to, file } = {}, cb) => {
      const dev = myDevice();
      text = cleanText(text, MAX_MSG);
      if (!dev || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Ahora no se puede enviar." });
      if (S.paused) return reply(cb, { error: "La actividad está en pausa." });
      const dests = SEND_TO[dev.role];
      if (!Object.keys(dests).length) return reply(cb, { error: "Tu rol no escribe: ejecutas lo que diga el Modelo." });
      if (to !== undefined && !dests[to]) return reply(cb, { error: "Tu rol no le puede escribir a ese rol." });
      const ch = dests[to || Object.keys(dests)[0]];
      if (file !== undefined && file !== null) {
        if (dev.role !== "revisor") return reply(cb, { error: "Solo el Revisor puede mandar archivos. El Modelo reenvía los del Revisor." });
        const f = S.files[file];
        if (!f || f.team !== dev.team || fileInUse(file)) return reply(cb, { error: "Ese archivo no es válido. Vuelve a escogerlo." });
      } else file = null;
      if (!text && !file) return reply(cb, { error: "Escribe algo antes de enviar." });
      if (ch === "U") return toUsuario(dev, text, null, cb);
      addMsg(dev.team, ch, authorOf(dev), text, file);
      reply(cb, { ok: true, sent: text });
      sync();
    });

    // El Modelo le reenvía al Usuario un archivo que le mandó el Revisor (con un texto opcional)
    on("forward", ({ id, text } = {}, cb) => {
      const dev = myDevice();
      if (!dev || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Ahora no se puede enviar." });
      if (S.paused) return reply(cb, { error: "La actividad está en pausa." });
      if (dev.role !== "modelo") return reply(cb, { error: "Solo el Modelo le puede reenviar archivos al Usuario." });
      const m = S.teams[dev.team].msgs.find((x) => x.id === Number(id) && x.ch === "R" && x.file);
      if (!m || !S.files[m.file]) return reply(cb, { error: "Ese archivo ya no está en tu contexto." });
      toUsuario(dev, cleanText(text, MAX_MSG), m.file, cb);
    });

    // El Arnés avisa que el trabajo está listo para entregar (único botón que puede tocar; no escribe libre)
    on("arnes:deliver", (_d = {}, cb) => {
      const dev = myDevice();
      if (!dev || dev.role !== "arnes" || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Ahora no puedes entregar." });
      if (S.paused) return reply(cb, { error: "La actividad está en pausa." });
      const team = S.teams[dev.team];
      // una sola vez por ronda: evita que el Arnés inunde el contexto del equipo con avisos y borre los mensajes reales
      if (team.deliverAt) return reply(cb, { error: "Ya avisaste que el trabajo está listo (una vez por ronda)." });
      team.deliverAt = Date.now();
      addMsg(dev.team, "C", authorOf(dev), "🏁 El Arnés avisa: el trabajo está LISTO para entregar.");
      reply(cb, { ok: true });
      sync();
    });

    // El Modelo marca una de sus tareas como terminada (el Arnés y el Revisor no pueden: no saben cuántas tareas hay)
    on("task:done", ({ task } = {}, cb) => {
      const dev = myDevice();
      if (!dev || dev.role !== "modelo" || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Solo el Modelo marca las tareas, durante la actividad." });
      if (S.paused) return reply(cb, { error: "La actividad está en pausa." });
      const k = (S.tasks || []).find((x) => x.id === Number(task));
      if (!k || !k.teams.includes(dev.team)) return reply(cb, { error: "Tu equipo no tiene esa tarea." });
      if (k.done[dev.team]) return reply(cb, { error: `Ya marcaste la Tarea ${k.id} como terminada.` });
      const person = S.persons[dev.personId];
      k.done[dev.team] = { at: Date.now(), by: "modelo", nick: person ? person.nick : "?", round: S.round };
      reply(cb, { ok: true, task: k.id });
      sync();
    });

    on("answer", ({ qid, k } = {}, cb) => {
      const dev = myDevice();
      if (!dev || dev.team === null || S.phase !== "activity") return reply(cb, { error: "Ahora no." });
      const z = S.quiz[dev.id];
      if (!z || !z.q || z.q.id !== qid) return reply(cb, { error: "Esa pregunta ya cambió." });
      const q = z.q;
      z.q = null; z.done++;
      const correct = k === 0;
      if (correct) {
        // el acierto suma al contexto del propio equipo
        const team = S.teams[dev.team], person = S.persons[dev.personId];
        team.bonus += BONUS;
        team.bonusLog = `+${BONUS} de ${person ? person.nick : "alguien"} (PC ${dev.pc})`;
      }
      reply(cb, { ok: true, correct, correctText: q.answers[0], bonus: BONUS, left: MAX_QUIZ - z.done });
      sync();
    });

    on("ready", (_data = {}, cb) => {
      // la persona de este teléfono confirma que llegó a su nuevo asiento
      const p = myPerson();
      if (!p || S.phase !== "rotate" || !(p.id in S.rot.assign)) return reply(cb, { error: "Ahora no toca marcar listo." });
      if (Date.now() - S.rot.since < READY_COOLDOWN_MS) return reply(cb, { error: "Primero ve a tu puesto; en un momento se habilita." });
      S.rot.ready[p.id] = true;
      reply(cb, { ok: true });
      checkRotationDone();
      sync();
    });

    // ----- Admin de esta sala -----
    const adminOn = (ev, fn) => on(ev, (data = {}, cb) => {
      if (!isAdmin()) return reply(cb, { error: "Solo el admin." });
      const err = fn(data);
      reply(cb, err ? { error: err } : { ok: true });
      sync();
    });

    // se puede cambiar en cualquier momento, también en plena actividad
    adminOn("admin:config", ({ limit, mode, rotSec, autoRot, queueSec, coolSec, liveSec, board }) => {
      if (board && typeof board === "object") {
        const bd = S.cfg.board;
        if (board.cols !== undefined) bd.cols = Math.max(0, Math.min(26, Math.round(Number(board.cols)) || 0));
        if (board.rowStyle === "letters" || board.rowStyle === "numbers") bd.rowStyle = board.rowStyle;
        if (board.colStyle === "letters" || board.colStyle === "numbers") bd.colStyle = board.colStyle;
      }
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
    // atender YA a un Modelo que está en la cola (abre la conversación en vivo, sin esperar la espera mínima)
    adminOn("admin:serveNow", ({ team }) => {
      if (S.phase !== "activity") return "Solo durante la actividad.";
      if (S.paused) return "La actividad está en pausa.";
      if (S.live) return "Ya hay una conversación abierta; termínala primero.";
      const i = S.queue.findIndex((q) => q.team === Number(team));
      if (i < 0) return "Ese Modelo ya no está en la cola.";
      const head = S.queue.splice(i, 1)[0];
      S.live = { team: head.team, since: Date.now(), lastAt: Date.now() };
      addMsg(head.team, "U", head.author, head.text, head.file);
    });
    // suelta un puesto trabado para que su persona vuelva desde otro teléfono con su nickname
    adminOn("admin:release", ({ deviceId }) => {
      const dev = S.devices[deviceId];
      if (!dev) return "Ese dispositivo ya no existe.";
      const p = dev.personId && S.persons[dev.personId];
      if (p) {
        for (const s of sockets()) if (s.data.browserId === p.browserId) { s.data.browserId = undefined; s.emit("released"); }
        p.online = false;
        p.browserId = null; // desvincula el teléfono viejo: si reconecta no re-ocupa el puesto; la persona vuelve con su nickname
      }
    });
    adminOn("admin:reshuffle", () => { if (S.phase !== "lobby") return "Solo antes de iniciar."; reshuffleTeams(); });
    adminOn("admin:assign", ({ deviceId, team, role }) => {
      const dev = S.devices[deviceId];
      if (!dev) return "Ese dispositivo ya no existe.";
      if (role !== undefined && ROLES.includes(role)) dev.role = role;
      if (team !== undefined) {
        const target = team === null || team === "" ? null : Number(team);
        if (target !== null && (target < 0 || target > S.teams.length)) return "Equipo inválido.";
        if (target === S.teams.length) { if (S.teams.length >= MAX_TEAMS) return `Máximo ${MAX_TEAMS} equipos.`; S.teams.push(newTeam()); }
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
      delete S.quiz[deviceId];
      if (S.phase === "lobby") pruneEmptyTeams();
    });
    adminOn("admin:start", () => {
      if (S.phase !== "lobby") return "La actividad ya empezó.";
      if (!S.teams.some((_, t) => CORE.every((r) => deviceAt(t, r)))) return "Se necesita al menos un equipo con Modelo y Arnés.";
      S.phase = "activity"; S.timerLeft = S.cfg.rotSec; S.paused = false; S.quiz = {}; S.startedAt = Date.now();
    });
    // El Usuario le escribe a todos los Modelos o a uno. Con task: true es una NUEVA TAREA (Tarea N): queda en la
    // lista de tareas de esos equipos y su Modelo la puede marcar como terminada. Sin task es una aclaración.
    adminOn("admin:prompt", ({ text, team, task }) => {
      text = cleanText(text, 600);
      if (S.phase !== "activity") return "Inicia la actividad primero.";
      if (!text) return "Escribe el prompt.";
      const targets = S.teams.map((_, t) => t).filter((t) => team === "all" || Number(team) === t);
      if (!targets.length) return "Equipo inválido.";
      let id = null;
      if (task) {
        if (!S.tasks) S.tasks = [];
        id = S.tasks.length + 1;
        S.tasks.push({ id, text, at: Date.now(), teams: targets, done: {} });
      }
      targets.forEach((t) => addMsg(t, "U", authorOf(null), text, null, id));
    });
    // El Usuario marca (o reabre, done: false) una tarea de un equipo: por si el Modelo se lo dijo en la conversación
    // o marcó terminada una tarea por error.
    adminOn("admin:taskDone", ({ team, task, done }) => {
      const t = Number(team);
      if (S.phase !== "activity" && S.phase !== "rotate") return "Solo durante la actividad.";
      const k = (S.tasks || []).find((x) => x.id === Number(task));
      if (!k || !k.teams.includes(t)) return "Ese equipo no tiene esa tarea.";
      if (done === false) { delete k.done[t]; return; }
      if (k.done[t]) return `El equipo ${t + 1} ya terminó la Tarea ${k.id}.`;
      k.done[t] = { at: Date.now(), by: "usuario", nick: "profesor", round: S.round };
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
    // "Nueva sesión" borra solo ESTA sala; las demás siguen como están
    adminOn("admin:reset", () => { S = freshState(); wipeFiles(); });
    // export por el socket autenticado (no HTTP): evita el token en la URL; devuelve el historial en el ack
    on("admin:export", (_data = {}, cb) => {
      if (!isAdmin()) return reply(cb, { error: "Solo el admin." });
      reply(cb, { ok: true, data: buildExport() });
    });

    on("disconnect", () => {
      const p = myPerson();
      if (!p) return;
      const stillHere = sockets().some((s) => s !== sock && s.data.browserId === sock.data.browserId);
      if (!stillHere) { p.online = false; syncAdmins(); }
    });
  }

  // ---------- Reloj de la sala: rotación y cola del Usuario (lo llama el reloj global cada segundo) ----------
  function tick() {
    if (S.phase === "rotate") {
      if (!S.rot) return;
      checkRotationDone(); // alguien asignado se desconectó: finaliza sin esperarlo
      if (S.phase === "rotate" && Date.now() - S.rot.since > ROT_SAFETY_MS) finishRotation(); // tope duro de seguridad
      if (S.phase !== "rotate") sync(); // la rotación terminó: avisar a todos
      return;
    }
    if (S.phase !== "activity" || S.paused) return;
    let all = liveTimeout() || serveQueue();
    if (autoRot()) {
      S.timerLeft = Math.max(0, S.timerLeft - 1);
      // auto-rotación solo si hay alguien conectado: evita que la sala rebaraje roles sola en un break con todos offline.
      // (La rotación manual del admin "Rotar ya" sí incluye a los offline, para que un celular dormido no se quede.)
      if (S.timerLeft === 0) { if (anySeatedOnline() && startRotation()) all = true; else S.timerLeft = S.cfg.rotSec; }
    }
    if (all) sync(); else syncAdmins();
  }

  loadSnapshot();
  return {
    id: SALA, name: SALA_NAME, tag: TAG, ownPassword: PASSWORD !== ADMIN_PASSWORD,
    hello, checkAdmin, adminLogin, attach, tick, gcFiles, upload, serveFile,
    hasFile: (fid) => !!S.files[fid],
    hasBrowser: (bid) => !!personByBrowser(bid),
    summary: () => ({ id: SALA, name: SALA_NAME, phase: S.phase, code: S.code, online: onlineCount() }),
    state: () => S, // solo para pruebas
  };
}

// ---------- Registro de salas ----------
const SALAS = []; // en orden: Sala 1, Sala 2…
const ROOMS = {}; // id -> sala
const salasList = () => SALAS.map((r) => r.summary());
// la sala donde juega ese teléfono (un teléfono solo juega en una sala a la vez)
const roomOfBrowser = (bid) => (bid && SALAS.find((r) => r.hasBrowser(bid))) || null;

// ---------- Cómo entran los celulares ----------
// Con varias salas, el QR y la dirección de cada sala llevan ?sala=<n>; sin sala se abre el selector.
function acceso(sala) {
  const q = sala && MULTI ? "/?sala=" + encodeURIComponent(sala) : "";
  const port = PORT === 80 ? "" : ":" + PORT;
  // desplegado tras un dominio/proxy: la URL pública manda (el QR y la dirección mostrada)
  if (PUBLIC_URL) {
    const host = PUBLIC_URL.replace(/^https?:\/\//, "");
    const url = PUBLIC_URL + q;
    return { host, url, mdns: false, ips: [{ ip: host, url, hotspot: false }], qrUrl: url, hotspot: HOTSPOT ? { nombre: HOTSPOT.nombre } : null };
  }
  const ips = red.ipv4s().map((i) => ({ ip: i.address, url: `http://${i.address}${port}${q}`, hotspot: red.isHotspotIp(i.address) }));
  // con hotspot, la IP del hotspot primero; si no, las demás primero
  ips.sort((a, b) => (HOTSPOT ? b.hotspot - a.hotspot : a.hotspot - b.hotspot));
  return { host: MDNS.host, url: `http://${MDNS.host}${port}${q}`, mdns: MDNS.ok, ips, qrUrl: ips[0] ? ips[0].url : `http://localhost${port}${q}`, hotspot: HOTSPOT ? { nombre: HOTSPOT.nombre } : null };
}

// Pantalla para proyectar en la sala: QR de la WiFi (si hay hotspot) y QR de la app.
// /conectar?sala=2 → solo el QR de la Sala 2 · /conectar (con varias salas) → un QR por sala
function conectarPage(room) {
  const paso = (n, titulo, qr, cuerpo) => `<section class="paso">${n ? `<span class="n">${n}</span>` : ""}<h2>${titulo}</h2><div class="qr">${qr}</div>${cuerpo}</section>`;
  const wifi = HOTSPOT ? paso(1, "Conéctate a la WiFi", red.qrSvg(red.wifiUri(HOTSPOT.nombre, HOTSPOT.clave)),
    `<p>Red: <b>${escHtml(HOTSPOT.nombre)}</b><br>Clave: <b>${escHtml(HOTSPOT.clave)}</b></p><p class="muted">Abre la cámara y apunta al código.</p>`) : "";
  // El QR es la vía principal: lleva la dirección numérica, que funciona aunque la red bloquee los nombres .local
  const appPaso = (r, n) => {
    const a = acceso(r ? r.id : null);
    const titulo = r && MULTI ? `Escanea para jugar · <span style="color:var(--t)">${escHtml(r.name)}</span>` : "Escanea para jugar";
    return paso(n, titulo, red.qrSvg(a.qrUrl),
      `<p class="muted">Abre la cámara y apunta al código.</p><p>O escribe en el navegador:</p><p class="host">${escHtml(a.qrUrl.replace(/^https?:\/\//, ""))}</p>${a.mdns || !PUBLIC_URL ? `<p class="muted" style="font-size:14px">En algunas redes también funciona ${escHtml(a.url.replace(/^https?:\/\//, ""))}</p>` : ""}`);
  };
  const n0 = HOTSPOT ? 2 : 1;
  const apps = room || !MULTI ? appPaso(room || SALAS[0], n0) : SALAS.map((r) => appPaso(r, null)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Conéctate${room && MULTI ? " · " + escHtml(room.name) : ""} · Sé una IA por un d-IA</title><meta http-equiv="refresh" content="60">
<link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/styles.css">
<style>
.wrap{position:relative;z-index:1;min-height:100dvh;display:flex;flex-direction:column;gap:24px;padding:24px max(16px,env(safe-area-inset-left,0px))}
.top{display:flex;justify-content:space-between;align-items:center}
.pasos{flex:1;display:flex;flex-wrap:wrap;gap:28px;align-items:stretch;justify-content:center}
.paso{flex:1 1 300px;max-width:520px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:28px;padding:28px}
.paso .n{width:48px;height:48px;border-radius:50%;background:var(--t);color:#000;display:flex;align-items:center;justify-content:center;font:900 26px var(--display)}
.paso h2{margin:0;font:700 28px var(--ui)}
.paso p{margin:0;font-size:20px;color:var(--soft)}
.paso b{color:#fff}
.qr{width:min(320px,70vw);background:#fff;border-radius:18px;padding:8px}
.qr svg{display:block;width:100%;height:auto}
.host{font:900 clamp(22px,3.2vw,44px) var(--display)!important;color:var(--t)!important;letter-spacing:-.03em;overflow-wrap:anywhere}
</style></head><body><div class="wrap">
<div class="top"><img class="logo-crea" src="/assets/crea.png" alt="CREA"><h1 class="lockup" style="font-size:0" aria-label="Sé una IA por un día"><span class="lines"><span class="dots" style="font-size:clamp(22px,3vw,40px)">SÉ UNA</span><span class="dots" style="font-size:clamp(22px,3vw,40px)">POR UN D-</span></span><span class="dots ia" style="font-size:clamp(56px,8vw,104px)">IA</span></h1><img class="logo-ua" src="/assets/uniandes-blanco.png" alt="Universidad de los Andes, Facultad de Ingeniería"></div>
<div class="pasos">${wifi}${apps}</div>
<footer class="credits">Creado por ${AUTHORS.map(escHtml).join(" · ")} y el equipo CREA · Facultad de Ingeniería, Universidad de los Andes</footer></div><script src="/fx.js"></script></body></html>`;
}

// ---------- Servidor HTTP estático ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  let u, urlPath;
  try { u = new URL(req.url, "http://x"); urlPath = decodeURIComponent(u.pathname); } catch (_) { res.writeHead(400); return res.end(); }
  if (urlPath === "/conectar" || urlPath === "/conectar/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(conectarPage(ROOMS[u.searchParams.get("sala") || ""] || null));
  }
  if (req.method === "POST" && urlPath === "/subir") {
    // el teléfono dice quién es (X-Device); su sala es la sala donde juega
    const room = roomOfBrowser(cleanText(String(req.headers["x-device"] || ""), 64));
    if (!room) { res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Solo el Revisor puede mandar archivos durante la actividad." })); return req.resume(); }
    return guard(room.tag + " subir", () => room.upload(req, res));
  }
  const fm = urlPath.match(/^\/archivo\/([0-9a-f]{18})$/);
  if (fm) {
    const room = SALAS.find((r) => r.hasFile(fm[1]));
    if (!room) { res.writeHead(404); return res.end(); }
    return guard(room.tag + " archivo", () => room.serveFile(req, res, fm[1]));
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
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });

// ---------- Salas: se crean al arrancar (cada una recupera su propio respaldo) ----------
for (let i = 1; i <= N_SALAS; i++) { const r = createRoom(String(i)); SALAS.push(r); ROOMS[r.id] = r; }

// ---------- Conexiones: cada socket se ata a UNA sala ----------
// El celular, al saludar ("hello"): si su teléfono ya juega en una sala, va a esa; si no, a la que pide (?sala=N).
// El admin, al entrar ("admin:login") con la clave de esa sala. Para cambiar de sala se recarga la página.
io.on("connection", (sock) => {
  sock.emit("salas", salasList());
  const bind = (room) => { sock.data.sala = room.id; room.attach(sock); };
  const pedida = (data) => ROOMS[String((data && data.sala) || "")] || (SALAS.length === 1 ? SALAS[0] : null);
  // un socket que todavía no escoge sala solo puede saludar o entrar como admin
  sock.onAny((ev, ...args) => {
    if (sock.data.sala || ev === "hello" || ev === "admin:login") return;
    reply(args[args.length - 1], { error: "Escoge primero tu sala." });
  });

  sock.on("hello", (data, cb) => guard("[hello]", () => {
    data = data || {};
    const bid = cleanText(data.browserId || data.deviceId, 64); // deviceId: alias de compatibilidad (bots/clientes viejos)
    if (!bid) return reply(cb, { ok: false });
    let room = sock.data.sala ? ROOMS[sock.data.sala] : null;
    if (!room) {
      // el teléfono ya juega en una sala: vuelve a esa aunque abra el QR de otra
      room = roomOfBrowser(bid) || pedida(data);
      if (!room) return reply(cb, { ok: true, sala: null, salas: salasList() }); // que escoja la sala
      bind(room);
    }
    room.hello(sock, bid, cb);
  }));

  sock.on("admin:login", (data, cb) => guard("[admin:login]", () => {
    data = data || {};
    if (sock.data.sala && data.sala && String(data.sala) !== sock.data.sala) return reply(cb, { error: "Recarga la página para cambiar de sala." });
    const room = sock.data.sala ? ROOMS[sock.data.sala] : pedida(data);
    if (!room) return reply(cb, { error: "Escoge la sala." });
    if (!room.checkAdmin(data)) return reply(cb, { error: "Clave incorrecta." });
    if (!sock.data.sala) bind(room);
    room.adminLogin(sock, data, cb);
  }));
});

// ---------- Reloj global: cada sala avanza su rotación y su cola (aislada de las demás) ----------
setInterval(() => SALAS.forEach((r) => guard(r.tag + " reloj", r.tick)), 1000);
setInterval(() => SALAS.forEach((r) => guard(r.tag + " archivos", r.gcFiles)), 60 * 1000);

// ---------- Arranque ----------
function onListening() {
  if (!process.env.SEUNAIA_SIN_MDNS) MDNS = red.anunciar(NOMBRE);
  const a = acceso(null);
  const local = `http://localhost${PORT === 80 ? "" : ":" + PORT}`;
  console.log("\n  SÉ UNA IA POR UN D-IA · servidor alpha");
  console.log(`  Creado por ${AUTHORS.join(", ")} y el equipo CREA\n`);
  if (MULTI) console.log(`  ${N_SALAS} salas simultáneas: ${SALAS.map((r) => `${r.name} (${r.summary().code})`).join(" · ")}`);
  else console.log(`  Sesión: ${SALAS[0].summary().code}`);
  const propias = SALAS.filter((r) => r.ownPassword).map((r) => r.name);
  console.log(`  Clave admin: ${ADMIN_PASSWORD === "crea2026" ? "crea2026 (cámbiala en config.json)" : "(la que está en config.json)"}${propias.length ? ` · con clave propia: ${propias.join(", ")}` : ""}`);
  if (PORT !== WANTED_PORT) console.log(`  (El puerto ${WANTED_PORT} estaba ocupado; se usa el ${PORT}.)`);
  if (HOTSPOT) console.log(`\n  1) Conecta los celulares a la WiFi  ${HOTSPOT.nombre}  (clave: ${HOTSPOT.clave})`);
  // el QR lleva la dirección numérica: funciona aunque la red bloquee los nombres .local
  console.log(`\n  ${HOTSPOT ? "2) " : ""}Escanea este código con la cámara${MULTI ? " (luego cada quien escoge su sala)" : ""}:\n`);
  console.log(red.qrTerminal(a.qrUrl));
  console.log("\n  O escribe en el navegador:");
  a.ips.forEach((x) => console.log(`     ${x.url.replace(/^https?:\/\//, "")}${x.hotspot ? "   <- red del hotspot" : ""}`));
  console.log(`     (en algunas redes también funciona ${a.url.replace(/^https?:\/\//, "")})`);
  if (MULTI) {
    console.log("\n  Directo a cada sala (cada una con su QR en /conectar?sala=N):");
    SALAS.forEach((r) => console.log(`     ${r.name}:  ${acceso(r.id).qrUrl.replace(/^https?:\/\//, "")}`));
    console.log("\n  Panel admin de cada sala:");
    SALAS.forEach((r) => console.log(`     ${r.name}:  ${local}/admin?sala=${r.id}`));
    console.log(`  Pantalla para proyectar (QR): ${local}/conectar?sala=N  ·  todas: ${local}/conectar`);
  } else {
    console.log(`\n  Panel admin:          ${local}/admin`);
    console.log(`  Pantalla para proyectar (QR): ${local}/conectar`);
  }
  if (!MDNS.ok && !process.env.SEUNAIA_SIN_MDNS) console.log(`  (No se pudo anunciar ${MDNS.host}: ${MDNS.error}. Usa el QR o la dirección numérica.)`);
  console.log("\n  Para apagar el servidor cierra esta ventana o presiona Ctrl+C.\n");
  if (process.argv.includes("--abrir") && process.platform === "win32") {
    require("child_process").exec(`start "" "${local}/admin${MULTI ? "?sala=1" : ""}"`);
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

module.exports = { server, makeQuestion, SALAS };
