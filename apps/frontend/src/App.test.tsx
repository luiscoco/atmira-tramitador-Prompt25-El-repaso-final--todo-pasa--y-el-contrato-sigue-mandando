/**
 * @vitest-environment jsdom
 */

// El primer test de INTEGRACION del frontend: monta `<App>` entera y recorre el
// viaje completo de una aprobacion, sin mockear ningun componente.
//
// La diferencia con `componentes/Bandeja.test.tsx` no es el tamano, es lo que
// se prueba. Alli se le daban props a un componente y se miraba lo que pintaba;
// aqui no se le da nada a nadie: se monta la aplicacion, se pulsan botones y se
// comprueba lo que ve quien la usa. Lo unico que se sustituye es `fetch`, que
// es la frontera real de la aplicacion —todo lo demas (el estado de `App`, el
// cruce de catalogos de `etiquetas.ts`, la tabla de `dominio/acciones.ts`, los
// tres componentes) corre de verdad—.
//
// Lo que este fichero fija, y que ningun test unitario podia fijar:
//
//   - Que la seleccion viaja de `<Bandeja>` a `<App>` y de `<App>` a
//     `<Detalle>`. Tres ficheros y dos props tienen que encajar para que
//     pulsar una fila cambie la ficha de la derecha.
//   - Que los botones que se pintan salen del estado ACTUAL de la solicitud.
//     Una `enviada` ensena "Aprobar" y "Rechazar", y no "Enviar", porque eso
//     es lo que dice la maquina de estados.
//   - Que `ocupado` bloquea de verdad mientras el `POST` esta en vuelo. Este es
//     el unico punto del recorrido que no se puede ver desde fuera sin
//     controlar CUANDO responde la red, y de ahi la promesa diferida de abajo.
//   - Que al resolverse, la fila de la izquierda y la ficha de la derecha dicen
//     lo mismo. Es la comprobacion que justifica la decision mas importante de
//     `App.tsx`: guardar el id y derivar la solicitud, en vez de guardar una
//     segunda copia del objeto que se quedaria en 'enviada' para siempre.
//
// Acentos: comentarios acentuados, cadenas comparadas en ASCII, igual que en el
// resto de la suite.

import type { Operador, Solicitud, Tipo } from '@tramitador/contrato';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// `cleanup` a mano porque `globals` no esta activado en Vitest (mismo motivo
// que explica `Bandeja.test.tsx`), y `unstubAllGlobals` para que el `fetch`
// falso no sobreviva al test que lo puso.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * Los datos simulados.
 * ------------------------------------------------------------------ */

// Escritos a mano y no leidos de `data/*.json`, por lo mismo que en
// `Bandeja.test.tsx`: los ficheros de datos son un hecho del repo y atar estos
// tests a ellos los pondria rojos el dia que alguien anada un registro.
const TIPOS = [
  {
    id: 'alta-cuenta',
    nombre: 'Alta de cuenta',
    descripcion: 'Apertura de una cuenta nueva para un cliente.',
  },
  {
    id: 'cambio-titular',
    nombre: 'Cambio de titular',
    descripcion: 'Cambio del titular de una cuenta existente.',
  },
] as const satisfies readonly Tipo[];

const OPERADORES = [
  { id: 'op-0042', nombre: 'Lucia Ferrer Ortiz' },
] as const satisfies readonly Operador[];

/** La protagonista: es la unica en 'enviada', y por tanto la unica con dos
 *  acciones posibles. */
const ENVIADA = {
  id: '11111111-1111-4111-8111-111111111111',
  referencia: 'SOL-2026-0001',
  tipo: 'alta-cuenta',
  solicitante: 'Marta Ruiz Delgado',
  estado: 'enviada',
  operador: null,
  creadaEn: '2026-02-11T09:14:32Z',
  actualizadaEn: '2026-02-12T08:00:00Z',
} as const satisfies Solicitud;

// Las otras dos no son relleno. La de 'borrador' es la que da sentido al paso 3
// del enunciado: "Enviar" NO aparece porque el estado de la seleccionada no lo
// permite, y no porque ese boton no exista en ninguna parte de la aplicacion.
// La 'rechazada' cubre el otro extremo, un estado final que ya no ofrece nada.
const BORRADOR = {
  id: '22222222-2222-4222-8222-222222222222',
  referencia: 'SOL-2026-0002',
  tipo: 'cambio-titular',
  solicitante: 'Javier Nunez Prieto',
  estado: 'borrador',
  operador: null,
  creadaEn: '2026-02-13T10:00:00Z',
  actualizadaEn: '2026-02-13T10:00:00Z',
} as const satisfies Solicitud;

