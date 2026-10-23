// Prueba de humo: levanta el servidor y simula 6 iPads (2 equipos de Modelo, Arnés y Revisor) + el admin.
// Uso: npm test
process.env.PORT = process.env.PORT || "3999";
process.env.SEUNAIA_SIN_MDNS = "1";
process.argv.push("--nueva");
const { server, makeQuestion } = require("../server.js");
const { io } = require("socket.io-client");
const URL = `http://localhost:${process.env.PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FALLA ") + msg); if (!ok) fails++; };

(async () => {
  await new Promise((r) => server.listening ? r() : server.once("listening", r));
  const roles = ["modelo", "arnes", "revisor", "modelo", "arnes", "revisor"];
  const pads = [];
  for (let i = 0; i < roles.length; i++) {
    const s = io(URL, { forceNew: true });
    s.last = null; s.on("view", (v) => (s.last = v));
    await new Promise((r) => s.on("connect", r));
    await call(s, "hello", { deviceId: "ipad-" + i });
    const r = await call(s, "join", { nick: "p" + i, role: roles[i] });
    check(r.ok, `iPad ${i} entra como ${roles[i]}`);
    pads.push(s);
  }
  const otroThinking = io(URL, { forceNew: true });
  await new Promise((r) => otroThinking.on("connect", r));
  await call(otroThinking, "hello", { deviceId: "ipad-thinking" });
  check((await call(otroThinking, "join", { nick: "tk", role: "thinking" })).error, "el rol Thinking ya no existe");
  otroThinking.close();
  const admin = io(URL, { forceNew: true });
  admin.last = null; admin.on("view", (v) => (admin.last = v));
  await new Promise((r) => admin.on("connect", r));
  check((await call(admin, "admin:login", { password: "mala" })).error, "clave incorrecta rechazada");
  check((await call(admin, "admin:login", { password: process.env.ADMIN_PASSWORD || "crea2026" })).ok, "admin entra");
  await wait(100);
  check(admin.last.teams.length === 2, "se arman 2 equipos solos");
  check((await call(pads[0], "admin:start", {})).error, "un iPad no puede iniciar");
  check((await call(admin, "admin:start", {})).ok, "admin inicia");
  check((await call(admin, "admin:prompt", { text: "Construyan un puente de pasta", team: "all" })).ok, "prompt a todos");
  await wait(100);
  check(pads[0].last.msgs.some((m) => m.ch === "U"), "el Modelo ve el prompt del Usuario");
  check(!pads[1].last.msgs.some((m) => m.ch === "U") && !pads[2].last.msgs.some((m) => m.ch === "U"), "Arnés y Revisor NO ven al Usuario");

  // --- reglas de interacción ---
  check((await call(pads[1], "send", { text: "hola" })).error, "Arnés no puede escribir");
  await call(pads[0], "send", { text: "Corta 6 palitos", to: "arnes" });
  await call(pads[2], "send", { text: "El lado izquierdo se dobla", to: "modelo" });
  check((await call(pads[2], "send", { text: "Refuerza el lado izquierdo", to: "arnes" })).error, "el Revisor no le puede escribir al Arnés");
  check((await call(pads[0], "send", { text: "hola revisor", to: "revisor" })).error, "el Modelo no le puede escribir al Revisor");
  check((await call(pads[2], "send", { text: "hola usuario", to: "usuario" })).error, "el Revisor no le puede escribir al Usuario");
  await wait(100);
  const chs = (p) => [...new Set(p.last.msgs.map((m) => m.ch))].sort().join("");
  check(chs(pads[1]) === "CR", "Arnés ve las órdenes del Modelo (C) y lo que el Revisor le manda al Modelo (R): " + chs(pads[1]));
  check(chs(pads[0]) === "CRU", "Modelo ve Usuario, sus órdenes y la retroalimentación del Revisor: " + chs(pads[0]));
  check(chs(pads[2]) === "R", "Revisor solo ve lo que él le escribe al Modelo: " + chs(pads[2]));
  check(!pads[2].last.msgs.some((m) => m.role === "modelo"), "al Revisor no le llega ningún mensaje del Modelo");
  check(!pads[3].last.msgs.some((m) => m.ch === "C"), "el otro equipo no ve estos mensajes");
  const by = pads[0].last.context.by;
  check(by.profesor > 0 && by.modelo > 0 && by.revisor > 0 && by.profesor + by.modelo + by.revisor === pads[0].last.context.used, "la barra de contexto se reparte por componente");

  // --- cola del Usuario y enfriamiento ---
  await call(admin, "admin:config", { queueSec: 1, coolSec: 3 });
  const q0 = await call(pads[0], "send", { text: "¿De qué largo el puente?", to: "usuario" });
  const q1 = await call(pads[3], "send", { text: "¿Podemos usar cinta?", to: "usuario" });
  check(q0.queued && q0.pos === 1 && q1.queued && q1.pos === 2, "dos Modelos entran a la cola en orden");
  check((await call(pads[0], "send", { text: "otra", to: "usuario" })).error, "un Modelo en cola no puede volver a hacer fila");
  await wait(100);
  check(!pads[0].last.msgs.some((m) => m.text === "¿De qué largo el puente?"), "mientras espera, el Usuario no recibe el mensaje");
  await wait(2200);
  check(admin.last.live && admin.last.live.team === 0, "pasado el tiempo de cola, el Usuario atiende al Modelo 1");
  check(admin.last.queue.length === 1 && admin.last.queue[0].team === 1, "el Modelo 2 sigue esperando a que termine la conversación con el 1");
  check(pads[0].last.usuario.live && pads[0].last.msgs.some((m) => m.text === "¿De qué largo el puente?"), "el Modelo 1 ve que lo atienden");
  check((await call(pads[0], "send", { text: "¿y de ancho?", to: "usuario" })).ok, "en la conversación el Modelo escribe sin cola");
  check((await call(admin, "admin:reply", { team: 0, text: "40 cm de largo, 10 de ancho" })).ok, "el Usuario responde al Modelo");
  await wait(100);
  const u0 = pads[0].last.msgs.filter((m) => m.ch === "U").map((m) => m.text);
  check(u0.includes("¿y de ancho?") && u0.includes("40 cm de largo, 10 de ancho"), "los mensajes de la conversación llegan al instante");
  check((await call(admin, "admin:endLive", {})).ok, "el Usuario termina la conversación");
  await wait(100);
  check(admin.last.live && admin.last.live.team === 1 && admin.last.queue.length === 0, "al terminar, pasa de inmediato el Modelo 2");
  const cool = await call(pads[0], "send", { text: "una más", to: "usuario" });
  check(cool.error && /esperar/.test(cool.error), "el Modelo 1 queda en enfriamiento: " + cool.error);
  await call(admin, "admin:config", { liveSec: 1 });
  await wait(2200);
  check(admin.last.live === null, "si nadie escribe, la conversación se cierra sola");
  check(admin.last.teams[1].coolUntil > Date.now(), "el cierre automático también deja al Modelo en enfriamiento");
  check((await call(pads[3], "send", { text: "¿otra?", to: "usuario" })).error, "en enfriamiento no puede volver a escribir");
  await call(admin, "admin:config", { coolSec: 0, queueSec: 0, liveSec: 60 });
  await wait(100);
  check(admin.last.teams[1].coolUntil <= Date.now() && admin.last.teams[0].coolUntil <= Date.now(), "si el admin quita el enfriamiento, aplica al instante");
  check((await call(pads[3], "send", { text: "¿otra?", to: "usuario" })).ok, "el Modelo ya puede escribir sin esperar la rotación");
  await call(admin, "admin:config", { coolSec: 120 });
  await wait(100);
  check(admin.last.live && admin.last.live.team === 1, "con cola en 0 lo atienden de inmediato");
  await call(admin, "admin:endLive", {});
  await wait(100);
  check(pads[3].last.usuario.coolUntil - Date.now() > 100 * 1000, "subir el enfriamiento también aplica al instante");
  await call(admin, "admin:config", { coolSec: 0 });

  await call(admin, "admin:config", { limit: 100 });
  await call(pads[0], "send", { text: "x".repeat(90), to: "arnes" });
  await wait(100);
  check(pads[0].last.context.used <= 100, "ventana de contexto borra lo más viejo (" + pads[0].last.context.used + "/100)");

  // --- minijuego ---
  const bank = Array.from({ length: 2000 }, makeQuestion);
  check(bank.every((x) => x.length === 4 && x.every((s) => typeof s === "string" && s) && new Set(x.slice(1)).size === 3), "el banco de preguntas genera preguntas con 3 respuestas distintas");
  check(new Set(bank.map((x) => x[0])).size > 300, "el banco se expande: " + new Set(bank.map((x) => x[0])).size + " preguntas distintas en 2000");
  const q = pads[0].last.question;
  check(q && q.n === 1, "el minijuego muestra la pregunta 1 de " + pads[0].last.quizMax);
  const r = await call(pads[0], "answer", { qid: q.id, k: 0 });
  await wait(100);
  check(r.correct && pads[0].last.context.limit === 110, "un acierto da +10 al propio equipo (límite " + pads[0].last.context.limit + ")");
  check(pads[3].last.context.limit === 100, "el otro equipo no gana nada");
  for (let i = 0; i < 2; i++) { const qq = pads[0].last.question; await call(pads[0], "answer", { qid: qq.id, k: 1 }); await wait(80); }
  check(pads[0].last.question === null && pads[0].last.context.limit === 110, "máximo 3 preguntas por turno (las erradas no suman)");
  check((await call(pads[0], "answer", { qid: q.id, k: 0 })).error, "no se puede responder una cuarta");

  // --- contexto base y rotación se cambian en plena actividad ---
  await call(admin, "admin:config", { limit: 600 });
  await wait(100);
  check(pads[0].last.context.base === 600 && pads[0].last.context.limit === 610, "el admin cambia el contexto base en vivo (600 + 10 del minijuego)");
  await call(admin, "admin:config", { autoRot: false });
  await call(admin, "admin:setTimer", { sec: 90 });
  await wait(2200);
  check(admin.last.timerLeft === 90 && admin.last.cfg.autoRot === false, "con la rotación detenida el reloj no corre");
  await call(admin, "admin:config", { autoRot: true });

  // --- archivos del Revisor (fotos, videos, audios…) y reenvío al Usuario ---
  const jpg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  const up = (dev, body, type, name) => fetch(`${URL}/subir`, { method: "POST", headers: { "Content-Type": type, "X-Device": dev, "X-Name": encodeURIComponent(name) }, body }).then((x) => x.json());
  const foto = await up("ipad-2", jpg, "image/jpeg", "foto.jpg");
  check(!!foto.id, "el Revisor sube una foto");
  check(!!(await up("ipad-0", jpg, "image/jpeg", "x.jpg")).error, "el Modelo no puede subir archivos");
  check((await call(pads[2], "send", { text: "así va", to: "modelo", file: foto.id })).ok, "Revisor manda la foto al Modelo");
  const video = await up("ipad-2", Buffer.alloc(5000, 1), "video/mp4", "avance.mp4");
  const audio = await up("ipad-2", Buffer.alloc(800, 2), "audio/mp4", "nota.m4a");
  check((await call(pads[2], "send", { text: "video", to: "modelo", file: video.id })).ok && (await call(pads[2], "send", { text: "", to: "modelo", file: audio.id })).ok, "Revisor manda un video y un audio");
  check((await call(pads[2], "send", { text: "otra vez", to: "modelo", file: foto.id })).error, "un archivo ya enviado no se puede volver a mandar");
  await wait(100);
  const kinds = pads[0].last.msgs.filter((m) => m.file).map((m) => m.file.kind).sort().join(",");
  check(kinds === "audio,image,video", "el Modelo recibe foto, video y audio: " + kinds);
  check(pads[1].last.msgs.filter((m) => m.file).length === 3, "el Arnés también los ve");
  const ph = pads[0].last.msgs.find((m) => m.file && m.file.kind === "image"), vm = pads[0].last.msgs.find((m) => m.file && m.file.kind === "video");
  const res = await fetch(URL + ph.file.url);
  check(res.status === 200 && res.headers.get("content-type") === "image/jpeg", "la foto se descarga por /archivo");
  const rr = await fetch(URL + vm.file.url, { headers: { Range: "bytes=0-99" } });
  check(rr.status === 206 && rr.headers.get("content-range") === "bytes 0-99/5000", "el video se sirve por partes (Safari lo necesita)");
  const web = await up("ipad-2", Buffer.from("<script>alert(1)</script>"), "text/html", "x.html");
  const wr = await fetch(`${URL}/archivo/${web.id}`);
  check(wr.headers.get("content-type") === "application/octet-stream" && /attachment/.test(wr.headers.get("content-disposition")), "un archivo que no es foto, video ni audio se descarga, no se abre como página");
  check((await call(pads[0], "send", { text: "x", to: "arnes", file: foto.id })).error, "el Modelo no manda archivos propios");
  check((await call(pads[2], "forward", { id: vm.id })).error, "solo el Modelo reenvía al Usuario");
  const fw = await call(pads[0], "forward", { id: vm.id, text: "mire el avance" });
  await wait(100);
  check(fw.ok && admin.last.teams[0].msgs.some((m) => m.ch === "U" && m.file && m.file.kind === "video" && m.text === "mire el avance"), "el Modelo le reenvía el video al Usuario");
  check(!pads[2].last.msgs.some((m) => m.ch === "U"), "el Revisor no ve lo que el Modelo le reenvía al Usuario");
  await call(admin, "admin:endLive", {});

  // --- reconexión por nickname ---
  const otro = io(URL, { forceNew: true });
  await new Promise((r) => otro.on("connect", r));
  await call(otro, "hello", { deviceId: "otro-ipad" });
  check((await call(otro, "join", { nick: "P1", role: "modelo" })).error, "no se puede usar el nickname de alguien conectado");
  const pc5 = pads[5].last.you.pc;
  pads[5].close();
  await wait(200);
  const nuevo = io(URL, { forceNew: true });
  nuevo.last = null; nuevo.on("view", (v) => (nuevo.last = v));
  await new Promise((r) => nuevo.on("connect", r));
  await call(nuevo, "hello", { deviceId: "ipad-reemplazo" });
  const rc = await call(nuevo, "reclaim", { nick: "p5" });
  await wait(100);
  check(rc.ok && nuevo.last.you.pc === pc5 && nuevo.last.you.nick === "p5", "p5 vuelve a su PC " + pc5 + " desde otro iPad");
  pads[5] = nuevo;
  otro.close();

  check((await call(admin, "admin:rotate", {})).ok, "admin dispara la rotación");
  await wait(100);
  const rots = pads.map((p) => p.last.rotation);
  check(rots.every((x) => x && x.outgoing && x.incoming), "cada PC dice a dónde ir y quién llega");
  const before = pads.map((p) => p.last.you.role);
  for (let i = 0; i < pads.length; i++) await call(pads[i], "ready", { personId: rots[i].incoming.id });
  await wait(150);
  check(pads[0].last.phase === "activity", "con todos listos la actividad sigue");
  const moved = pads.every((p, i) => p.last.you.nick !== "p" + i);
  check(moved, "todas las personas cambiaron de PC");
  const roleOfNick = {};
  pads.forEach((p) => (roleOfNick[p.last.you.nick] = p.last.you.role));
  check(Object.entries(roleOfNick).every(([nick, role]) => role !== before[+nick.slice(1)]), "nadie repite rol");
  check(pads.every((p) => p.last.question && p.last.question.n === 1), "tras rotar, el minijuego vuelve a tener 3 preguntas");
  pads.forEach((p) => p.close()); admin.close();
  server.close();
  console.log(fails ? `\n${fails} prueba(s) fallaron` : "\nTodo bien.");
  process.exit(fails ? 1 : 0);
})();
