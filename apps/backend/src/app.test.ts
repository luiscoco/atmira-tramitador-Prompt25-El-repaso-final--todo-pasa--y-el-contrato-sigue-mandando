// Los tests de `app.ts`: lo que la fábrica pone alrededor de las rutas.
//
// `rutas/solicitudes.test.ts` cubre las siete operaciones del contrato. Este
// fichero cubre lo otro —lo que responde cuando NINGÚN handler llega a
// ejecutarse—, que hasta ahora no tenía ni un test:
//
//   CORS               ->  el preflight y las cabeceras que el frontend necesita
//   415 / 400 / 404    ->  los errores del framework, con la forma del contrato
//   500                ->  el handler que lanza, sin filtrar el interior
//
// `13. SERVIDOR.md` cerró con "No hay tests en el repo, otra vez" sobre este
// fichero, y con la duda de qué repositorio usaría: el de `data/` convierte los
// doce registros en un fixture implícito, y el doble obliga a construir siete
// métodos. Aquí se usan los dos, cada uno donde corresponde: el de verdad
// cuando la petición no llega a los datos —que es casi siempre en este
// fichero— y un doble que lanza para el único test que necesita un `500`.
//
// Misma regla de acentos que el resto del backend: comentarios acentuados, y
// los textos que se comparan con la respuesta en ASCII, porque son los que
// viajan por la API.

import type { ErrorApi, Operador, Solicitud, Tipo } from '@tramitador/contrato';
import { describe, expect, it, vi } from 'vitest';

import { crearApp } from './app';
import type { Repositorio } from './datos/repositorio';

/* ------------------------------------------------------------------ *
 * El doble que revienta.
 * ------------------------------------------------------------------ */

/**
 * Un repositorio cuyos siete métodos lanzan.
 *
 * Sirve para dos cosas opuestas y por eso vive aquí arriba: provocar el `500`
 * —el único fallo que ninguna entrada del cliente puede causar, porque las
 * rutas validan todo lo que llega— y demostrar lo contrario, que `/api/salud`
 * contesta sin tocar los datos.
 *
 * `listarSolicitudes` lanza con una ruta de disco en el mensaje a propósito: es
 * lo que el `500` NO debe reenviar al cliente.
 */
const repositorioQueLanza = (): Repositorio => {
  const revienta = (): never => {
    throw new Error('el disco se ha puesto a arder en /home/secreto/data');
  };

  return {
    listarSolicitudes: revienta,
    obtenerSolicitud: revienta,
    guardarSolicitud: revienta,
    existeTipo: revienta,
    listarTipos: revienta,
    listarOperadores: revienta,
    referencias: revienta,
  };
};

/* ------------------------------------------------------------------ *
 * Constantes del escenario.
 * ------------------------------------------------------------------ */

// El origen del servidor de desarrollo de Vite. Escrito aquí y en `app.ts`, a
// mano en los dos sitios: si alguien cambia el puerto del frontend, este test
// es el que se lo recuerda.
const ORIGEN_VITE = 'http://localhost:5173';

// Un origen que no está en la lista. El nombre no es casual: `evil.example` es
// un dominio reservado para ejemplos, así que no existe y no puede dejar de
// existir.
const ORIGEN_AJENO = 'https://evil.example';

/* ------------------------------------------------------------------ *
 * Las tres rutas que vivían en app.ts sin un solo test
 * ------------------------------------------------------------------ */

// `15. TESTS-RUTAS.md` las dejó anotadas: "/api/salud, /api/tipos y
// /api/operadores siguen sin tests". Son, además, las dos primeras llamadas que
// va a hacer el frontend —los catálogos con los que pinta cualquier formulario—
// así que servirlas mal se nota en la primera pantalla.