const RECHAZADA = {
  id: '33333333-3333-4333-8333-333333333333',
  referencia: 'SOL-2026-0003',
  tipo: 'alta-cuenta',
  solicitante: 'Ana Gil Sanz',
  estado: 'rechazada',
  operador: 'op-0042',
  creadaEn: '2026-02-09T08:00:00Z',
  actualizadaEn: '2026-02-10T16:45:00Z',
} as const satisfies Solicitud;

const SOLICITUDES = [ENVIADA, BORRADOR, RECHAZADA] as const satisfies
  readonly Solicitud[];

/**
 * Lo que contesta el `POST` cuando la aprobacion sale bien.
 *
 * Es la solicitud ENTERA y actualizada, no un `{ ok: true }`: asi lo declara
 * `openapi.yaml` y en eso se apoya `aplicarAccion` para sustituir el elemento
 * de la lista sin volver a pedirla. `operador` y `actualizadaEn` cambian
 * tambien, que es lo que haria el backend de verdad.
 */
const APROBADA = {
  ...ENVIADA,
  estado: 'aprobada',
  operador: 'op-0042',
  actualizadaEn: '2026-02-14T12:30:00Z',
} as const satisfies Solicitud;

/* ------------------------------------------------------------------ *
 * El `fetch` falso.
 * ------------------------------------------------------------------ */

/**
 * Una respuesta con lo justo que mira `api/cliente.ts`.
 *
 * Se construye un objeto a mano en vez de usar `new Response(...)` a proposito:
 * `pedir` solo lee `ok`, `status` y `json()`, y depender del `Response` global
 * ataria el test a que el entorno de jsdom lo exponga. Lo que se simula es el
 * contrato que la aplicacion consume, no la clase entera del navegador.
 */
function respuestaJson(cuerpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(cuerpo),
  } as unknown as Response;
}

/** Una peticion tal y como la vio el `fetch` falso. */
interface Llamada {
  readonly metodo: string;
  readonly ruta: string;
  readonly cuerpo: string | null;
}

/**
 * Instala el `fetch` falso y devuelve el mando a distancia de la transicion.
 *
 * La pieza que hace posible el paso 5 es `resolverTransicion`: el `POST`
 * devuelve una promesa que NO se resuelve sola, asi que la aplicacion se queda
 * —de verdad, no con un temporizador simulado— en el estado "peticion en
 * vuelo" hasta que el test decida terminarla. Sin esto, la respuesta llegaria
 * en el mismo tick que el clic y `ocupado === true` no seria observable en
 * ningun momento: el test pasaria a verde sin haber comprobado nada.
 */
function simularApi() {
  const llamadas: Llamada[] = [];

  let resolverTransicion!: (respuesta: Response) => void;
  const transicion = new Promise<Response>((cumplir) => {
    resolverTransicion = cumplir;
  });

  const falso = vi.fn(
    (entrada: RequestInfo | URL, opciones?: RequestInit): Promise<Response> => {
      const ruta = String(entrada);
      const metodo = opciones?.method ?? 'GET';

      llamadas.push({
        metodo,
        ruta,
        cuerpo: typeof opciones?.body === 'string' ? opciones.body : null,
      });

      // Las tres cargas iniciales contestan al momento: lo que se quiere
      // observar despacio es la transicion, no el arranque.
      if (metodo === 'GET' && ruta === '/api/solicitudes') {
        return Promise.resolve(respuestaJson(SOLICITUDES));
      }

      if (metodo === 'GET' && ruta === '/api/tipos') {
        return Promise.resolve(respuestaJson(TIPOS));
      }

      if (metodo === 'GET' && ruta === '/api/operadores') {
        return Promise.resolve(respuestaJson(OPERADORES));
      }

      if (
        metodo === 'POST' &&
        ruta === `/api/solicitudes/${ENVIADA.id}/transiciones`
      ) {
        return transicion;
      }

      // Cualquier otra cosa es un fallo del test, no de la aplicacion, y tiene
      // que decirlo con el metodo y la ruta delante. Un mock que contesta algo
      // por defecto convierte "la aplicacion llama a donde no debe" en un
      // assert raro treinta lineas mas abajo.
      return Promise.reject(
        new Error(`peticion no simulada: ${metodo} ${ruta}`),
      );
    },
  );

  vi.stubGlobal('fetch', falso);

  return { llamadas, resolverTransicion };
}

/* ------------------------------------------------------------------ *
 * Consultas por lo que se ve.
 * ------------------------------------------------------------------ */

/**
 * La ficha de la derecha.
 *
 * Se localiza por su rol —`<section aria-labelledby>` es un `region`— y no por
 * una clase ni por un `data-testid`: es el mismo elemento que anuncia un lector
 * de pantalla al llegar a ella, asi que la consulta comprueba de paso que la
 * seccion sigue teniendo nombre accesible.
 */
function detalle() {
  return within(screen.getByRole('region'));
}

