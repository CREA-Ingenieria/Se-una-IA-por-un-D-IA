// Prueba de humo: levanta el servidor y simula 8 iPads + el admin.
// Uso: npm test
process.env.PORT = process.env.PORT || "3999";
process.env.SEUNAIA_SIN_MDNS = "1";
process.argv.push("--nueva");
const { server } = require("../server.js");
const { io } = require("socket.io-client");
const URL = `http://localhost:${process.env.PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FALLA ") + msg); if (!ok) fails++; };

(async () => {
  await new Promise((r) => server.listening ? r() : server.once("listening", r));
  const roles = ["thinking", "modelo", "arnes", "revisor", "thinking", "modelo", "arnes", "revisor"];
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
  check(pads[0].last.msgs.some((m) => m.ch === "A"), "Thinking ve el prompt");
  check(!pads[1].last.msgs.some((m) => m.ch === "A"), "Modelo NO ve el prompt");
  check((await call(pads[2], "send", { text: "hola" })).error, "Arnés no puede escribir");
  await call(pads[0], "send", { text: "Plan: base en triángulos" });
  await call(pads[1], "send", { text: "Corta 6 palitos" });
  await wait(100);
  check(pads[2].last.msgs.length === 1 && pads[2].last.msgs[0].ch === "C", "Arnés solo ve el canal C");
  check(pads[3].last.msgs.some((m) => m.ch === "C"), "Revisor ve el canal C");
  check(!pads[4].last.msgs.some((m) => m.ch === "B"), "el otro equipo no ve estos mensajes");
  await call(admin, "admin:config", { limit: 100 });
  await call(pads[0], "send", { text: "x".repeat(90) });
  await wait(100);
  check(pads[0].last.context.used <= 100, "ventana de contexto borra lo más viejo (" + pads[0].last.context.used + "/100)");
  const q = pads[0].last.question;
  const r = await call(pads[0], "answer", { qid: q.id, k: 1 });
  await wait(100);
  check(r.correct && pads[4].last.context.limit === 140, "acierto da +40 al vecino de mesa (límite " + pads[4].last.context.limit + ")");
  check(pads[0].last.context.limit === 100, "el que acierta no gana para sí");

  // --- contexto base y rotación se cambian en plena actividad ---
  await call(admin, "admin:config", { limit: 600 });
  await wait(100);
  check(pads[0].last.context.base === 600 && pads[0].last.context.limit === 600, "el admin cambia el contexto base en vivo");
  await call(admin, "admin:config", { autoRot: false });
  await call(admin, "admin:setTimer", { sec: 90 });
  await wait(2200);
  check(admin.last.timerLeft === 90 && admin.last.cfg.autoRot === false, "con la rotación detenida el reloj no corre");
  await call(admin, "admin:config", { autoRot: true });

  // --- Thinking: todo sale como pregunta ---
  await call(pads[0], "send", { text: "usamos cinta en las uniones." });
  await wait(100);
  const q1 = pads[1].last.msgs.filter((m) => m.ch === "B").pop();
  check(q1 && q1.text === "¿usamos cinta en las uniones?", "Thinking: se agregan ¿ ? solos (" + (q1 && q1.text) + ")");

  // --- Revisor ↔ Usuario (canal E) ---
  check((await call(pads[3], "send", { text: "¿Puede ser de 40 cm?", to: "profesor" })).ok, "Revisor le escribe al Usuario");
  await wait(100);
  check(admin.last.teams[0].waiting === true, "el admin ve que el Revisor espera respuesta");
  check(!pads[0].last.msgs.some((m) => m.ch === "E"), "Thinking no ve el canal Revisor↔Usuario");
  check((await call(admin, "admin:reply", { team: 0, text: "Sí, hasta 40 cm" })).ok, "el admin responde al Revisor");
  await wait(100);
  check(pads[3].last.msgs.some((m) => m.ch === "E" && m.role === "profesor"), "el Revisor ve la respuesta");
  check(admin.last.teams[0].waiting === false, "ya no aparece como pendiente");

  // --- fotos del Revisor ---
  const jpg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  check((await call(pads[3], "send", { text: "así va", to: "thinking", image: jpg })).ok, "Revisor manda una foto a Thinking");
  await wait(100);
  const ph = pads[0].last.msgs.find((m) => m.img);
  check(!!ph, "Thinking recibe la foto");
  const res = ph ? await fetch(`${URL}${ph.img}`) : null;
  check(res && res.status === 200 && res.headers.get("content-type") === "image/jpeg", "la foto se descarga por /img");
  check((await call(pads[1], "send", { text: "x", image: jpg })).error, "el Modelo no puede mandar fotos");

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
  pads.forEach((p) => p.close()); admin.close();
  server.close();
  console.log(fails ? `\n${fails} prueba(s) fallaron` : "\nTodo bien.");
  process.exit(fails ? 1 : 0);
})();
