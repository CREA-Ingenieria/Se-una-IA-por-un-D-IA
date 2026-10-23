# Sé una IA por un d-IA · versión alpha

Aplicación de chat rooms para la experiencia de CREA (Facultad de Ingeniería, Uniandes): grupos de 3 personas se comportan como un agente de IA (Modelo, Arnés y Revisor) con memoria limitada, mientras construyen algo físico.

Un **PC de la universidad** hace de servidor central. Los iPads o PCs de la sala solo abren una dirección en el navegador; no se instala nada en ellos.

**Autoría:** David Octavio Ibarra, Sebastián Suárez, Francisco Santamaría, Ángel Peñaranda y el equipo CREA (Facultad de Ingeniería, Universidad de los Andes).

## Instalación en el PC de la universidad (Windows)

Usa el paquete **`se-una-ia-alpha-v<versión>.zip`**. Trae Node.js portable, las dependencias y las tipografías, así que no necesita internet.

1. Descomprime el zip en una carpeta fija, por ejemplo Documentos. No lo ejecutes desde dentro del zip.
2. Doble clic en **`INSTALAR.bat`**. Pide la clave del admin, el puerto y el nombre y la clave de la red WiFi propia (hotspot), y los guarda en `config.json`. Abre el puerto en el firewall (un aviso de administrador) y crea el acceso directo **"Se una IA - servidor"** en el escritorio.
3. Cada vez que haya actividad: doble clic en **`INICIAR.bat`** o en el acceso directo, y escoge red actual u hotspot. El panel admin se abre solo en ese PC.

Los recursos incluidos y sus enlaces de descarga están en [RECURSOS.md](RECURSOS.md). El zip se arma con `tools\empaquetar.ps1`.

## Qué necesitas

