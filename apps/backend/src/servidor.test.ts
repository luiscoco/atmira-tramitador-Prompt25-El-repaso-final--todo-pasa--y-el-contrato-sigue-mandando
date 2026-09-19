// El test de humo de `servidor.ts`: el único que arranca un proceso de verdad.
//
// Todo lo demás de la suite usa `app.inject()` y no abre un socket, que es
// deliberado y es lo que permite correr 160 tests en un segundo. El precio
// estaba anotado en `16. ARRANQUE.md`: **ningún test ejercitaba
// `servidor.ts`**. Si alguien rompía el `listen()`, el parseo de `PORT` o el
// orden del arranque, la suite seguía en verde y el fallo aparecía al arrancar
// a mano.
//
// Este fichero cierra ese hueco, y es el único sitio donde eso se puede hacer:
// `servidor.ts` tiene efectos con solo ejecutarse —lee el entorno, abre el
// puerto, escribe por consola— y por eso NADIE lo importa. Un `import` desde un
// test dejaría un socket abierto en el proceso de vitest. La única forma de
// probarlo es lanzarlo como lo lanza `npm run dev`: un proceso aparte.
//
// Lo que NO se prueba aquí, a propósito: que sin `PORT` arranque en el 3001.
// Ese es justo el puerto donde estará corriendo el `npm run dev` de quien
// ejecute los tests, y un test que se pelee con él fallaría por el motivo
// equivocado —`EADDRINUSE`— en la máquina de cualquiera que esté trabajando.

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createServer } from 'node:net';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Arrancar `tsx` cuesta un par de segundos, muy por encima de los 5 s por
// defecto de vitest. Se sube el límite en cada `it` en vez de globalmente: el
// resto de la suite debe seguir fallando rápido si se cuelga.
const MARGEN = 30_000;

// El tipo que produce `stdio: ['ignore', 'pipe', 'pipe']`: sin stdin, con las dos
// salidas por tuberia.
type Servidor = ChildProcessByStdio<null, Readable, Readable>;

const SERVIDOR = fileURLToPath(new URL('./servidor.ts', import.meta.url));

/**
 * Un puerto que el sistema operativo dice tener libre.
 *
 * Se abre un socket en el puerto `0` —"dame uno cualquiera"—, se lee cuál tocó
 * y se cierra. Queda una ventana mínima entre el cierre y el `listen` del hijo
 * en la que otro proceso podría cogerlo; es la forma estándar de hacer esto y
 * la alternativa —un número fijo— falla mucho más a menudo, porque dos
 * ejecuciones de la suite a la vez elegirían el mismo.
 *
 * `servidor.ts` rechaza `PORT=0` a propósito (quien escribe `PORT` quiere un
 * puerto concreto), así que el `0` se usa aquí y nunca se le pasa al hijo.
 */
const puertoLibre = async (): Promise<number> =>
  new Promise((resolver, rechazar) => {
    const sonda = createServer();

    sonda.once('error', rechazar);
    sonda.listen(0, '127.0.0.1', () => {
      const direccion = sonda.address();

      if (direccion === null || typeof direccion === 'string') {
        sonda.close();
        rechazar(new Error('no se ha podido reservar un puerto'));

        return;
      }

      sonda.close(() => {
        resolver(direccion.port);
      });
    });
  });