/** Las filas de la bandeja, sin la de cabecera. */
function fila(indice: number): HTMLElement {
  const [, ...filas] = screen.getAllByRole('row');
  const encontrada = filas[indice];

  if (encontrada === undefined) {
    throw new Error(`No hay fila de datos en la posicion ${String(indice)}.`);
  }

  return encontrada;
}

/**
 * `true` si el boton con ese nombre esta deshabilitado.
 *
 * Se lee el atributo y no `.disabled` para no tener que castear a
 * `HTMLButtonElement`: lo que se comprueba es lo que hay en el DOM, que es
 * tambien lo que decide si el navegador deja pulsar.
 */
function deshabilitado(nombre: string): boolean {
  return screen.getByRole('button', { name: nombre }).hasAttribute('disabled');
}

/* ------------------------------------------------------------------ *
 * El recorrido.
 * ------------------------------------------------------------------ */

describe('el flujo completo de una aprobacion', () => {
  it('carga la bandeja, selecciona una enviada, aprueba y refleja el cambio en los dos sitios', async () => {
    const usuario = userEvent.setup();
    const { llamadas, resolverTransicion } = simularApi();

    /* ------------------------------------------------------------ *
     * 1. Al montar, la bandeja carga y ensena las solicitudes.
     * ------------------------------------------------------------ */

    render(<App />);

    // Antes de que conteste nadie no hay bandeja, hay cartel. Se comprueba
    // porque es el unico momento en que `cargando` es visible, y porque fija
    // que la carga inicial SUSTITUYE la pantalla en vez de pintar una tabla
    // vacia que luego se rellena.
    expect(screen.getByText('Cargando…')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();

    // `findBy*` espera a que las tres promesas se resuelvan y React repinte.
    const tabla = await screen.findByRole('table');

    expect(tabla).toBeDefined();
    // Tres solicitudes mas la fila de cabecera, que tambien es un `row`.
    expect(screen.getAllByRole('row')).toHaveLength(SOLICITUDES.length + 1);

    // Las tres cargas salieron, y ninguna otra. Es la mitad que no se ve en
    // pantalla: que la aplicacion pide exactamente lo que necesita.
    expect(llamadas.map((llamada) => llamada.ruta)).toEqual([
      '/api/solicitudes',
      '/api/tipos',
      '/api/operadores',
    ]);

    // Y lo que se lee en la primera fila es el dato ya traducido: el NOMBRE del
    // tipo, no el id del catalogo, y el estado en un chip.
    const primeraFila = within(fila(0));

    expect(
      primeraFila.getByRole('button', { name: 'SOL-2026-0001' }),
    ).toBeDefined();
    expect(primeraFila.getByText('Alta de cuenta')).toBeDefined();
    expect(primeraFila.getByText('Marta Ruiz Delgado')).toBeDefined();
    expect(primeraFila.getByText('Enviada').getAttribute('data-estado')).toBe(
      'enviada',
    );

    // Sin seleccion, la ficha lo dice en vez de quedarse en blanco.
    expect(detalle().getByText('Elige una solicitud.')).toBeDefined();

    /* ------------------------------------------------------------ *
     * 2. El usuario selecciona la solicitud "enviada".
     * ------------------------------------------------------------ */

    await usuario.click(screen.getByRole('button', { name: 'SOL-2026-0001' }));

    // La fila queda marcada —`aria-current`, que es la mitad del realce que
    // llega a un lector de pantalla— y la ficha pasa a hablar de ella.
    expect(fila(0).getAttribute('aria-current')).toBe('true');
    expect(fila(1).hasAttribute('aria-current')).toBe(false);

    expect(
      detalle().getByRole('heading', { level: 2 }).textContent,
    ).toContain('SOL-2026-0001');
    // El operador todavia es `null`, y eso se traduce, no se deja vacio.
    expect(detalle().getByText('Sin asignar')).toBeDefined();

    /* ------------------------------------------------------------ *
     * 3. El detalle ofrece "aprobar" y "rechazar", no "enviar".
     * ------------------------------------------------------------ */

    expect(detalle().getByRole('button', { name: 'Aprobar' })).toBeDefined();
    expect(detalle().getByRole('button', { name: 'Rechazar' })).toBeDefined();

    // La otra mitad, que es la que de verdad fija el requisito: "Enviar" no
    // esta. Sale de 'borrador', y la seleccionada ya no lo es —la solicitud
    // SOL-2026-0002 de la bandeja si lo esta, asi que el boton existe en la
    // aplicacion; lo que decide es el estado de la que se esta mirando—.
    expect(detalle().queryByRole('button', { name: 'Enviar' })).toBeNull();

    // Y los dos que hay estan en el orden canonico del contrato, no en el de
    // insercion de un objeto.
    expect(
      detalle()
        .getAllByRole('button')
        .map((boton) => boton.textContent),
    ).toEqual(['Aprobar', 'Rechazar']);

    /* ------------------------------------------------------------ *
     * 4. Clic en "aprobar".
     * ------------------------------------------------------------ */

    await usuario.click(detalle().getByRole('button', { name: 'Aprobar' }));

    // Salio UN solo `POST`, a la ruta de la solicitud seleccionada y con la
    // accion en el cuerpo. El id no viaja en el cuerpo: va en la URL, como dice
    // el contrato.
    expect(llamadas).toHaveLength(4);
    expect(llamadas[3]).toEqual({
      metodo: 'POST',
      ruta: `/api/solicitudes/${ENVIADA.id}/transiciones`,
      cuerpo: JSON.stringify({ accion: 'aprobar' }),
    });

    /* ------------------------------------------------------------ *
     * 5. Mientras la peticion esta en curso, los botones estan
     *    deshabilitados.
     * ------------------------------------------------------------ */

    // La promesa del `POST` sigue sin resolverse: esto es exactamente lo que ve
    // el usuario durante el viaje de red.
    expect(deshabilitado('Aprobar')).toBe(true);
    expect(deshabilitado('Rechazar')).toBe(true);
    expect(deshabilitado('Recargar')).toBe(true);

    // Deshabilitados, no desaparecidos. Un boton que se esconde mientras dura
    // la peticion mueve a los de al lado bajo el cursor y el siguiente clic cae
    // en el equivocado.
    expect(detalle().getAllByRole('button')).toHaveLength(2);

    // Y nada ha cambiado todavia: sin actualizacion optimista, la fila y la
    // ficha siguen diciendo 'enviada' hasta que conteste el servidor.
    expect(within(fila(0)).getByText('Enviada')).toBeDefined();

    // Un segundo clic no manda nada, que es justo para lo que servia el
    // `disabled`: dos `POST` seguidos y el segundo se lleva un 409 que nadie
    // ha pedido.
    await usuario.click(detalle().getByRole('button', { name: 'Aprobar' }));
    expect(llamadas).toHaveLength(4);

    /* ------------------------------------------------------------ *
     * 6. Al resolverse, la fila y el detalle dicen "aprobada", y ya no
     *    hay acciones.
     * ------------------------------------------------------------ */

    // `act` envuelve la resolucion para que React procese el `setState` que
    // dispara y repinte antes de seguir. Sin el, los asserts de abajo mirarian
    // el DOM de antes de la respuesta.
    await act(async () => {
      resolverTransicion(respuestaJson(APROBADA));
    });

    // La fila de la izquierda.
    const filaActualizada = within(fila(0));

    expect(
      filaActualizada.getByText('Aprobada').getAttribute('data-estado'),
    ).toBe('aprobada');
    expect(filaActualizada.queryByText('Enviada')).toBeNull();

    // La ficha de la derecha, que no se toco en ningun momento: se repinta sola
    // porque `App` la deriva de la lista en cada render. Esto es lo que NO
    // pasaria guardando el objeto seleccionado en un segundo `useState`.
    expect(detalle().getByText('Aprobada').getAttribute('data-estado')).toBe(
      'aprobada',
    );
    // Y los otros dos campos que cambio el backend han llegado igual: el
    // operador ya no es `null`, y se ensena su nombre, no su id.
    expect(detalle().getByText('Lucia Ferrer Ortiz')).toBeDefined();
    expect(detalle().queryByText('Sin asignar')).toBeNull();

    // Sin botones: 'aprobada' es un estado final y de el no sale ninguna
    // accion. No hay ninguna comprobacion de "si el estado es aprobada esconde
    // los botones" escrita en ningun sitio; simplemente la tabla de
    // transiciones no tiene salidas, y eso es lo que los hace desaparecer.
    expect(detalle().queryByRole('button')).toBeNull();
    expect(detalle().getByText('Esta solicitud ya esta cerrada.')).toBeDefined();

    // Las otras dos filas siguen como estaban: la transicion sustituye SOLO el
    // elemento cuyo id devolvio el backend.
    expect(within(fila(1)).getByText('Borrador')).toBeDefined();
    expect(within(fila(2)).getByText('Rechazada')).toBeDefined();

    // `ocupado` volvio a `false`, asi que la aplicacion vuelve a responder...
    expect(deshabilitado('Recargar')).toBe(false);
    // ...y no hubo ningun error por el camino.
    expect(screen.queryByRole('alert')).toBeNull();
    // ...ni ninguna peticion de mas: la lista NO se vuelve a pedir despues de
    // transicionar, porque el `POST` ya devolvio la solicitud al dia.
    expect(llamadas).toHaveLength(4);
  });
});