describe('GET /api/salud', () => {
  it('devuelve { ok: true } sin consultar el repositorio', () => {
    // El doble lanza en los siete métodos. Que esta ruta conteste `200` es la
    // prueba de que no toca los datos: si los tocara, este test reventaría con
    // el error del doble en vez de pasar.
    const app = crearApp(repositorioQueLanza());

    return app
      .inject({ method: 'GET', url: '/api/salud' })
      .then((respuesta) => {
        expect(respuesta.statusCode).toBe(200);
        expect(respuesta.json()).toEqual({ ok: true });
      });
  });
});

describe('GET /api/tipos y GET /api/operadores', () => {
  it('devuelven el array desnudo, sin envoltorio', () => {
    // El contrato pide `[...]`, no `{ datos, total }`. Es lo primero que un
    // cliente asume y lo último que alguien se acuerda de comprobar.
    const app = crearApp();

    return Promise.all([
      app.inject({ method: 'GET', url: '/api/tipos' }),
      app.inject({ method: 'GET', url: '/api/operadores' }),
    ]).then(([tipos, operadores]) => {
      expect(tipos.statusCode).toBe(200);
      expect(Array.isArray(tipos.json())).toBe(true);

      expect(operadores.statusCode).toBe(200);
      expect(Array.isArray(operadores.json())).toBe(true);
    });
  });

  it('sirven los campos que el contrato declara, y solo esos', async () => {
    const app = crearApp();

    const tipos = await app.inject({ method: 'GET', url: '/api/tipos' });
    const operadores = await app.inject({ method: 'GET', url: '/api/operadores' });

    for (const tipo of tipos.json<Tipo[]>()) {
      expect(Object.keys(tipo).sort()).toEqual(['descripcion', 'id', 'nombre']);
    }

    for (const operador of operadores.json<Operador[]>()) {
      expect(Object.keys(operador).sort()).toEqual(['id', 'nombre']);
    }
  });

  it('el tipo de cada solicitud existe en el catalogo', async () => {
    // La coherencia que el frontend va a dar por hecha en cuanto escriba
    // `tipos.find(t => t.id === solicitud.tipo).nombre`. El repositorio ya la
    // impone al arrancar; esto comprueba que llega intacta hasta la API.
    const app = crearApp();

    const tipos = await app.inject({ method: 'GET', url: '/api/tipos' });
    const solicitudes = await app.inject({ method: 'GET', url: '/api/solicitudes' });

    const ids = new Set(tipos.json<Tipo[]>().map((tipo) => tipo.id));

    for (const solicitud of solicitudes.json<Solicitud[]>()) {
      expect(ids.has(solicitud.tipo), `${solicitud.referencia} -> ${solicitud.tipo}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * CORS
 * ------------------------------------------------------------------ */

describe('CORS', () => {
  it('responde al preflight del frontend', async () => {
    const app = crearApp();

    // Esto es exactamente lo que manda un navegador antes de un `POST` con
    // `Content-Type: application/json`: un `OPTIONS` con los dos `Request-`.
    // Sin plugin de CORS, el enrutador no encuentra `OPTIONS` sobre esa URL y
    // contesta `404`, que es lo que hacía antes de este cambio.
    const respuesta = await app.inject({
      method: 'OPTIONS',
      url: '/api/solicitudes',
      headers: {
        origin: ORIGEN_VITE,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(respuesta.statusCode).toBeLessThan(300);
    expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN_VITE);
    expect(String(respuesta.headers['access-control-allow-methods'])).toContain('POST');
    expect(String(respuesta.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'content-type',
    );
  });

  it('marca la respuesta real con el origen permitido', async () => {
    // El preflight solo da permiso para preguntar. Si la respuesta de verdad no
    // trae la cabecera, el navegador la descarta igual y el `fetch` del
    // frontend rechaza con un error de red que no dice nada.
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/salud',
      headers: { origin: ORIGEN_VITE },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN_VITE);
  });

  it('no marca la respuesta para un origen que no esta en la lista', async () => {
    // El test que le da sentido al anterior: sin esto, un `origin: true` o un
    // `'*'` pasarían los dos de arriba con nota.
    //
    // La petición se responde igual —CORS no es un cortafuegos: lo que protege
    // es la lectura de la respuesta desde otra página, y `curl` nunca ha mirado
    // estas cabeceras—. Lo que se comprueba es que el permiso NO se da.
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/salud',
      headers: { origin: ORIGEN_AJENO },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('permite sustituir la lista de origenes', async () => {
    // La opción existe para que el día que el frontend se sirva desde otro
    // sitio no haya que tocar `app.ts`. Es la misma regla que el logger y que
    // el puerto: la fábrica construye, el entorno decide.
    const app = crearApp(undefined, { origenes: [ORIGEN_AJENO] });

    const permitido = await app.inject({
      method: 'GET',
      url: '/api/salud',
      headers: { origin: ORIGEN_AJENO },
    });

    const yaNo = await app.inject({
      method: 'GET',
      url: '/api/salud',
      headers: { origin: ORIGEN_VITE },
    });

    expect(permitido.headers['access-control-allow-origin']).toBe(ORIGEN_AJENO);
    expect(yaNo.headers['access-control-allow-origin']).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Los errores que no escribe ninguna ruta
 * ------------------------------------------------------------------ */

describe('los errores del framework tienen la forma del contrato', () => {
  // La afirmación que se repite en los cuatro tests de abajo, escrita una vez:
  // un cuerpo de error del contrato es `{ mensaje, detalle }` y nada más. El
  // `not.toHaveProperty` es la mitad importante: sin él, un cuerpo de Fastify
  // al que alguien añadiera un `mensaje` pasaría el test.
  const esErrorDelContrato = (cuerpo: ErrorApi): void => {
    expect(typeof cuerpo.mensaje).toBe('string');
    expect(typeof cuerpo.detalle).toBe('string');
    expect(cuerpo).not.toHaveProperty('statusCode');
    expect(cuerpo).not.toHaveProperty('error');
    expect(cuerpo).not.toHaveProperty('message');
  };

  it('un Content-Type no soportado da 415, no un 400 de negocio', async () => {
    // Antes de quitar el parser de `text/plain`, esto contestaba
    // `400 La accion solicitada no es valida` —un error de negocio para lo que
    // es un error de formato— porque el cuerpo llegaba al handler como cadena.
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      headers: { 'content-type': 'text/plain' },
      payload: 'hola',
    });

    expect(respuesta.statusCode).toBe(415);

    const cuerpo = respuesta.json<ErrorApi>();
    esErrorDelContrato(cuerpo);
    expect(cuerpo.mensaje).toBe('El tipo de contenido no esta soportado.');
  });

  it('un JSON roto da 400 con el formato del contrato', async () => {
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      headers: { 'content-type': 'application/json' },
      payload: '{roto',
    });

    expect(respuesta.statusCode).toBe(400);

    const cuerpo = respuesta.json<ErrorApi>();
    esErrorDelContrato(cuerpo);
    expect(cuerpo.mensaje).toBe('El cuerpo de la peticion no es JSON valido.');
  });

  it('un cuerpo demasiado grande da 413 con el formato del contrato', async () => {
    // El límite es el de Fastify (1 MB), que no se toca: lo que se fija aquí es
    // que al pasarse, el cliente recibe un error del contrato y no el
    // `{ statusCode, code, error, message }` del framework.
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ tipo: 'alta-cuenta', solicitante: 'A'.repeat(2_000_000) }),
    });

    expect(respuesta.statusCode).toBe(413);

    const cuerpo = respuesta.json<ErrorApi>();
    esErrorDelContrato(cuerpo);
    expect(cuerpo.mensaje).toBe('El cuerpo de la peticion es demasiado grande.');
  });

  it('una ruta que no existe da 404 con el formato del contrato', async () => {
    const app = crearApp();

    const respuesta = await app.inject({ method: 'GET', url: '/api/inventada' });

    expect(respuesta.statusCode).toBe(404);

    const cuerpo = respuesta.json<ErrorApi>();
    esErrorDelContrato(cuerpo);
    expect(cuerpo.detalle).toContain('GET /api/inventada');
  });

  it('un verbo no registrado sigue dando 404, pero con el formato del contrato', async () => {
    // `5. RUTAS.md` da el `405` por delegado al framework, y Fastify responde
    // `404` a un verbo que no existe sobre una URL que sí. Eso no se cambia
    // aquí; lo que este test fija es que el cuerpo ya no desentona.
    const app = crearApp();

    const respuesta = await app.inject({ method: 'DELETE', url: '/api/solicitudes' });

    expect(respuesta.statusCode).toBe(404);
    esErrorDelContrato(respuesta.json<ErrorApi>());
  });
});

/* ------------------------------------------------------------------ *
 * El 500
 * ------------------------------------------------------------------ */

describe('un fallo no controlado', () => {
  it('da 500 con el formato del contrato y sin filtrar el mensaje interno', async () => {
    // `console.error` se silencia: el manejador escribe ahí a propósito —un
    // `500` no puede desaparecer sin rastro— y sin esto la salida de vitest se
    // llenaría del error que este test provoca queriendo.
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const app = crearApp(repositorioQueLanza());

      const respuesta = await app.inject({ method: 'GET', url: '/api/solicitudes' });

      expect(respuesta.statusCode).toBe(500);

      const cuerpo = respuesta.json<ErrorApi>();
      expect(cuerpo.mensaje).toBe('Error interno del servidor.');

      // Lo que de verdad importa de este test. El mensaje de la excepción lleva
      // una ruta del disco, y un cuerpo de error que la reenviara le estaría
      // contando al cliente cómo está montado el servidor. Se comprueba sobre
      // la respuesta entera, no solo sobre `detalle`, por si algún día alguien
      // añade un campo.
      expect(JSON.stringify(cuerpo)).not.toContain('/home/secreto');
      expect(JSON.stringify(cuerpo)).not.toContain('arder');

      // Y la otra mitad: el fallo no se traga. Lo que no va al cliente tiene
      // que estar en el servidor.
      expect(consola).toHaveBeenCalled();
    } finally {
      consola.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Las opciones de la fábrica
 * ------------------------------------------------------------------ */

describe('crearApp: las opciones', () => {
  it('sin opciones no escribe una sola linea', async () => {
    // El valor por defecto que la suite necesita, fijado para que nadie lo
    // cambie sin darse cuenta: 133 tests inyectando peticiones con el logger
    // encendido son 133 líneas de JSON entre los resultados.
    //
    // Se comprueba el comportamiento y no `app.log.level`: con `logger: false`
    // Fastify instala un logger que no hace nada y cuyo `level` es `undefined`,
    // así que afirmar sobre esa propiedad sería afirmar sobre un detalle de
    // cómo lo apaga, no sobre que esté apagado.
    const lineas: string[] = [];
    const app = crearApp();

    const escribir = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((texto: string | Uint8Array) => {
        lineas.push(String(texto));

        return true;
      });

    try {
      await app.inject({ method: 'GET', url: '/api/salud' });
    } finally {
      escribir.mockRestore();
    }

    expect(lineas).toHaveLength(0);
  });

  it('con un logger, registra la peticion', async () => {
    // La otra mitad: que la opción esté conectada de verdad. Sin este test,
    // un `crearApp` que ignorara `opciones.logger` pasaría el de arriba.
    //
    // Se le pasa un stream propio en vez de `logger: true` para no depender de
    // dónde escriba Fastify por defecto, y para poder leer lo escrito.
    const lineas: string[] = [];

    const app = crearApp(undefined, {
      logger: {
        level: 'info',
        stream: {
          write: (linea: string) => {
            lineas.push(linea);
          },
        },
      },
    });

    await app.inject({ method: 'GET', url: '/api/salud' });

    expect(lineas.length).toBeGreaterThan(0);

    // Y que lo registrado sirva para algo: la URL tiene que estar ahí. Es lo
    // que va a hacer falta para depurar por qué una peticion del frontend no
    // llega donde se cree.
    expect(lineas.join('')).toContain('/api/salud');
  });
});
