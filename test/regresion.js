// Regresión del rediseño de dinámica (rol atado a la persona / celulares personales).
// Cubre los daños que encontró el harm-review y que el smoke no cazaba:
//   F1 rotación no se congela si alguien está offline · F4 ventana de gracia (no finaliza antes de tiempo)
//   F2 "liberar" desvincula el teléfono viejo · F3 guard de propiedad en reclaim
//   F6 export por socket (no HTTP, sin token en URL) · F7 no hay rotación "vacía" con todos offline
// Uso: node test/regresion.js  (o npm test, que corre smoke y luego este)
process.env.PORT = process.env.PORT || "3998";
process.env.SEUNAIA_SIN_MDNS = "1";
// gracia/tope cortos para poder probar los tiempos rápido (en producción son 25s/180s)
process.env.SEUNAIA_ROT_GRACE_MS = "800";
process.env.SEUNAIA_ROT_SAFETY_MS = "4000";
process.env.SEUNAIA_READY_COOLDOWN_MS = "300";
// Modo de UNA sala: cubre la compatibilidad (clientes y bots que no mandan la sala). Las salas simultáneas
// se prueban en test/salas.js y el smoke corre en la Sala 2 de un servidor de 3 salas.
process.env.SEUNAIA_SALAS = "1";
// carpeta de datos temporal: las pruebas no tocan los respaldos de una actividad real
process.env.SEUNAIA_DATA = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "seunaia-regresion-"));
process.argv.push("--nueva");
const { server } = require("../server.js");
const { io } = require("socket.io-client");
const URL = `http://localhost:${process.env.PORT}`;
const PW = process.env.ADMIN_PASSWORD || "crea2026";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((r) => s.timeout(6000).emit(ev, d || {}, (err, res) => r(err ? { error: "timeout" } : (res || {}))));
let fails = 0;
const check = (ok, msg) => { console.error((ok ? "  ok   " : "  FALLA ") + msg); if (!ok) fails++; };
// engancha "connect" al crear el socket (si no, en localhost puede conectar antes de que up() escuche → cuelga)
function mk() { const s = io(URL, { forceNew: true, reconnection: false }); s.last = null; s.on("view", (v) => (s.last = v)); s.ready = new Promise((res) => s.once("connect", res)); return s; }
async function up(s) { await s.ready; }
const phaseOf = (s) => s.last && s.last.phase;

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const roles = ["modelo", "arnes", "revisor", "modelo", "arnes", "revisor"];
  const ps = [];
  for (let i = 0; i < 6; i++) { const s = mk(); await up(s); await call(s, "hello", { browserId: "f-" + i }); await call(s, "join", { nick: "n" + i, role: roles[i] }); ps.push(s); }
  const admin = mk(); await up(admin); await call(admin, "admin:login", { password: PW });
  await call(admin, "admin:start", {}); await wait(100);
  const readyOnline = async (except = -1) => { for (let i = 0; i < 6; i++) if (i !== except && ps[i].last && ps[i].last.rotation && ps[i].last.rotation.me) await call(ps[i], "ready", {}); };

  // F1 + caso base: todos online marcan listo → termina de inmediato (gracia irrelevante)
  check((await call(admin, "admin:rotate", {})).ok, "dispara rotación (6 online)");
  await wait(400); await readyOnline(); // esperar más que el cooldown del botón (300ms en el test)
  let back = false; for (let k = 0; k < 15 && !back; k++) { await wait(60); back = phaseOf(ps[0]) === "activity"; }
  check(back, "con todos listos la rotación termina de inmediato");

  // F4: un asignado parpadea; NO debe finalizar durante la gracia, y luego termina sola (sin forceResume)
  check((await call(admin, "admin:rotate", {})).ok, "dispara otra rotación");
  await wait(150);
  ps[5].close(); await wait(250);           // offline, dentro de la gracia (800ms)
  await readyOnline(5);                       // los otros 5 marcan listo
  await wait(150);
  check(phaseOf(ps[0]) === "rotate", "F4: NO finaliza antes de tiempo (la gracia protege al que parpadea)");
  let back2 = false; for (let k = 0; k < 40 && !back2; k++) { await wait(100); back2 = phaseOf(ps[0]) === "activity"; }
  check(back2, "F1/F4: pasada la gracia la rotación termina sola (no se congela)");
  // reponer ps[5]
  ps[5] = mk(); await up(ps[5]); await call(ps[5], "hello", { browserId: "f-5b" }); await call(ps[5], "reclaim", { nick: "n5" }); await wait(100);

  // F2: admin:release desvincula el teléfono viejo (no re-ocupa) y la persona vuelve desde otro teléfono
  const seatId = admin.last.devices.find((d) => d.nick === "n0").id;
  check((await call(admin, "admin:release", { deviceId: seatId })).ok, "F2: admin libera el puesto de n0");
  await wait(100);
  const viejo = mk(); await up(viejo); await call(viejo, "hello", { browserId: "f-0" }); await wait(100);
  check(viejo.last && viejo.last.registered === false, "F2: el teléfono viejo ya no re-ocupa el puesto (ve el inicio)");
  const nuevo = mk(); await up(nuevo); await call(nuevo, "hello", { browserId: "f-0b" });
  check((await call(nuevo, "reclaim", { nick: "n0" })).ok, "F2: n0 vuelve con su nickname desde otro teléfono");
  viejo.close(); nuevo.close();

  // F3: reclaim no vincula un teléfono que ya es de otra persona (evita doble vínculo → chat equivocado)
  ps[1].close(); await wait(250);
  const r3 = await call(ps[2], "reclaim", { nick: "n1" }); // ps[2] (dueño de f-2) intenta volverse n1
  check(!!r3.error, "F3: reclaim rechazado cuando el teléfono ya es de otra persona");

  // F6: export por el socket autenticado (no HTTP, sin token en URL)
  const ex = await call(admin, "admin:export", {});
  check(ex.ok && ex.data && Array.isArray(ex.data.equipos) && Array.isArray(ex.data.personas), "F6: admin:export devuelve el historial por el socket");
  const exBad = await call(ps[0], "admin:export", {});
  check(!!exBad.error, "F6: un jugador no puede exportar");
  const httpStatus = await fetch(URL + "/export?token=x").then((r) => r.status).catch(() => "err");
  check(httpStatus === 404, "F6: el endpoint HTTP /export ya no existe (status " + httpStatus + ")");

  // F7: los jugadores OFFLINE también rotan (un celular dormido NO se queda en su puesto). Era el bug visto en vivo.
  await call(admin, "admin:reset", {}); await wait(100);
  const g = [];
  for (let i = 0; i < 3; i++) { const s = mk(); await up(s); await call(s, "hello", { browserId: "g-" + i }); await call(s, "join", { nick: "g" + i, role: roles[i] }); g.push(s); }
  await call(admin, "admin:start", {}); await wait(120);
  const seatBefore = {}; admin.last.devices.forEach((d) => { if (d.nick) seatBefore[d.nick] = d.pc; });
  g.forEach((s) => s.close()); await wait(300); // los 3 celulares se "duermen" (offline)
  check((await call(admin, "admin:rotate", {})).ok, "F7: se puede rotar aunque los celulares estén offline");
  let rotDone = false; for (let k = 0; k < 40 && !rotDone; k++) { await wait(100); rotDone = admin.last.phase === "activity"; }
  check(rotDone, "F7: la rotación se completa sola pasada la gracia (no se congela)");
  const seatAfter = {}; admin.last.devices.forEach((d) => { if (d.nick) seatAfter[d.nick] = d.pc; });
  check(["g0", "g1", "g2"].every((n) => seatAfter[n] != null && seatAfter[n] !== seatBefore[n]), "F7: cada jugador offline cambió de puesto (rotó, no se quedó en el mismo)");

  // F8: tablero físico (fila+columna). Puestos por orden de llegada, mapeo row-major.
  await call(admin, "admin:reset", {}); await wait(100);
  const bd = [];
  for (let i = 0; i < 5; i++) { const s = mk(); await up(s); await call(s, "hello", { browserId: "bd-" + i }); await call(s, "join", { nick: "q" + i, role: roles[i % 3] }); bd.push(s); }
  await wait(150);
  const labels = () => admin.last.devices.slice().sort((a, c) => a.pc - c.pc).map((d) => d.where.label).join(" ");
  check(labels() === "M1 A1 R1 M2 A2", "F8: sin tablero los puestos van por rol+equipo (M1 A1 R1 M2 A2)");
  await call(admin, "admin:config", { board: { cols: 4, rowStyle: "letters", colStyle: "numbers" } });
  await wait(150);
  check(labels() === "A1 A2 A3 A4 B1", "F8: con 4 columnas (fila letras, col números) → A1 A2 A3 A4 B1 (row-major)");
  check(bd[0].last.you.where.label === "A1" && bd[0].last.you.where.row === "A" && bd[0].last.you.where.col === "1", "F8: cada jugador ve su fila y columna");
  await call(admin, "admin:config", { board: { cols: 3, rowStyle: "numbers", colStyle: "numbers" } });
  await wait(150);
  check(labels() === "1-1 1-2 1-3 2-1 2-2", "F8: ambos números usan separador (1-1…) para no ser ambiguo");
  bd.forEach((s) => s.close());

  // F9: cambios de la reunión — id del revisado, botón entregar, atender en cola (bug), cooldown del listo
  await call(admin, "admin:reset", {}); await wait(100);
  const fm = mk(), fa = mk(), fr = mk();
  await up(fm); await call(fm, "hello", { browserId: "fm" }); await call(fm, "join", { nick: "Mod", role: "modelo" });
  await up(fa); await call(fa, "hello", { browserId: "fa" }); await call(fa, "join", { nick: "Arn", role: "arnes" });
  await up(fr); await call(fr, "hello", { browserId: "fr" }); await call(fr, "join", { nick: "Rev", role: "revisor" });
  await call(admin, "admin:start", {}); await wait(150);
  check(fr.last.reviewTarget === "A1", "F9: el Revisor ve el id del Arnés que revisa (A1)", "reviewTarget=" + fr.last.reviewTarget);
  check((await call(fa, "arnes:deliver", {})).ok, "F9: el Arnés puede entregar (botón nuevo)");
  await wait(150);
  check((fm.last.msgs || []).some((x) => /LISTO para entregar/.test(x.text || "")), "F9: el aviso de entrega llega al Modelo (canal C)");
  check(!!(await call(fa, "arnes:deliver", {})).error, "F9: no se puede entregar dos veces en la misma ronda (no inunda el contexto)");
  await call(admin, "admin:config", { queueSec: 60 }); await wait(100);
  await call(fm, "send", { text: "Usuario, vamos bien?", to: "usuario" }); await wait(300);
  check(!admin.last.live && admin.last.queue.length === 1, "F9: con espera>0 el Modelo queda en la cola (no en vivo)");
  check((await call(admin, "admin:serveNow", { team: 0 })).ok, "F9: el admin atiende AHORA a un Modelo en cola");
  await wait(200);
  check(admin.last.live && admin.last.live.team === 0, "F9: se abre la conversación (fix: el Usuario ya puede responder en cola)");
  check((await call(admin, "admin:reply", { team: 0, text: "Van muy bien" })).ok, "F9: el Usuario responde en la conversación abierta");
  await call(admin, "admin:endLive", {});
  await call(admin, "admin:rotate", {}); await wait(80);
  check(!!(await call(fm, "ready", {})).error, "F9: el botón '¡Ya llegué!' tiene cooldown (rechaza al instante)");
  await wait(400);
  check((await call(fm, "ready", {})).ok, "F9: pasado el cooldown ya se puede marcar listo");
  fm.close(); fa.close(); fr.close();

  // F10: arreglos del harm-review — serveNow no abre conversación en pausa; no auto-rota con todos offline
  await call(admin, "admin:reset", {}); await wait(100);
  const hm = mk(), ha = mk();
  await up(hm); await call(hm, "hello", { browserId: "hm" }); await call(hm, "join", { nick: "HMod", role: "modelo" });
  await up(ha); await call(ha, "hello", { browserId: "ha" }); await call(ha, "join", { nick: "HArn", role: "arnes" });
  await call(admin, "admin:start", {});
  await call(admin, "admin:config", { queueSec: 60 }); await wait(100);
  await call(hm, "send", { text: "usuario?", to: "usuario" }); await wait(200);
  await call(admin, "admin:pause", {}); await wait(100);
  check(!!(await call(admin, "admin:serveNow", { team: 0 })).error && !admin.last.live, "F10[0]: serveNow en pausa se rechaza (no abre conversación fantasma que congele la cola)");
  await call(admin, "admin:pause", {}); await wait(100); // reanudar
  // [1] auto-rotación NO dispara si el único conectado es un espectador SIN puesto (los sentados están offline)
  const haSeatId = admin.last.devices.find((d) => d.nick === "HArn").id;
  await call(admin, "admin:assign", { deviceId: haSeatId, team: null }); // HArn queda sin equipo pero sigue online
  hm.close(); await wait(300); // el Modelo (sentado) se va offline; HArn online pero sin puesto
  const roundB = admin.last.round;
  await call(admin, "admin:setTimer", { sec: 5 });
  await wait(6500); // el reloj llega a 0
  check(admin.last.round === roundB && admin.last.phase === "activity", "F10[1]: no auto-rota si solo hay conectados SIN puesto (sentados offline → no rebaraja en un break)");
  ha.close();

  // F11: TAREAS — el Usuario decide qué mensaje es una tarea nueva; el Modelo marca cada tarea terminada
  await call(admin, "admin:reset", {}); await wait(100);
  const roles6 = ["modelo", "arnes", "revisor", "modelo", "arnes", "revisor"], E = [];
  for (let i = 0; i < 6; i++) { const s = mk(); await up(s); await call(s, "hello", { browserId: "e-" + i }); await call(s, "join", { nick: "e" + i, role: roles6[i] }); E.push(s); }
  await call(admin, "admin:start", {}); await wait(100);
  check((await call(admin, "admin:prompt", { text: "Dibuja un pato", team: "all", task: true })).ok, "F11: el Usuario crea la Tarea 1 para todos los equipos");
  await call(admin, "admin:prompt", { text: "El pato es amarillo", team: 0 }); // aclaración: NO es tarea
  await call(admin, "admin:prompt", { text: "Cuéntame un chiste", team: 1, task: true }); // Tarea 2, solo equipo 2
  await wait(150);
  check(admin.last.tasks.length === 2 && admin.last.tasks[0].text === "Dibuja un pato" && admin.last.tasks[1].teams.join() === "1", "F11: una aclaración no crea tarea; la Tarea 2 queda solo para el equipo 2");
  check(JSON.stringify(E[0].last.tasks) === JSON.stringify([{ id: 1, done: false }]), "F11: el Modelo del equipo 1 ve solo la Tarea 1 (número y estado, sin el enunciado)");
  check(E[3].last.tasks.length === 2, "F11: el Modelo del equipo 2 ve dos tareas simultáneas (1 y 2)");
  check(E[1].last.tasks === undefined && E[2].last.tasks === undefined, "F11: el Arnés y el Revisor no ven tareas");
  const tmsg = (E[0].last.msgs || []).find((m) => m.text === "Dibuja un pato"), amsg = (E[0].last.msgs || []).find((m) => m.text === "El pato es amarillo");
  check(tmsg && tmsg.task === 1 && amsg && amsg.task === null, "F11: en el chat, el mensaje de la tarea lleva su número; la aclaración no");
  check(!!(await call(E[1], "task:done", { task: 1 })).error && !!(await call(E[2], "task:done", { task: 1 })).error, "F11: el Arnés y el Revisor no pueden marcar tareas");
  check(!!(await call(E[0], "task:done", { task: 2 })).error, "F11: el Modelo no puede marcar una tarea que su equipo no tiene");
  check((await call(E[3], "task:done", { task: 2 })).ok, "F11: el Modelo del equipo 2 marca terminada la Tarea 2 (la 1 sigue en curso)");
  await wait(150);
  check(JSON.stringify(E[3].last.tasks) === JSON.stringify([{ id: 1, done: false }, { id: 2, done: true }]), "F11: el equipo 2 queda con la Tarea 1 en curso y la 2 terminada");
  check(admin.last.tasks[1].done[1] && admin.last.tasks[1].done[1].by === "modelo" && admin.last.tasks[1].done[1].nick === "e3", "F11: el admin ve que la marcó el Modelo (e3)");
  check(!!(await call(E[3], "task:done", { task: 2 })).error, "F11: no se marca dos veces");
  check(!!(await call(E[0], "admin:taskDone", { team: 0, task: 1 })).error, "F11: un jugador no puede usar el control del admin");
  check((await call(admin, "admin:taskDone", { team: 1, task: 2, done: false })).ok, "F11: el admin puede reabrir una tarea (por si el Modelo se equivocó)");
  check((await call(admin, "admin:taskDone", { team: 0, task: 1 })).ok, "F11: el admin puede marcar terminada una tarea de un equipo");
  check(!!(await call(admin, "admin:taskDone", { team: 0, task: 2 })).error, "F11: el admin no puede marcar una tarea que ese equipo no tiene");
  await wait(150);
  check(!E[3].last.tasks[1].done && E[0].last.tasks[0].done, "F11: el Modelo ve reflejados los cambios del admin");
  await call(admin, "admin:pause", {}); await wait(80);
  check(!!(await call(E[3], "task:done", { task: 1 })).error, "F11: en pausa no se marcan tareas");
  await call(admin, "admin:pause", {});
  const ex2 = await call(admin, "admin:export", {});
  const t1 = ex2.data.tareas && ex2.data.tareas[0];
  check(t1 && t1.texto === "Dibuja un pato" && t1.equipos.join() === "1,2" && t1.terminadas.length === 1 && t1.terminadas[0].marcadaPor === "Usuario", "F11: el historial descargado trae cada tarea, sus equipos y quién la terminó");

  // F12: alerta al Modelo cuando la ventana de contexto le borra una instrucción del Usuario
  await call(admin, "admin:reset", {}); await wait(100);
  E.forEach((s) => s.close());
  const lm = mk(), la = mk();
  await up(lm); await call(lm, "hello", { browserId: "lm" }); await call(lm, "join", { nick: "LMod", role: "modelo" });
  await up(la); await call(la, "hello", { browserId: "la" }); await call(la, "join", { nick: "LArn", role: "arnes" });
  await call(admin, "admin:config", { limit: 100 }); await call(admin, "admin:start", {}); await wait(100);
  await call(admin, "admin:prompt", { text: "Torre de 30 cm con 4 hojas.", team: 0, task: true }); // 27 caracteres · Tarea 1
  await call(lm, "send", { text: "Haz 4 tubos de papel.", to: "arnes" }); await wait(150);
  check(lm.last.usuario.lost === null, "F12: mientras la instrucción del Usuario cabe en la memoria, no hay alerta");
  for (let i = 0; i < 3; i++) await call(lm, "send", { text: "Paso " + i + ": pega los tubos en cuadrado bien firmes", to: "arnes" });
  await wait(150);
  const lost = lm.last.usuario.lost;
  check(!!lost && lost.total === 1 && lost.none === true, "F12: al olvidarse el encargo, el Modelo recibe la alerta (1 mensaje del Usuario, ya no queda ninguno)");
  check(lost.tasks.join() === "1", "F12: la alerta sabe que lo olvidado es el enunciado de la Tarea 1");
  check(lm.last.tasks.length === 1 && lm.last.tasks[0].id === 1, "F12: la Tarea 1 sigue en su lista (solo el número: el enunciado ya no lo tiene)");
  check(!(lm.last.msgs || []).some((m) => m.role === "profesor"), "F12: (de verdad ya no está el encargo en su memoria)");
  check(!!admin.last.teams[0].lostU && admin.last.teams[0].lostU.none, "F12: el admin también ve que ese Modelo olvidó su instrucción");
  await call(admin, "admin:reply", { team: 0, text: "Es una torre de 30 cm." }); await wait(120);
  check(lm.last.usuario.lost.none === false && lm.last.usuario.lost.total === 1, "F12: si el Usuario le vuelve a escribir, ya tiene una instrucción suya (none=false)");
  // modo "recortar": perder solo una parte de la instrucción también avisa (una vez por mensaje)
  await call(admin, "admin:reset", {}); await wait(100);
  await call(lm, "hello", { browserId: "lm" }); await call(lm, "join", { nick: "LMod", role: "modelo" });
  await call(la, "hello", { browserId: "la" }); await call(la, "join", { nick: "LArn", role: "arnes" });
  await call(admin, "admin:config", { limit: 60, mode: "recortar" }); await call(admin, "admin:start", {}); await wait(100);
  await call(admin, "admin:prompt", { text: "Torre de 30 cm con 4 hojas de papel.", team: 0 }); // 36
  await call(lm, "send", { text: "Haz 4 tubos de papel bien firmes ya", to: "arnes" }); await wait(150); // 35 → recorta el encargo
  const lost2 = lm.last.usuario.lost;
  check(!!lost2 && lost2.total === 1 && lost2.none === false, "F12: en modo recortar, perder parte de la instrucción también avisa");
  await call(lm, "send", { text: "Y luego otra capa", to: "arnes" }); await wait(150);
  check(lm.last.usuario.lost.total === 1, "F12: el mismo mensaje recortado dos veces cuenta una sola vez");
  lm.close(); la.close();

  ps.forEach((s) => { try { s.close(); } catch (_) {} }); admin.close();
  server.close();
  console.error(fails ? `\n${fails} prueba(s) de regresión fallaron` : "\nRegresión OK.");
  process.exit(fails ? 1 : 0);
})();
