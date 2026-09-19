# Cómo ejecutar la aplicación

Guía práctica para arrancar el Tramitador en Windows. Los comandos son de
PowerShell (Windows Terminal).

Esto es un manual de uso, no un paso del curso: los documentos numerados
cuentan **cómo se construyó** cada cosa, y éste solo dice **cómo se pone en
marcha**. Para el porqué de las decisiones que aparecen aquí, los sitios son
`16. ARRANQUE.md` (el script `dev` del backend), `17. FRONTEND.md` (el servidor
de Vite y su proxy) y `25. VERIFICACION.md` (la comprobación de extremo a
extremo).

## Lo mínimo

Dos terminales, desde la raíz del proyecto:

```powershell
# Terminal 1
npm run dev

# Terminal 2
npm run dev:frontend
```

Y abrir **http://localhost:5173**.

Si algo no sale como aquí se dice, la tabla de [Problemas conocidos](#problemas-conocidos)
cubre los cinco tropiezos que tiene este proyecto. Los cinco tienen mal aspecto
y ninguno es grave.

## Requisitos

| | |
|---|---|
| Node | v24.21.0 (probado). No hay `engines` declarado |
| npm | 11.19.0, con workspaces |
| Navegador | cualquiera; el recorrido se probó en Chrome |

No hay base de datos ni servicios externos. Los datos son tres ficheros JSON en
`data/`, que el backend lee al arrancar.

## Arranque paso a paso

### 1. Situarse en la raíz

```powershell
cd "C:\Curso atmira - Los seis pilares del IA Spec-Driven Development (SDD)\tramitador-step-by-step-development\Prompt25"
```

Las comillas no son opcionales: la ruta lleva espacios y paréntesis.

### 2. Instalar, si es la primera vez

```powershell
npm install
```

### 3. Comprobar los enlaces del workspace

Diez segundos que ahorran una tarde. Es el fallo más frecuente del proyecto:

```powershell
Get-Item node_modules\@tramitador\* | Select-Object Name, LinkType
```

Los tres —`backend`, `contrato`, `frontend`— deben decir **`Junction`**:

```
Name       LinkType
----       --------
backend    Junction
contrato   Junction
frontend   Junction
```

Si la columna sale vacía, es el problema
[«Cannot find package `@tramitador/contrato`»](#2-cannot-find-package-tramitadorcontrato)
de más abajo. Se arregla con `npm install`.

### 4. Terminal 1 — el backend

```powershell
npm run dev
```

Señal de que está listo:

```
Tramitador escuchando en http://127.0.0.1:3001/api
```

La terminal se queda ocupada. `tsx watch` reinicia el proceso al guardar
cualquier fichero del backend.

### 5. Terminal 2 — el frontend

En Windows Terminal, `Ctrl+Shift+D` parte el panel y deja las dos a la vista.

```powershell
npm run dev:frontend
```

Señal de que está listo:

```
VITE v8.3.0  ready in 283 ms
➜  Local:   http://localhost:5173/
```

### 6. Abrir

```powershell
start http://localhost:5173
```

**Todo pasa por el 5173.** Abrir el 3001 en el navegador no enseña la
aplicación: ahí solo está la API. Las llamadas a `/api` las reenvía el servidor
de Vite al backend, y por eso el cliente puede escribir `fetch('/api/...')` sin
saber en qué puerto vive el otro.

## Por qué hacen falta dos terminales

No es un descuido. Está escrito en el `package.json` de la raíz: `npm run dev
--workspaces` ejecutaría los dos **en serie**, y como el `tsx watch` del backend
no termina nunca, el frontend no llegaría a arrancar jamás. Un solo comando
necesitaría añadir `concurrently` o `npm-run-all`, y esa dependencia no está.

## Comprobar que funciona

### El backend, por su cuenta

```powershell
curl.exe http://127.0.0.1:3001/api/salud
# {"ok":true}
```

Se escribe `curl.exe` con la extensión por costumbre defensiva. En **Windows
PowerShell 5.1**, `curl` a secas es un alias de `Invoke-WebRequest`, que acepta
otros parámetros y devuelve un objeto en vez de texto. En **PowerShell 7** ese
alias ya no existe y `curl` llama al ejecutable real, así que ahí da igual cuál
uses. Poner la extensión funciona en las dos.

### El frontend y el proxy

```powershell
curl.exe http://localhost:5173/api/salud
# {"ok":true}   <- si responde, el proxy hacia el backend funciona
```

### El recorrido, a mano

1. Cargar http://localhost:5173 — deben salir **12 solicitudes**.
2. Hacer clic en una con el chip **Enviada**. Hay tres: `SOL-2026-0003`,
   `SOL-2026-0006` y `SOL-2026-0009`.
3. El detalle debe ofrecer **Aprobar** y **Rechazar** (no *Enviar*).
4. Clic en **Aprobar**.
5. El detalle **y** la fila de la bandeja pasan a **Aprobada**, sin que la
   página se recargue.

Para confirmar el punto 5 sin fiarse de la vista: abrir las herramientas de
desarrollo en la pestaña **Network** con **Preserve log** marcado. Al aprobar
debe aparecer un `POST` a `/api/solicitudes/<id>/transiciones` y **ningún
documento nuevo**. Si la página se hubiera recargado, se vería una petición del
documento HTML entero.

## Problemas conocidos

Los cinco que tiene este proyecto, con su síntoma exacto.

### 1. `EADDRINUSE` — el puerto está ocupado

```
Error: listen EADDRINUSE: address already in use 127.0.0.1:3001
Error: Port 5173 is already in use
```

Casi siempre es **otro `Prompt<N>` del curso** que se quedó arrancado de un día
anterior. Ojo con esto, porque es traicionero: si dejas el backend de otro paso
vivo y arrancas solo el frontend de éste, **la aplicación carga y funciona** —
los datos de prueba son idénticos en todos— y estarás mirando el proyecto
equivocado sin que nada chirríe.

Ver quién lo tiene, antes de cerrar nada:

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -State Listen |
  ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" } |
  Select-Object ProcessId, CommandLine | Format-List
```

El `Format-List` del final no es adorno: sin él, la tabla por defecto **corta**
la columna `CommandLine`, que es justo donde está el dato que importa.

La ruta dice de qué `Prompt<N>` es:

```
ProcessId   : 34616
CommandLine : ...\tramitador-step-by-step-development\Prompt16\node_modules\tsx\...
                                                     ^^^^^^^^
```

Si sobra:

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { taskkill /PID $_ /T /F }
```

### 2. `Cannot find package '@tramitador/contrato'`

```
Error: Cannot find package '@tramitador/contrato' imported from
  ...\apps\backend\src\datos\repositorio.ts
```

El más frecuente con diferencia. Los enlaces de `node_modules/@tramitador/` se
convierten en **carpetas vacías** en vez de junctions.

```powershell
npm install
```

No hace falta borrar `node_modules`: `npm install` a secas reconstruye los tres
enlaces en un par de segundos (`changed 3 packages`).

Se disfraza de otras cuatro cosas, y todas se arreglan igual:

- `npm test` → seis suites caídas y un recuento de **63 tests** en vez de 180.
  Las suites que no cargan no registran sus tests, así que ni se cuentan.
- `npm run build` → doce errores `TS2307` en ficheros `.tsx` que no tienen nada
  mal.
- `npm run dev` → el backend no arranca.
- Node dice buscar `@tramitador/contrato/index.js` aunque el `package.json`
  apunte a `./src/index.ts`. No es que `main` esté mal: al encontrar un
  directorio vacío, Node cae al *legacy main resolve* y se inventa el
  `index.js`.

Lo que **no** es síntoma: `npm run verifica:contrato` y `npm run lint` siguen
pasando, porque ninguno de los dos resuelve ese import.

### 3. `127.0.0.1:5173` no conecta, `localhost:5173` sí

**Vite escucha solo en IPv6** (`::1`). Con el navegador da igual, pero con
`curl` o un script parece que el servidor no está arrancado cuando sí lo está.
Usar siempre `localhost` para el frontend.

El backend es al revés: escucha **solo** en `127.0.0.1` (IPv4), y a propósito.
Por eso el proxy de `vite.config.ts` apunta a `http://127.0.0.1:3001` y no a
`localhost:3001`.

### 4. `Missing script: "build"`

```
npm error Missing script: "build"
```

No es un fallo: en la raíz **no hay** `build`. Solo lo define `apps/frontend`.

```powershell
npm run build -w @tramitador/frontend
```

El backend y el contrato no compilan a `dist/` por decisión de diseño — `tsx` y
Vite leen TypeScript directamente.

### 5. El aviso de `esbuild` al instalar

```
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
```

Es un aviso, no un error. `npm install` termina bien y la aplicación funciona.
`16. ARRANQUE.md` lo explica.

## Variantes útiles

### Ver las peticiones que llegan al backend

```powershell
$env:LOG = "1"; npm run dev
```

Cada petición sale como una línea JSON. Sirve para confirmar que un clic llega
de verdad a la API y no es un cambio pintado en el cliente.

Para quitarlo, cerrar la terminal o:

```powershell
Remove-Item Env:\LOG
```

### Arrancar el backend en otro puerto

```powershell
$env:PORT = "3025"; npm run dev
```

**El frontend no se mueve igual de fácil.** `vite.config.ts` tiene
`strictPort: true`, el 5173 escrito a mano y el proxy fijado al 3001: cambiarlo
obliga a editar el fichero. Si el 5173 está ocupado, sale más barato liberarlo
que moverlo.

Que `strictPort` esté puesto es deliberado: sin él, Vite saltaría al 5174 y la
aplicación arrancaría **rota**, porque la lista de orígenes CORS de
`apps/backend/src/app.ts` solo conoce el 5173.

### Ver el build de producción

```powershell
npm run build -w @tramitador/frontend
npm run preview -w @tramitador/frontend
```

`preview` sirve `dist/` tal cual, **sin proxy**: las llamadas a `/api` no
llegarán a ninguna parte. Sirve para ver el build, no para probar la aplicación
completa.

### Comprobar que todo está sano

```powershell
npm run verifica:contrato                 # tipos.gen.ts coincide con openapi.yaml
npm run lint                              # 27 ficheros, salida vacía
npm test                                  # Test Files 8 passed / Tests 180 passed
npm run build -w @tramitador/frontend     # built in ~130 ms
```

Si `npm test` dice **63** en vez de 180, es el problema 2.

## Parar

`Ctrl+C` en cada terminal.

No hay nada que limpiar. El repositorio del backend es **en memoria**: lee los
JSON de `data/` al arrancar y no vuelve a escribir nunca. Las aprobaciones que
hagas probando desaparecen al reiniciar, y `data/` queda intacto.

Eso también quiere decir que **no hay forma de guardar nada de verdad**. Es
deliberado, y está explicado en los comentarios de
`apps/backend/src/datos/repositorio.ts`.

## Mapa rápido

| | |
|---|---|
| Aplicación | http://localhost:5173 |
| API (directa) | http://127.0.0.1:3001/api |
| Datos | `data/*.json`, cargados en memoria al arrancar |
| Backend | `apps/backend` — Fastify + `tsx watch` |
| Frontend | `apps/frontend` — React 19 + Vite |
| Contrato | `packages/contrato` — tipos generados de `openapi.yaml` |
