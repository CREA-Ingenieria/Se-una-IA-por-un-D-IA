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
process.argv.push("--nueva");
const { server } = require("../server.js");
const { io } = require("socket.io-client");
const URL = `http://localhost:${process.env.PORT}`;
const PW = process.env.ADMIN_PASSWORD || "crea2026";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((r) => s.emit(ev, d || {}, r));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FALLA ") + msg); if (!ok) fails++; };
function mk() { const s = io(URL, { forceNew: true, reconnection: false }); s.last = null; s.on("view", (v) => (s.last = v)); return s; }
async function up(s) { await new Promise((r) => s.on("connect", r)); }
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
  await wait(150); await readyOnline();
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

  // F7: rotar con TODOS offline se rechaza y NO avanza la ronda (nada de rotación vacía)
  await call(admin, "admin:reset", {}); await wait(100);
  const g = [];
  for (let i = 0; i < 3; i++) { const s = mk(); await up(s); await call(s, "hello", { browserId: "g-" + i }); await call(s, "join", { nick: "g" + i, role: roles[i] }); g.push(s); }
  await call(admin, "admin:start", {}); await wait(100);
  const roundBefore = admin.last.round;
  g.forEach((s) => s.close()); await wait(300);
  check(!!(await call(admin, "admin:rotate", {})).error, "F7: rotar con todos offline es rechazado");
  await wait(100);
  check(admin.last.round === roundBefore, "F7: la ronda no avanzó (no hubo rotación vacía)");

  ps.forEach((s) => { try { s.close(); } catch (_) {} }); admin.close();
  server.close();
  console.log(fails ? `\n${fails} prueba(s) de regresión fallaron` : "\nRegresión OK.");
  process.exit(fails ? 1 : 0);
})();
