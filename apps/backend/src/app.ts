// La aplicacion HTTP de Tramitador, sin arrancarla.
//
// Este fichero construye el Fastify entero —plugins, rutas, serializacion— y lo
// DEVUELVE. No llama a `listen()`, no lee `process.env`, no abre un puerto y no
// imprime nada por consola. Todo eso vive en `servidor.ts`, que es el único
// fichero del backend con efectos sobre el mundo exterior.
//
// La separación no es estética: es lo que hace testeable el backend. Un
// `app.listen()` escondido al final de este módulo se ejecutaría con solo
// importarlo, y un test que quisiera probar `GET /api/tipos` tendría que elegir
// un puerto libre, esperar a que el socket estuviera escuchando, hacer un
// `fetch` de verdad y acordarse de cerrar. Devolviendo la instancia sin
// escuchar, el test llama a `crearApp()` y usa `app.inject()`, que empuja una
// petición sintética por el mismo ciclo de vida de Fastify —enrutado, hooks,
// parseo de query, serialización— sin tocar la red. Ver el ejemplo del final
// del fichero.
//
// La misma separación es la que permite levantar varias apps a la vez en el
// mismo proceso (vitest ejecuta ficheros en paralelo) sin que se peleen por el
// puerto: sin `listen()` no hay puerto por el que pelearse.
//
// Nota sobre los acentos, misma regla que en `dominio/` y `datos/`: los
// comentarios van acentuados; los textos que puedan acabar en un log o en el
// `detalle` de una respuesta, en ASCII.

import cors from '@fastify/cors';
import type { ErrorApi } from '@tramitador/contrato';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';

import { crearRepositorio, type Repositorio } from './datos/repositorio';
import { registrarRutasDeSolicitudes } from './rutas/solicitudes';

/* ------------------------------------------------------------------ *
 * El prefijo de las rutas.
 * ------------------------------------------------------------------ */

// `openapi.yaml` declara `servers: [{ url: /api }]`, así que las siete
// operaciones del contrato cuelgan de `/api`. Aquí se escribe el prefijo entero
// en cada ruta (`/api/salud`) en vez de registrarlas bajo un plugin con
// `{ prefix: '/api' }`: leer la URL completa en la misma línea del `get` es más
// directo que subir a buscar dónde se declaró el prefijo. La regla se mantiene
// en `rutas/solicitudes.ts`, que escribe sus cuatro URLs igual de enteras; el
// día que el contrato tenga una segunda familia de recursos y el prefijo
// aparezca en veinte sitios, un plugin pasa a merecer la pena.
//
// Lo que NO se hace es servir además las rutas sin prefijo "por si acaso": el
// contrato dice `/api`, y una API que responde en dos sitios tiene dos
// contratos.

/* ------------------------------------------------------------------ *
 * CORS: los orígenes del frontend en desarrollo.
 * ------------------------------------------------------------------ */

// El frontend de la fase 3 va a correr en el servidor de desarrollo de Vite, que
// escucha en el 5173. Eso es OTRO origen que `127.0.0.1:3001` —puerto distinto,
// y el puerto cuenta—, así que sin estas cabeceras el navegador deja salir la
// peticion y bloquea la respuesta antes de que el código del frontend la vea.
//
// Se listan los dos nombres del loopback a propósito, por el mismo motivo por el
// que `servidor.ts` escucha en `127.0.0.1` y no en `localhost`: Vite imprime
// `http://localhost:5173`, pero quien abra `http://127.0.0.1:5173` manda ese
// otro `Origin`, y un `Origin` que no está en la lista no recibe cabecera.
//
// Es una lista, no un `origin: true` (que refleja cualquier origen que pregunte)
// ni un `'*'`. La API no tiene autenticación todavía, así que hoy el daño de un
// comodín sería limitado; el problema es que el día que la tenga, nadie va a
// volver aquí a quitarlo.
const ORIGENES_DE_DESARROLLO = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const;

/* ------------------------------------------------------------------ *
 * La fábrica.
 * ------------------------------------------------------------------ */

/**
 * Lo que `servidor.ts` puede decidir y `app.ts` no sabe.
 *
 * Las dos opciones siguen la misma regla que el puerto: la fábrica construye,
 * y quien conoce el entorno elige. Un test no pasa ninguna y se lleva los
 * valores de abajo, que son los que quiere un test.
 */
export interface OpcionesApp {
  /**
   * El logger de Fastify. Por defecto `false`, que es lo que necesita la suite:
   * cuarenta peticiones inyectadas no deben dejar cuarenta líneas de JSON
   * mezcladas con los resultados de vitest.
   */
  readonly logger?: FastifyServerOptions['logger'];

