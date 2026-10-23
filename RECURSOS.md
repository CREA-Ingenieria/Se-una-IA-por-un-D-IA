# Recursos incluidos y cómo descargarlos

El zip `se-una-ia-alpha-v<versión>.zip` ya trae todo lo de esta lista, así que el PC de la universidad no necesita internet. Si falta algo o quieres actualizarlo, aquí están las fuentes oficiales.

| Recurso | Dónde queda | Para qué | Descarga oficial | Licencia |
|---|---|---|---|---|
| Node.js 22 LTS, `node.exe` portable (Windows x64) | `runtime/node.exe` | Ejecuta el servidor sin instalar nada | https://nodejs.org/dist/v22.20.0/win-x64/node.exe (firmas: https://nodejs.org/dist/v22.20.0/SHASUMS256.txt) | MIT ([LICENSE](https://github.com/nodejs/node/blob/main/LICENSE)) |
| Socket.IO 4.7.5 (servidor y cliente) | `node_modules/` | Comunicación en tiempo real entre iPads y servidor | https://www.npmjs.com/package/socket.io | MIT |
| multicast-dns 7.2.5 | `node_modules/` | Anuncia el nombre `seunaia.local` en la red | https://www.npmjs.com/package/multicast-dns | MIT |
| qrcode-generator 1.4.4 | `node_modules/` | Códigos QR de la pantalla `/conectar` y de la consola | https://www.npmjs.com/package/qrcode-generator | MIT |
| Doto | `public/fonts/` | Títulos en matriz de puntos | https://fonts.google.com/specimen/Doto | SIL OFL 1.1 |
| Inter | `public/fonts/` | Textos de la interfaz | https://fonts.google.com/specimen/Inter | SIL OFL 1.1 |
| Share Tech Mono | `public/fonts/` | Chat y fondo de caracteres | https://fonts.google.com/specimen/Share+Tech+Mono | SIL OFL 1.1 |
| Logos de CREA y Uniandes (Facultad de Ingeniería) | `public/assets/` | Marca de la experiencia | Plantilla institucional de CREA | Uso institucional |

## Descargarlos de nuevo con los scripts

Desde la carpeta del proyecto, en un PC con internet:

**Node.js portable**, con verificación de la firma SHA-256:

```bash
powershell -ExecutionPolicy Bypass -File tools\descargar-node.ps1 -Version 22.20.0 -Destino runtime
```

`INSTALAR.bat` corre este mismo script solo si no encuentra Node.js.

**Dependencias**, si falta `node_modules`:

```bash
npm install --omit=dev
```

**Tipografías**, que se guardan en `public/fonts` y generan `fonts.css`:

```bash
node tools/descargar-fuentes.js
```

## Volver a armar el zip

En el PC de desarrollo, con internet y npm:

```bash
powershell -ExecutionPolicy Bypass -File tools\empaquetar.ps1
```

Queda en `dist\se-una-ia-alpha-v<versión>.zip`, junto con un `.sha256` para comprobar que el archivo llegó completo.

## Comprobar el zip después de copiarlo

En PowerShell, en la carpeta donde está el zip:

```bash
Get-FileHash -Algorithm SHA256 .\se-una-ia-alpha-v0.1.0-alpha.zip
```

El resultado debe ser igual al que dice el archivo `.sha256`.