/** Lanza `servidor.ts` como lo lanza `npm run dev`, con el entorno indicado. */
const arrancar = (entorno: Record<string, string>): Servidor =>
  // `node --import tsx` y no el binario `tsx`: en Windows ese binario es un
  // `.cmd`, y `spawn` de un `.cmd` exige `shell: true`, que mete una capa de
  // proceso por medio y deja al servidor huérfano al matar al padre. Es el
  // mismo fallo que dejó vivos los servidores del Prompt 13.
  spawn(process.execPath, ['--import', 'tsx', SERVIDOR], {
    env: { ...process.env, ...entorno },
    // El hijo no hereda la consola de vitest: su salida se lee por la tubería.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * Espera a que el proceso escriba algo que case con `senal`, o a que muera.
 *
 * Se espera a la línea y no a un `setTimeout` fijo: un `sleep(2000)` sería
 * lento cuando arranca rápido y flaky cuando la máquina va cargada.
 */
const esperarSalida = (proceso: Servidor, senal: RegExp): Promise<string> =>
  new Promise((resolver, rechazar) => {
    let acumulado = '';

    const mirar = (trozo: Buffer): void => {
      acumulado += trozo.toString();

      if (senal.test(acumulado)) resolver(acumulado);
    };

    proceso.stdout.on('data', mirar);
    proceso.stderr.on('data', mirar);

    proceso.once('exit', (codigo) => {
      // Si murió sin escribir lo esperado, el error lleva lo que sí escribió:
      // sin eso, el fallo sería "timeout" y habría que reproducirlo a mano.
      if (!senal.test(acumulado)) {
        rechazar(new Error(`el proceso termino con codigo ${codigo}. Salida:\n${acumulado}`));
      }
    });
  });

describe('servidor.ts', () => {
  it(
    'arranca, escucha en el PORT indicado y responde',
    async () => {
      const puerto = await puertoLibre();
      const proceso = arrancar({ PORT: String(puerto) });

      try {
        const salida = await esperarSalida(proceso, /escuchando/);

        // La línea se escribe DESPUÉS de que `listen()` resuelva, no antes: si
        // aparece, el socket está abierto de verdad. Y lleva el puerto, que es
        // lo que hace útil el mensaje.
        expect(salida).toContain(`http://127.0.0.1:${puerto}/api`);

        // La prueba que `inject()` no puede dar: una petición por la red, con
        // su socket, su cabecera y su parseo.
        const respuesta = await fetch(`http://127.0.0.1:${puerto}/api/salud`);

        expect(respuesta.status).toBe(200);
        expect(await respuesta.json()).toEqual({ ok: true });
      } finally {
        // En el `finally` y no al final del `try`: si una expectativa falla, el
        // proceso tiene que morir igual o se queda escuchando hasta que alguien
        // lo note.
        proceso.kill();
      }
    },
    MARGEN,
  );

  it(
    'se niega a arrancar con un PORT que no es un puerto',
    async () => {
      // El caso que `13. SERVIDOR.md` razona: `listen({ port: NaN })` no falla
      // de forma legible —Node lo tomaría como puerto 0 y arrancaría en uno
      // aleatorio, "parece que funciona"—. Se prefiere reventar diciendo qué se
      // leyó, y esto lo fija.
      const proceso = arrancar({ PORT: 'ochenta' });

      try {
        const salida = await esperarSalida(proceso, /PORT no es un puerto valido/);

        expect(salida).toContain('ochenta');
      } finally {
        proceso.kill();
      }
    },
    MARGEN,
  );

  it(
    'no se queda a medias si el puerto esta ocupado',
    async () => {
      // El fallo que aparecio dos veces durante el desarrollo: un servidor
      // huerfano en el puerto, el arranque nuevo fallando en silencio y las
      // peticiones contestadas por el proceso viejo. Lo que se fija es que el
      // proceso nuevo MUERE en vez de quedarse vivo sin escuchar.
      const puerto = await puertoLibre();
      const ocupante = createServer();

      await new Promise<void>((resolver) => {
        ocupante.listen(puerto, '127.0.0.1', resolver);
      });

      const proceso = arrancar({ PORT: String(puerto) });

      try {
        const salida = await esperarSalida(proceso, /EADDRINUSE|No se pudo arrancar/);

        expect(salida).toMatch(/EADDRINUSE|No se pudo arrancar/);

        // Y que termine, no que se quede colgado: un proceso vivo que no
        // escucha es peor que uno muerto, porque `npm run dev` parecería estar
        // funcionando.
        const codigo = await new Promise<number | null>((resolver) => {
          if (proceso.exitCode !== null) {
            resolver(proceso.exitCode);

            return;
          }

          proceso.once('exit', resolver);
        });

        expect(codigo).not.toBe(0);
      } finally {
        proceso.kill();
        ocupante.close();
      }
    },
    MARGEN,
  );
});