  /**
   * Los orígenes a los que se les responde con cabeceras CORS. Por defecto, los
   * dos del servidor de desarrollo de Vite.
   */
  readonly origenes?: readonly string[];
}

/**
 * Construye la aplicación y la devuelve **sin escuchar**.
 *
 * @param repositorio La capa de datos. Por defecto se crea una de verdad, la
 *   que lee los tres JSON de `data/`, para que `servidor.ts` y cualquier uso
 *   normal sean un `crearApp()` a secas. El parámetro existe para que un test
 *   pueda pasar un doble en memoria —cualquier objeto con la forma de
 *   {@link Repositorio}— y fijar los datos que quiere probar sin tocar el disco
 *   ni depender de las doce solicitudes del juego de ejemplo.
 *
 *   El valor por defecto se evalúa **en cada llamada**, no una vez al cargar el
 *   módulo: dos `crearApp()` producen dos repositorios independientes, que es
 *   justo la propiedad que `crearRepositorio` documenta y por la que guarda su
 *   estado en el cierre léxico.
 *
 * @returns La instancia de Fastify, ya con las rutas registradas. Quien la
 *   recibe decide qué hacer con ella: `listen()` en producción, `inject()` en
 *   un test.
 *
 * @throws Lo que lance `crearRepositorio()` si `data/` no está o no es JSON
 *   válido. Es deliberado, y está explicado allí: sin datos no hay nada que
 *   servir. Que reviente al construir la app —y no en la primera petición— es
 *   lo que hace que el fallo se vea al arrancar y no en producción.
 */