- Para el zip: un PC con Windows 10 u 11 de 64 bits.
- En cualquier otro sistema (macOS, Linux): **Node.js 18 o más reciente** (versión LTS en https://nodejs.org) y `npm install --omit=dev` la primera vez.
- Que ese PC y los iPads estén en **la misma red** (la misma WiFi o la misma red cableada de la sala).

## Arrancar el servidor sin el instalador

Desde esta carpeta:

```bash
npm install --omit=dev
npm start
```

La consola muestra algo así:

```
  SÉ UNA IA POR UN D-IA · servidor alpha
  Sesión: CREA-482
  En Safari de cada iPad escribe:   seunaia.local
     o escanea este código con la cámara:  (QR)
  Si el nombre no abre, usa la dirección numérica:
     http://192.168.1.40
  Panel admin:          http://localhost/admin
  Pantalla para proyectar (QR): http://localhost/conectar
```

Deja esa ventana abierta durante toda la actividad.

### Clave del admin, nombre y puerto

La clave por defecto es `crea2026`. Cámbiala antes de usarlo con estudiantes:

- Edita `config.json` (lo crea `INSTALAR.bat`): `{ "claveAdmin": "otraclave", "nombre": "seunaia", "puerto": 80 }`.
- O usa variables de entorno, que tienen prioridad: `ADMIN_PASSWORD=otraclave PORT=8080 npm start` (en PowerShell: `$env:ADMIN_PASSWORD="otraclave"; npm start`).

### Cómo entran los iPads: seunaia.local y códigos QR

**La forma que funciona siempre es el QR.** En la prueba en la universidad, el nombre `seunaia.local` no abrió y el QR sí.

El servidor también anuncia el nombre **`seunaia.local`** por mDNS/Bonjour, pero muchas redes (y a veces el hotspot) bloquean esos anuncios, así que queda solo como opción extra. Usa el puerto 80, así que la dirección no lleva `:3000`. El nombre se cambia en `config.json` (`"nombre": "seunaia"`).

Para que sea aún más fácil, abre **`/conectar`** (botón *Pantalla de conexión (QR)* en el panel admin) y proyéctala:

- **Paso 1**, solo con hotspot: un QR para unirse a la WiFi del PC con la cámara del iPad.
- **Paso 2**: un QR que abre el juego, más el nombre para escribirlo a mano.

El QR del juego lleva la dirección numérica (por ejemplo `http://192.168.137.1`), que funciona aunque la red bloquee los nombres `.local`. El mismo QR aparece en la ventana del servidor.

Si el puerto 80 está ocupado por otro programa, el servidor usa el 3000 y lo avisa. Las direcciones mostradas ya lo incluyen.

### Dónde se conectan los iPads: red actual u hotspot

Al iniciar, `INICIAR.bat` pregunta:

1. **Red actual**: los iPads entran a la misma WiFi o red cableada en la que ya está el PC. Es la opción más simple cuando la red de la sala deja que los equipos se vean entre sí.
2. **Hotspot del PC**: el PC crea su propia red WiFi con el nombre y la clave guardados en `config.json` (`hotspotNombre`, `hotspotClave`). Los iPads se conectan a esa red y abren `seunaia.local` (o `http://192.168.137.1`). Así no dependes de la WiFi de la universidad.

También se puede saltar el menú: `INICIAR.bat red` o `INICIAR.bat hotspot`. Para manejar el hotspot por separado:

```bash
powershell -ExecutionPolicy Bypass -File tools\hotspot.ps1 -Accion iniciar
```

El hotspot de Windows tiene límites:

- **Máximo 8 dispositivos conectados.** Para más iPads (hasta 32), usa un router WiFi propio en la sala, conecta el PC a ese router y escoge la opción 1.
- Necesita un adaptador WiFi y alguna conexión activa (cable o WiFi) para compartir. Si Windows no lo deja encender solo, el script abre *Configuración → Zona con cobertura inalámbrica móvil* para activarlo a mano.

### Si los iPads no cargan la página

1. **Firewall de Windows**: `INSTALAR.bat` abre los puertos 80 y 3000 (web) y 5353 (nombre `.local`) en todas las redes; pide permiso de administrador una vez. Para hacerlo de nuevo: `powershell -ExecutionPolicy Bypass -File tools\firewall.ps1 -Puerto 80`.
2. **Redes de la universidad**: algunas WiFi institucionales aíslan a los dispositivos entre sí, y entonces los iPads no ven al PC. Usa el hotspot o un router propio.
3. Prueba primero desde el mismo PC: `http://localhost`.
4. Si `seunaia.local` no abre en un iPad, usa el QR: lleva la dirección numérica. Algunas redes bloquean los anuncios mDNS.

## Cómo corre la actividad

1. **Antes**: el admin abre `/admin`, entra con la clave y define el límite de contexto (caracteres), si se borra el mensaje completo o letra por letra, el tiempo entre rotaciones, la espera mínima de la **cola** y el **enfriamiento** del Modelo (ver más abajo).
2. **Llegada**: cada persona, en el iPad de su mesa, escribe su nickname y escoge el rol de esa mesa. El sistema numera el iPad (PC 1, PC 2…) y arma los equipos solo, con una persona por rol (máximo 8 equipos). Mientras tanto ven la pista de su rol y "esperando jugadores".
3. **Ajustes**: en la tabla del admin se cambia el rol o el equipo de cualquier iPad; si el puesto ya está ocupado, se intercambian. Para iniciar, cada equipo necesita al menos Modelo y Arnés; sin Revisor nadie le da retroalimentación al Modelo.
4. **Iniciar actividad** y **enviar el prompt** a todos los Modelos o a un solo equipo.
5. **Chat**: cada rol ve solo sus canales; el filtro se aplica en el servidor. Arriba a la derecha está el contador "usados / total" de la memoria del equipo, con la **barra partida por colores** según quién la gastó (Usuario en amarillo, Modelo en rosado, Revisor en azul). Al llenarse se borra lo más viejo con un aviso.
6. **Minijuego**: al lado del chat hay preguntas cortas. Cada acierto da +40 caracteres al **vecino de mesa** (mismo rol, equipo siguiente), nunca a quien responde.
7. **Rotación**: cuando se acaba el tiempo (o el admin presiona "Rotar ya"), cada iPad muestra en blanco "nick, levántate y ve al PC X" y en grande **ESTE ES EL PC Y**. El sistema escoge un PC al azar con un rol que esa persona no ha hecho. Quien llega toca **¡LISTO!** y, cuando todos están listos, la actividad sigue. El rol y el equipo están atados al iPad, no a la persona.
8. **Terminar** muestra un resumen por equipo. **Nueva sesión** borra todo.

### Canales y reglas de cada rol

La frase de cada rol: **Modelo: Piensa** · **Arnés: Ejecuta lo que diga el Modelo** · **Revisor: Describe las acciones del Arnés**.

| Canal | Quién escribe → quién lee |
|---|---|
| U | Usuario (profesor) ↔ Modelo. **El Modelo es el único que habla con el Usuario.** El Arnés y el Revisor no lo ven |
| C | Modelo → Arnés. El Revisor no lo ve |
| R | Revisor → Modelo: describe lo que hace el Arnés, con texto o **fotos**. El Arnés también lo lee |

El Modelo no le escribe al Revisor y al Revisor no le llega ningún mensaje del Modelo. El Revisor no le escribe al Arnés. El Arnés solo recibe: las órdenes del Modelo y lo que el Revisor le reporta al Modelo. Cada iPad tiene a un lado del chat la casilla **"Reglas de tu rol"**, que se puede plegar:

- **Modelo**: piensa el plan, habla con el Usuario (a través de la cola), da órdenes al Arnés y recibe la retroalimentación del Revisor. Con el interruptor **Arnés / Usuario** escoge a quién le escribe.
- **Arnés (ejecutor)**: hace con los materiales lo que diga el Modelo; no escribe.
- **Revisor**: mira lo que hace el Arnés y se lo describe al Modelo (texto o fotos). Solo le escribe al Modelo y solo ve sus propios reportes.
- **Todos**: prohibido usar internet, el celular o buscar información; el agente solo sabe lo que está en el chat.

### Cola y enfriamiento para hablar con el Usuario

Varios equipos juegan a la vez y el Usuario atiende a **un Modelo a la vez**:

- Cuando un Modelo le escribe al Usuario, su mensaje **entra a una cola** (botón *Hacer fila*). Espera al menos el tiempo de cola (1 min por defecto) y, además, a que el Usuario termine con los que llegaron antes. Con Modelo 1, 2 y 3 en fila: el 1 espera 1 min, el 2 espera 1 min + lo que tome atender al 1, y el 3 espera 1 min + lo que tome atender al 1 y al 2.
- Cuando le llega el turno, se abre la **conversación**: en el iPad del Modelo y en el panel del admin el chat se agranda y los mensajes van y vienen **al instante, sin cola ni espera**.
- El admin la cierra con **Terminar y atender al siguiente**. Si se le olvida, la conversación **se cierra sola tras 1 min sin mensajes** (ajustable), para que la cola no se quede detenida; cada mensaje de cualquiera de los dos reinicia ese minuto. Desde ahí, ese Modelo queda en **enfriamiento** (1 min por defecto) antes de poder volver a hacer fila.
- La espera de la cola, el enfriamiento y el cierre automático se ajustan en el panel admin (antes de empezar y en plena actividad).
- El Usuario puede escribirle a cualquier Modelo cuando quiera (prompt o *Ver los canales*); eso no pasa por la cola.

**Teclado del iPad**: al tocar el campo para escribir, el chat se ajusta al espacio que queda sobre el teclado y baja hasta el último mensaje, para que el teclado no tape la conversación.

**Fotos del Revisor**: el botón de cámara abre la cámara del iPad. La foto se reduce en el iPad (máximo 1280 px) antes de enviarse y ocupa 120 caracteres de contexto. Cuando se olvida, se borra también del servidor.

### Panel admin durante la actividad

- **Rotación**: interruptor *Automática / Detenida* (detenida = el reloj no corre), −1 min, +1 min, *Reiniciar a…*, duración entre rotaciones y *Rotar ya*. Todo se puede cambiar en cualquier momento.
- **Contexto base**: −50 / +50 caracteres por equipo, en vivo. Si se baja, cada equipo olvida lo que ya no quepa.
- **Cola de Modelos**: arriba se ve quién está esperando, cuánto le falta y qué escribió. La conversación abierta aparece en un chat grande con el botón *Terminar y atender al siguiente*; la tarjeta de ese equipo se ilumina en amarillo.
- **Cola y enfriamiento**: se cambian en vivo desde los controles.
- *Pausar actividad*, ver los canales de cualquier equipo y *Reanudar sin esperar* durante una rotación.

## Si algo falla

- **Un iPad se recarga o se desconecta**: vuelve a su mismo PC y rol, porque el iPad se recuerda en su navegador. No uses navegación privada.
- **Un iPad se apaga, se borra o hay que cambiarlo**: en cualquier iPad libre, la persona escribe su **mismo nickname** y toca *Volver a mi puesto con este nickname* (o cualquier rol). Recupera su PC, rol, equipo y chat. Si el sistema dice que ese nickname sigue conectado (el iPad viejo quedó trabado), el admin toca **Liberar** en la tabla de dispositivos y la persona vuelve a intentarlo.
- **El servidor se cierra**: al volver a arrancarlo recupera la sesión desde `data/sesion.json` (respaldos de menos de 6 horas). Para empezar de cero: `node server.js --nueva`, o "Nueva sesión" en el panel.

## Ensayar sin gente

Con el servidor corriendo, en otra terminal:

```bash
npm install
node tools/bots.js 7 http://localhost
```

Entran 7 jugadores de prueba que responden en su canal y marcan listo al rotar. Tú entras desde el navegador como el octavo.

Para revisar las reglas principales (canales, cola, enfriamiento, contexto, minijuego, rotación) sin abrir el navegador:

```bash
npm test
```

## Estructura

```
server.js          servidor: estado, permisos por canal, ventana de contexto, rotación, minijuego
public/index.html  página única para iPads (/) y admin (/admin)
public/app.js      interfaz del cliente
public/styles.css  estilos (paleta CREA)
public/fx.js       fondo interactivo de caracteres que reacciona al puntero
public/assets/     logos de CREA y Uniandes
lib/red.js         nombre seunaia.local (mDNS) y códigos QR
tools/bots.js      jugadores de prueba
tools/hotspot.ps1  enciende/apaga la red WiFi propia del PC
tools/firewall.ps1 abre el puerto en el firewall de Windows
tools/*.ps1, *.js  descargas (Node.js, tipografías) y empaquetado del zip
INSTALAR.bat       instalación en Windows
INICIAR.bat        arranque con menú red actual / hotspot
test/smoke.js      prueba automática del flujo completo
data/              respaldo de la sesión (se crea solo)
```

## Pendiente para la siguiente versión

- Modo de contexto **por canal** (la especificación lo menciona; hoy solo existe "global por equipo").
- Exportar el historial de la sesión (hoy no se guarda nada después de "Nueva sesión").
- Probar en los iPads reales de la sala y con la red de la universidad.
