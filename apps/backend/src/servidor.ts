// El punto de entrada del backend: el único fichero que habla con el sistema
// operativo.
//
// Todo lo que `app.ts` evita a propósito está aquí y solo aquí: leer el
// entorno, abrir un puerto, escribir por consola y decidir qué hacer si algo de
// eso falla. `app.ts` sabe de HTTP; este fichero sabe de proceso.
//
// La consecuencia práctica de la división: importar `app.ts` no arranca nada,
// así que un test puede hacerlo sin que se le quede un socket abierto. Este
// módulo, en cambio, tiene efectos con solo ejecutarse, y por eso NADIE lo
// importa: se lanza (`tsx src/servidor.ts`) y punto.
//
// Nota sobre los acentos, misma regla que en el resto del backend: los
// comentarios van acentuados; lo que acaba en un log, en ASCII.

import { crearApp } from './app';

/* ------------------------------------------------------------------ *
 * Configuración: lo poco que se lee del entorno.
 * ------------------------------------------------------------------ */

/** Puerto por defecto cuando no hay `PORT`. */
const PUERTO_POR_DEFECTO = 3001;

// Se escucha solo en loopback, no en `0.0.0.0`. Es un backend de desarrollo que
// sirve a un frontend en la misma máquina: atarlo a todas las interfaces lo
// expondría a la red local sin que nadie lo haya pedido, y el contrato todavía
// no tiene autenticación (ver el hueco que `5. RUTAS.md` deja anotado).
//
// Se escribe `127.0.0.1` y no `localhost` a propósito: `localhost` puede
// resolver a `::1` o a `127.0.0.1` según la máquina, y ahí es donde aparece el
// clásico "el servidor arranca pero el navegador no conecta".
const HOST = '127.0.0.1';

/**
 * El puerto a usar: `PORT` del entorno, o {@link PUERTO_POR_DEFECTO}.
 *
 * `process.env.PORT` es `string | undefined`, así que hay que convertirlo. Se
 * usa `Number.parseInt` en base 10 explícita y se comprueba el resultado: un
 * `PORT=` vacío o un `PORT=ochenta` dan `NaN`, y `listen({ port: NaN })` no
 * falla de forma legible —Node lo interpretaría como puerto 0 y arrancaría en
 * uno aleatorio, que es el fallo más molesto posible: parece que funciona—.
 * Aquí se prefiere reventar con un mensaje que diga qué se leyó.
 */
function leerPuerto(valor: string | undefined): number {
  if (valor === undefined || valor === '') return PUERTO_POR_DEFECTO;

  const puerto = Number.parseInt(valor, 10);

  // Rango válido de un puerto TCP. Se excluye el 0 —que significa "dame uno
  // libre"— porque quien escribe `PORT` quiere un puerto concreto; el 0 es útil
  // en tests, y los tests no pasan por aquí.
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new Error(`PORT no es un puerto valido: ${valor}`);
  }

  return puerto;
}

/* ------------------------------------------------------------------ *
 * Arranque.
 * ------------------------------------------------------------------ */

const puerto = leerPuerto(process.env.PORT);

// El log de peticiones: apagado salvo que se pida con `LOG=1`.
//
// Esta es la línea que `app.ts` no podía escribir. Allí el valor por defecto es
// `false` porque lo manda la suite —cuarenta peticiones inyectadas no deben
// dejar cuarenta líneas de JSON entre los resultados de vitest—, y aquí es
// donde se sabe que esto es un proceso de desarrollo con una terminal delante.
//
// Apagado por defecto y no encendido: `logger: true` escribe una línea de JSON
// crudo por petición, sin formatear, y el frontend de la fase 3 va a hacer
// muchas. Que sea opt-in deja la terminal legible y da la herramienta a quien
// esté depurando por qué una petición no llega:
//
//   $env:LOG = "1"; npm run dev      (PowerShell)
//   LOG=1 npm run dev                (bash)
//
// Se compara con '1' exacto en vez de mirar si la variable existe: un `LOG=0`
// puesto para apagarlo encendería el log si la condición fuera la presencia.
const conLog = process.env.LOG === '1';

// `crearApp()` con el repositorio de verdad, el que lee los tres JSON de
// `data/`. Si esos ficheros no están, esta línea lanza antes de abrir el
// puerto, que es lo que se quiere: mejor no arrancar que arrancar y contestar
// `[]` a todo.
//
// El primer argumento va explícito (`undefined`) porque el segundo no puede
// saltarse: es el precio de que `repositorio` siga siendo el primer parámetro,
// y ese orden se mantiene para no tocar las 28 llamadas de la suite.
const app = crearApp(undefined, { logger: conLog });

// Este es el único `listen()` del backend.
//
// `await` en el nivel superior del módulo, que es ESM válido y lo que Fastify 5
// espera: `listen` devuelve una promesa y hay que esperarla, porque hasta que
// resuelve el socket no está escuchando de verdad. Sin el `await`, un error de
// bind (puerto ocupado) llegaría como rechazo no gestionado.
try {
  await app.listen({ port: puerto, host: HOST });

  // El único mensaje que imprime el backend. No usa el logger de Fastify
  // porque la app se construye con `logger: false`; es un `console.log` de
  // arranque, no una línea de log estructurado.
  console.log(`Tramitador escuchando en http://${HOST}:${puerto}/api`);
} catch (error) {
  // Un fallo al escuchar (EADDRINUSE, EACCES) no es recuperable: el proceso no
  // puede hacer su trabajo. Se imprime y se sale con código distinto de 0 para
  // que quien lo haya lanzado —un script, un supervisor, la consola— se entere.
  console.error('No se pudo arrancar el servidor:', error);
  process.exit(1);
}