export function crearApp(
  repositorio: Repositorio = crearRepositorio(),
  opciones: OpcionesApp = {},
): FastifyInstance {
  // `logger: false` por defecto. Fastify sin logger no escribe absolutamente
  // nada, y eso es lo que se quiere en un test. Lo que ha cambiado respecto de
  // la primera versión de este fichero es que ya no está clavado: `servidor.ts`
  // —que sí sabe en qué entorno corre— puede encenderlo. La decisión sigue sin
  // tomarse aquí; lo único que hay aquí es el valor por defecto.
  const app = Fastify({ logger: opciones.logger ?? false });

  // ------------------------------------------------------------------
  // CORS
  //
  // Va lo primero: es un `onRequest`/`onSend` para TODAS las rutas, incluidas
  // las que no existen, y el preflight (`OPTIONS`) tiene que contestarse antes
  // de que el enrutador decida que no hay nada en esa URL.
  //
  // `register` no ejecuta el plugin ahora. Fastify lo encola y lo carga en el
  // `ready()`, que tanto `listen()` como `inject()` esperan por su cuenta. Por
  // eso esta función sigue siendo síncrona y sigue sin arrancar nada: la
  // propiedad que hace testeable a este fichero no se pierde por registrar un
  // plugin.
  //
  // `methods` lista solo los verbos que el contrato usa. No se incluye `PUT` ni
  // `DELETE`: si algún día existen, que haya que añadirlos aquí es la señal de
  // que alguien está ampliando la superficie de la API.
  // ------------------------------------------------------------------
  void app.register(cors, {
    origin: [...(opciones.origenes ?? ORIGENES_DE_DESARROLLO)],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    // Sin `credentials: true`. La API no tiene ni cookies ni cabecera de
    // autenticación, así que pedirle al navegador que mande credenciales sería
    // reservar un permiso para algo que no existe.
    maxAge: 86_400,
  });

  // ------------------------------------------------------------------
  // El parser de `text/plain`, quitado
  //
  // Fastify trae dos parsers de serie: `application/json` y `text/plain`. El
  // segundo no lo pide el contrato, y estaba abriendo un camino torcido: un
  // `POST` con `Content-Type: text/plain` y cuerpo `hola` pasaba el filtro de
  // media type, llegaba al handler como una cadena, fallaba el
  // `typeof body === 'object'` y se contestaba con "La accion solicitada no es
  // valida" —un error de negocio para lo que es un error de formato—.
  //
  // Sin el parser, Fastify responde `415` antes de llegar al handler, que es lo
  // que `5. RUTAS.md` da por delegado al framework.
  // ------------------------------------------------------------------
  app.removeContentTypeParser('text/plain');

  // ------------------------------------------------------------------
  // Los errores que no escribe ninguna ruta
  //
  // Hasta aquí, cada `4xx` del contrato lo construye su handler con la forma
  // `{ mensaje, detalle }`. Pero hay respuestas que no pasa por ningún handler
  // —`415`, `413`, un JSON roto, una URL que no existe, un `500`— y esas las
  // escribía Fastify con SU formato (`{ statusCode, code, error, message }`).
  //
  // El resultado era una API con dos formas de error, y un cliente obligado a
  // probar primero `.mensaje` y luego `.message`. Los dos manejadores de abajo
  // traducen ese segundo formato al del contrato, para que el frontend de la
  // fase 3 pueda escribir una sola función de error.
  // ------------------------------------------------------------------

  // `setNotFoundHandler` cubre las URL que no existen y los verbos no
  // registrados sobre una URL que sí. Fastify responde `404` a los dos casos
  // (un `DELETE /api/solicitudes/:id` da `404`, no `405`); eso no se cambia
  // aquí —`5. RUTAS.md` lo da por delegado—, pero al menos el cuerpo ya no
  // desentona.
  app.setNotFoundHandler((peticion, respuesta) => {
    void respuesta.code(404).send(
      cuerpoDeError(
        'La ruta no existe.',
        `No hay ninguna operacion ${peticion.method} ${peticion.url} en esta API.`,
      ),
    );
  });

  // El tipo de `fallo` se anota a mano: sin él, TypeScript lo infiere `unknown`
  // —el manejador admite cualquier cosa lanzada, incluido un `throw 'texto'`— y
  // no dejaría leer ni `statusCode` ni `code`.
  app.setErrorHandler((fallo: FastifyError, peticion, respuesta) => {
    // `statusCode` lo trae todo error de Fastify (`415`, `413`, el `400` del
    // JSON roto). Un error lanzado por un handler no lo trae, y ese es el `500`
    // del contrato.
    const codigo = fallo.statusCode ?? 500;

    if (codigo >= 500) {
      // Lo único que se registra pase lo que pase. Sin esta línea, con
      // `logger: false`, un `500` desaparecería sin dejar rastro en ningún
      // sitio: el cliente ve un mensaje genérico y el servidor no ve nada.
      peticion.log.error({ err: fallo }, 'fallo no controlado');
      console.error('Fallo no controlado en', peticion.method, peticion.url, '->', fallo);

      // El `detalle` es fijo y no dice nada del fallo. `fallo.message` puede
      // llevar una ruta del disco o el texto de una excepción de terceros, y
      // eso no se le manda a un cliente.
      return respuesta
        .code(500)
        .send(
          cuerpoDeError(
            'Error interno del servidor.',
            'La peticion no se ha podido completar. Revise los logs del servidor.',
          ),
        );
    }

    return respuesta.code(codigo).send(traducirErrorDeFastify(fallo, codigo));
  });

  // Nota: los `4xx` que SÍ escribe una ruta (`respuesta.code(400).send(...)`)
  // no pasan por aquí. `setErrorHandler` solo ve lo que se lanza, no lo que se
  // envía, así que estos dos manejadores no pueden pisar el formato de los
  // nueve errores del contrato que `rutas/solicitudes.ts` ya construye.

  // ------------------------------------------------------------------
  // GET /api/salud
  //
  // La sonda de vida del contrato. Devuelve `{ ok: true }` y nada más: no
  // consulta el repositorio, no mide nada y no dice si los datos están bien.
  // Es la respuesta a "el proceso está en pie y sirve HTTP", que es justo lo
  // que `openapi.yaml` promete ("sonda de vida sin efectos secundarios").
  //
  // `ok` es constante porque no hay ningún camino por el que esta ruta pueda
  // devolver `false`: si el proceso estuviera caído no habría nadie para
  // contestar. El `false` del esquema existe para un futuro en el que la sonda
  // compruebe dependencias.
  // ------------------------------------------------------------------
  app.get('/api/salud', () => ({ ok: true }));

  // ------------------------------------------------------------------
  // GET /api/tipos  y  GET /api/operadores
  //
  // Los dos catálogos de solo lectura. Delegan en el repositorio y devuelven lo
  // que reciben: aquí no hay filtro, ni orden, ni transformación. El contrato
  // pide el array desnudo (`[...]`, no `{ datos, total }`), y eso es lo que
  // devuelve el repositorio.
  //
  // Una lista vacía es un `200` con `[]`, no un `404`. Está escrito en la
  // `description` de las dos operaciones, y se cumple justamente por no
  // escribir el `if` de más que lo rompería.
  //
  // No hay `try/catch`. El `500` del contrato lo produce el manejador de
  // errores por defecto de Fastify cuando el handler lanza, y envolverlo aquí
  // solo serviría para cambiar un error con traza por un mensaje peor. En la
  // práctica estos dos handlers no pueden fallar: leen de memoria.
  // ------------------------------------------------------------------
  app.get('/api/tipos', () => repositorio.listarTipos());

  app.get('/api/operadores', () => repositorio.listarOperadores());

  // ------------------------------------------------------------------
  // Las cuatro rutas de /api/solicitudes
  //
  // Estas no se escriben aquí. Las tres de arriba caben en una línea cada una
  // porque no validan nada ni deciden nada; las de `/solicitudes` tienen filtro,
  // creación, transiciones y cinco códigos de respuesta distintos, y meterlas
  // en este fichero convertiría la fábrica en un muro donde ya no se vería lo
  // único que este fichero quiere enseñar: que construye la app y NO la
  // arranca.
  //
  // Viven en `rutas/solicitudes.ts` y se enganchan con una llamada. No es un
  // `register()` de Fastify a propósito —no hace falta encapsulación, ni
  // prefijo, ni hooks propios—, así que es una función síncrona normal que
  // recibe la instancia y el repositorio y deja las rutas puestas. Los detalles
  // están allí.
  // ------------------------------------------------------------------
  registrarRutasDeSolicitudes(app, repositorio);

  // Sin `listen()`. Esa es toda la gracia del fichero.
  return app;
}

/* ------------------------------------------------------------------ *
 * Por qué se devuelve la instancia en vez de arrancarla.
 * ------------------------------------------------------------------ *
 *
 * Con esta forma, un test de las rutas no necesita puerto, ni `fetch`, ni
 * esperas, ni limpieza:
 *
 *   import { describe, expect, it } from 'vitest';
 *   import { crearApp } from './app';
 *
 *   describe('GET /api/salud', () => {
 *     it('responde 200 con { ok: true }', async () => {
 *       const app = crearApp();
 *
 *       const respuesta = await app.inject({ method: 'GET', url: '/api/salud' });
 *
 *       expect(respuesta.statusCode).toBe(200);
 *       expect(respuesta.json()).toEqual({ ok: true });
 *     });
 *   });
 *
 * `inject()` construye la petición en memoria y la mete por el mismo pipeline
 * que atendería a una petición real: enrutado, hooks, parseo y serialización.
 * Lo único que no ocurre es el viaje por el socket. Por eso el test comprueba
 * de verdad el `statusCode` y el JSON emitido, y no el valor de retorno del
 * handler llamado por separado.
 *
 * Si `crearApp` hiciera `listen()`, el mismo test tendría que pedir el puerto
 * 0, leer el que le hayan asignado, hacer `fetch`, y cerrar en un `afterEach`
 * —y seguiría sin comprobar nada más que lo que ya comprueba `inject`.
 */

/* ------------------------------------------------------------------ *
 * Interno: la forma de error del contrato, para lo que no es una ruta.
 * ------------------------------------------------------------------ */

// `rutas/solicitudes.ts` tiene su propia función `error()` con este mismo
// cometido, y no se comparte a propósito: aquella construye los errores QUE EL
// CONTRATO DESCRIBE, uno por cada `example` de openapi.yaml, y esta traduce los
// que produce el framework. Juntarlas en un módulo común ahorraría cuatro
// líneas y borraría esa distinción, que es justo lo que hay que poder ver de un
// vistazo cuando un error no sale como se esperaba.
function cuerpoDeError(mensaje: string, detalle: string): ErrorApi {
  return { mensaje, detalle };
}

/**
 * Traduce un error `4xx` de Fastify al cuerpo del contrato.
 *
 * Se reparte por `fallo.code`, la constante estable de Fastify
 * (`FST_ERR_CTP_INVALID_MEDIA_TYPE`), y no por el texto de `fallo.message`, que
 * no es API pública y cambia entre versiones menores.
 *
 * Los textos van en ASCII, misma regla que el resto del backend: esto sale por
 * la API.
 */
function traducirErrorDeFastify(fallo: FastifyError, codigo: number): ErrorApi {
  switch (fallo.code) {
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return cuerpoDeError(
        'El tipo de contenido no esta soportado.',
        "Esta API solo acepta 'application/json'.",
      );

    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return cuerpoDeError(
        'El cuerpo de la peticion no es JSON valido.',
        'El cuerpo no se ha podido interpretar como JSON. Revise comillas, comas y llaves.',
      );

    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return cuerpoDeError(
        'El cuerpo de la peticion es demasiado grande.',
        'El limite es de 1 MB por peticion.',
      );

    // La red de seguridad: cualquier otro `4xx` que Fastify invente. Aquí sí se
    // usa `fallo.message`, porque no hay nada mejor, y es seguro: un `4xx` del
    // framework describe lo que venía en la petición, no el interior del
    // servidor. Esa distinción es la que separa este `return` del `500`, donde
    // el mensaje NO se reenvía.
    default:
      return cuerpoDeError(`La peticion no es valida (${codigo}).`, fallo.message);
  }
}
