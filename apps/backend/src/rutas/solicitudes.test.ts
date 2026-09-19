// Tests de las cuatro rutas de `/api/solicitudes`.
//
// Aquí se cobra la deuda que `10. TESTS.md` dejó anotada al final ("nadie prueba
// la traducción a HTTP"). El fichero de la máquina de estados agota los doce
// pares (estado, acción) llamando a `transicionar` a pelo; este no vuelve a
// recorrerlos. Lo único que comprueba es lo que `rutas/solicitudes.ts` dice ser:
// **la traducción** entre el dominio y HTTP.
//
//   `obtenerSolicitud` devuelve `undefined`   ->  404
//   `transicionar` devuelve `{ ok: false }`   ->  409
//   un `?estado=` que no está en `ESTADOS`    ->  400
//
// Dos decisiones estructurales, las dos heredadas de lo que documenta `app.ts`:
//
// 1. **Instancia fresca en cada test.** Cada `it` llama a `crearApp()` y no
//    comparte nada con los demás: `crearRepositorio()` se evalúa en cada
//    llamada y guarda su estado en el cierre léxico, así que dos apps son dos
//    juegos de datos independientes. Eso es lo que permite que los tests que
//    escriben —el `POST` que crea y las transiciones que cambian el estado— no
//    tengan que limpiar detrás de sí ni ejecutarse en un orden concreto. No hay
//    `beforeEach`, no hay `afterEach`, y vitest puede paralelizar el fichero sin
//    que nada se pise.
//
// 2. **`inject()` y no `listen()` + `fetch`.** No se abre ningún puerto. La
//    petición se empuja por el mismo ciclo de vida de Fastify —enrutado, parseo
//    de la query, parseo del cuerpo, serialización— así que lo que se afirma es
//    el `statusCode` y el JSON emitido de verdad, no el valor de retorno de un
//    handler llamado por separado.
//
// Sobre lo que se afirma y lo que no: los `id` NO están escritos a mano en
// ningún expect. Se piden a la propia API (`GET /api/solicitudes?estado=...`) o
// se crean con un `POST`, porque un test anclado a
// `'3f2a9c14-8b7d-4e5a-9f01-6c2d5e8a4b3f'` se rompe el día que alguien edite
// `data/solicitudes.json` sin haber roto nada. Lo que sí va escrito a mano es el
// oráculo: los mensajes de error carácter a carácter y el total de las doce
// solicitudes de ejemplo.
//
// Nota sobre los acentos, misma regla que en el resto del backend: los
// comentarios van acentuados; todo lo que se compara con un `mensaje` o un
// `detalle` va en ASCII, porque así lo escribe openapi.yaml.

import { ESTADOS, type ErrorApi, type Estado, type Solicitud } from '@tramitador/contrato';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';

import { crearApp } from '../app';

/* ------------------------------------------------------------------ *
 * El oráculo escrito a mano.
 * ------------------------------------------------------------------ */

// Las doce solicitudes de `data/solicitudes.json`. La cuenta va escrita aquí, y
// no calculada leyendo el fichero, por el mismo motivo que `estados.test.ts`
// escribe `toHaveLength(9)`: un test que derive el número del mismo sitio que el
// código no comprueba nada. Si alguien añade una solicitud al juego de ejemplo,
// este número es el sitio donde tiene que venir a mirar.
const TOTAL_EN_DATA = 12;

// Un `id` con forma de UUID que no está en `data/`. Con forma de UUID a
// propósito, y ahora por un motivo más fuerte que cuando se escribió: la ruta
// **sí** valida el formato, así que un `'nope'` no probaría el `404` de "no
// existe" sino el `400` de "no es un UUID". Los dos casos son distintos y
// tienen su test cada uno.
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

// Un id que no tiene forma de UUID. Es la referencia de una solicitud, que es
// el error real: quien mira una lista ve `SOL-2026-0007` y lo pega en la URL
// donde va el identificador interno.
const ID_MAL_FORMADO = 'SOL-2026-0007';

// Un tipo que sí está en `data/tipos.json`, para los `POST` que deben salir bien.
const TIPO_VALIDO = 'alta-cuenta';

const SOLICITANTE = 'Ferreteria La Escuadra S.L.';

/* ------------------------------------------------------------------ *
 * Ayudas: todo pasa por la API, nada por el repositorio.
 * ------------------------------------------------------------------ */

// Estas funciones no tocan `crearRepositorio` ni importan `data/`. Preparar el
// escenario con la misma API que se está probando tiene un coste —si `GET`
// estuviera roto, varios tests fallarían a la vez— y una ventaja que pesa más:
// no hay ninguna puerta trasera por la que un test pueda montar un estado que un
// cliente real no podría alcanzar.

/** `GET` sobre `url`, exige `200` y devuelve la lista. */
async function listar(app: FastifyInstance, url = '/api/solicitudes'): Promise<Solicitud[]> {
  const respuesta = await app.inject({ method: 'GET', url });

  expect(respuesta.statusCode).toBe(200);

  return respuesta.json<Solicitud[]>();
}

/**
 * El primer elemento de `lista`, o un fallo con contexto.
 *
 * El `| undefined` de `lista[0]` lo impone `noUncheckedIndexedAccess`, y aquí se
 * aprovecha: si el juego de ejemplo se queda sin solicitudes en algún estado, el
 * test que las necesitaba dice por qué falla en vez de reventar con un "cannot
 * read property 'id' of undefined" veinte líneas más abajo.
 */
function laPrimera(lista: readonly Solicitud[], descripcion: string): Solicitud {
  const candidata = lista[0];

  if (candidata === undefined) {
    throw new Error(`El juego de datos no tiene ninguna solicitud ${descripcion}.`);
  }

  return candidata;
}

/** Una solicitud del juego de ejemplo que esté en `estado`. */
async function unaEn(app: FastifyInstance, estado: Estado): Promise<Solicitud> {
  return laPrimera(await listar(app, `/api/solicitudes?estado=${estado}`), `en estado ${estado}`);
}

/** Crea una solicitud nueva con un `POST` correcto y devuelve la del `201`. */
async function crearBorrador(app: FastifyInstance): Promise<Solicitud> {
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/solicitudes',
    payload: { tipo: TIPO_VALIDO, solicitante: SOLICITANTE },
  });

  expect(respuesta.statusCode).toBe(201);

  return respuesta.json<Solicitud>();
}

/** Pide una transición y devuelve la respuesta cruda, sin exigir ningún código. */
function transicion(app: FastifyInstance, id: string, cuerpo: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/solicitudes/${id}/transiciones`,
    // El parámetro es `unknown` a propósito —media suite manda cuerpos que la
    // ruta debe rechazar—, y `inject` pide un `InjectPayload`. El `as` es el
    // precio de poder escribir `transicion(app, id, { accion: 'archivar' })`
    // sin que el tipo del test se meta en lo que el test quiere probar.
    payload: cuerpo as InjectOptions['payload'],
  });
}

/**
 * El tramo del `detalle` que va **después** de la lista de acciones permitidas.
 *
 * Se trocea por el mismo motivo que en `estados.test.ts`: el mensaje entero
 * siempre contiene la acción rechazada, porque la nombra al principio (`accion
 * solicitada: aprobar`). Buscarla en el mensaje completo daría un test que pasa
 * con un mensaje incoherente.
 */
function accionesQueSiValen(detalle: string, estado: Estado): string {
  return detalle.split(`permitidas desde ${estado}: `)[1] ?? '';
}

/* ------------------------------------------------------------------ *
 * GET /api/solicitudes
 * ------------------------------------------------------------------ */

describe('GET /api/solicitudes', () => {
  it('sin filtro devuelve todas las solicitudes', async () => {
    const app = crearApp();

    const respuesta = await app.inject({ method: 'GET', url: '/api/solicitudes' });

    expect(respuesta.statusCode).toBe(200);

    const lista = respuesta.json<Solicitud[]>();

    // El contrato pide el array desnudo, no `{ datos, total }`. Se afirma que es
    // un array de verdad y no un objeto que lo envuelve.
    expect(Array.isArray(lista)).toBe(true);
    expect(lista).toHaveLength(TOTAL_EN_DATA);
    // "Todas" quiere decir de los cuatro estados, no solo de uno: sin este
    // expect, una ruta que devolviera doce elementos filtrados por error pasaría
    // igual.
    expect([...new Set(lista.map((solicitud) => solicitud.estado))].sort()).toEqual(
      [...ESTADOS].sort(),
    );
  });

  it('devuelve solicitudes con la forma completa del contrato', async () => {
    const app = crearApp();

    const lista = await listar(app);

    // Ocho campos, ni uno menos: `operador` y las dos fechas entran en la
    // cuenta. Un `operador` ausente en vez de `null` rompería aquí, que es justo
    // lo que el esquema —donde el campo es obligatorio— exige.
    for (const solicitud of lista) {
      expect(Object.keys(solicitud).sort()).toEqual([
        'actualizadaEn',
        'creadaEn',
        'estado',
        'id',
        'operador',
        'referencia',
        'solicitante',
        'tipo',
      ]);
    }
  });

  it('con ?estado=enviada devuelve solo las enviadas', async () => {
    const app = crearApp();

    const respuesta = await app.inject({ method: 'GET', url: '/api/solicitudes?estado=enviada' });

    expect(respuesta.statusCode).toBe(200);

    const filtradas = respuesta.json<Solicitud[]>();

    // Dos afirmaciones que se necesitan mutuamente. La primera dice que no sobra
    // nada; la segunda, que no falta nada. Con solo la primera, una ruta que
    // devolviera `[]` siempre pasaría el test.
    expect(filtradas.every((solicitud) => solicitud.estado === 'enviada')).toBe(true);

    // El oráculo del "no falta nada" se saca de la lista sin filtrar, que el
    // test anterior ya fija: las enviadas que hay en el total tienen que ser
    // exactamente las que devuelve el filtro, y en el mismo orden.
    const esperadas = (await listar(app)).filter((solicitud) => solicitud.estado === 'enviada');

    expect(filtradas).toEqual(esperadas);
    // Y que el filtro filtra de verdad, no que da la casualidad de que todas
    // estuvieran enviadas.
    expect(filtradas.length).toBeGreaterThan(0);
    expect(filtradas.length).toBeLessThan(TOTAL_EN_DATA);
  });

  it.each(ESTADOS)('con ?estado=%s devuelve solo ese estado', async (estado) => {
    const app = crearApp();

    const filtradas = await listar(app, `/api/solicitudes?estado=${estado}`);

    expect(filtradas.every((solicitud) => solicitud.estado === estado)).toBe(true);
  });

  it('los cuatro filtros suman el total: ninguna solicitud se pierde ni se cuenta dos veces', async () => {
    const app = crearApp();

    const cuentas = await Promise.all(
      ESTADOS.map(async (estado) => (await listar(app, `/api/solicitudes?estado=${estado}`)).length),
    );

    expect(cuentas.reduce((suma, cuenta) => suma + cuenta, 0)).toBe(TOTAL_EN_DATA);
  });

  it('con ?estado=inventado devuelve 400 y dice que valores admite', async () => {
    const app = crearApp();

    const respuesta = await app.inject({ method: 'GET', url: '/api/solicitudes?estado=inventado' });

    expect(respuesta.statusCode).toBe(400);

    const cuerpo = respuesta.json<ErrorApi>();

    // Igualdad exacta sobre el cuerpo entero: fija el texto que openapi.yaml
    // documenta, y de paso que no aparece ningún campo de más.
    expect(cuerpo).toEqual({
      mensaje: 'El filtro de estado no es valido.',
      detalle:
        "Valor recibido: 'inventado'. Valores admitidos: borrador, enviada, aprobada, rechazada.",
    });
    // La misma afirmación dicha por partes, que es la que documenta la
    // intención: el error devuelve el valor que sobró y la lista de los que
    // valen, no un "bad request" a secas.
    expect(cuerpo.detalle).toContain("'inventado'");
    for (const estado of ESTADOS) {
      expect(cuerpo.detalle).toContain(estado);
    }
  });

  it('un filtro valido sin resultados seria 200 con [], no 404', async () => {
    const app = crearApp();

    // El caso que `RUTAS.md` marca como el más fácil de equivocar. Las doce de
    // ejemplo cubren los cuatro estados, así que no hay ningún estado vacío que
    // pedir; lo que sí se puede afirmar es que el camino del filtro no tiene
    // ningún `404` escondido y que devuelve un array, que es el único sitio
    // donde ese error podría vivir.
    const respuesta = await app.inject({ method: 'GET', url: '/api/solicitudes?estado=rechazada' });

    expect(respuesta.statusCode).toBe(200);
    expect(Array.isArray(respuesta.json<Solicitud[]>())).toBe(true);
  });

  it('con ?estado= vacio devuelve 400: es un filtro escrito mal, no un filtro ausente', async () => {
    const app = crearApp();

    const respuesta = await app.inject({ method: 'GET', url: '/api/solicitudes?estado=' });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<ErrorApi>().detalle).toContain("Valor recibido: ''");
  });

  it('con ?estado repetido devuelve 400 y describe el array recibido', async () => {
    const app = crearApp();

    // Fastify entrega `?estado=a&estado=b` como array. La ruta tipa el campo
    // como `unknown` justo para que este caso no pueda colarse como si fuera una
    // cadena.
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/solicitudes?estado=enviada&estado=borrador',
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<ErrorApi>().detalle).toContain('["enviada","borrador"]');
  });
});

/* ------------------------------------------------------------------ *
 * GET /api/solicitudes/:id
 * ------------------------------------------------------------------ */

describe('GET /api/solicitudes/:id', () => {
  it('con un id que no es un UUID devuelve 400, no 404', async () => {
    // El caso que `openapi.yaml` describía en `IdMalFormado` y que ningún
    // camino del código producía: hasta que se añadió `esUuid`, esto devolvía
    // el `404` de "la solicitud no existe", que es cierto y no ayuda.
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/solicitudes/${ID_MAL_FORMADO}`,
    });

    expect(respuesta.statusCode).toBe(400);

    // El texto es el `example` del contrato, palabra por palabra. Se compara
    // entero y no con un `toContain`: es lo único que un cliente puede leer
    // para distinguir este `400` de los otros, porque `Error` no tiene `codigo`.
    expect(respuesta.json<ErrorApi>()).toEqual({
      mensaje: 'El identificador de la solicitud no es valido.',
      detalle: `Valor recibido: '${ID_MAL_FORMADO}'. Se esperaba un UUID.`,
    });
  });

  it('acepta un UUID en mayusculas', async () => {
    // El RFC las permite y `format: uuid` no dice lo contrario, así que
    // rechazarlas sería ser más estricto que el contrato. Devuelve `404`
    // —ese id no está en `data/`— y no `400`, que es lo que se comprueba.
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/solicitudes/${ID_INEXISTENTE.toUpperCase()}`,
    });

    expect(respuesta.statusCode).toBe(404);
  });

  it('con un id inexistente devuelve 404', async () => {
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/solicitudes/${ID_INEXISTENTE}`,
    });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json<ErrorApi>()).toEqual({
      mensaje: 'La solicitud no existe.',
      detalle: `No hay ninguna solicitud con id '${ID_INEXISTENTE}'.`,
    });
  });

  it('con un id existente devuelve 200 y la misma solicitud que la lista', async () => {
    const app = crearApp();

    // El control del test anterior: sin esto, una ruta que devolviera `404` para
    // todo pasaría el caso del id inexistente con nota.
    const esperada = laPrimera(await listar(app), 'en el juego de datos');

    const respuesta = await app.inject({ method: 'GET', url: `/api/solicitudes/${esperada.id}` });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json<Solicitud>()).toEqual(esperada);
  });
});

/* ------------------------------------------------------------------ *
 * POST /api/solicitudes
 * ------------------------------------------------------------------ */

describe('POST /api/solicitudes', () => {
  it('distingue un campo ausente de un campo con el tipo equivocado', async () => {
    // Los dos cuerpos daban el mismo `detalle` —"Falta el campo obligatorio
    // 'solicitante'"— y solo uno de los dos es cierto. Con el frontend
    // delante, ese texto manda a buscar una clave que está en el objeto.
    const app = crearApp();

    const ausente = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      payload: { tipo: TIPO_VALIDO },
    });

    const tipoEquivocado = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      payload: { tipo: TIPO_VALIDO, solicitante: 42 },
    });

    expect(ausente.statusCode).toBe(400);
    expect(ausente.json<ErrorApi>().detalle).toBe("Falta el campo obligatorio 'solicitante'.");

    expect(tipoEquivocado.statusCode).toBe(400);
    expect(tipoEquivocado.json<ErrorApi>().detalle).toBe(
      "El campo 'solicitante' debe ser una cadena de texto. Valor recibido: 42.",
    );

    // La afirmación que sostiene al test: los dos textos son distintos. Sin
    // esto, dos mensajes iguales pasarían los dos `toBe` de arriba el día que
    // alguien unifique las ramas "para simplificar".
    expect(ausente.json<ErrorApi>().detalle).not.toBe(tipoEquivocado.json<ErrorApi>().detalle);
  });

  it('con un tipo inexistente devuelve 400 y nombra el tipo', async () => {
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      payload: { tipo: 'tipo-que-no-existe', solicitante: 'Aserradero Los Chopos S.L.' },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<ErrorApi>()).toEqual({
      mensaje: 'El tipo de solicitud no es valido.',
      detalle: "No existe ningun tipo con id 'tipo-que-no-existe' en el catalogo.",
    });
  });

  it('con un tipo inexistente no crea nada ni consume una referencia', async () => {
    const app = crearApp();

    await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      payload: { tipo: 'tipo-que-no-existe', solicitante: 'Aserradero Los Chopos S.L.' },
    });

    // El `400` podría devolverse *después* de haber guardado. Este expect es el
    // que afirma que el catálogo se consulta antes de crear nada, que es el
    // orden que el fichero de rutas documenta.
    expect(await listar(app)).toHaveLength(TOTAL_EN_DATA);

    // Y que tampoco se ha quemado el siguiente secuencial: la primera creación
    // válida después de un rechazo se lleva la 0013, no la 0014.
    const creada = await crearBorrador(app);

    expect(creada.referencia).toBe('SOL-2026-0013');
  });

  it('con un cuerpo valido devuelve 201, Location y una solicitud en borrador', async () => {
    const app = crearApp();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/solicitudes',
      payload: { tipo: TIPO_VALIDO, solicitante: SOLICITANTE },
    });

    expect(respuesta.statusCode).toBe(201);

    const creada = respuesta.json<Solicitud>();

    // Lo que adjudica el servidor, no el cliente.
    expect(creada.estado).toBe('borrador');
    expect(creada.operador).toBeNull();
    expect(creada.actualizadaEn).toBe(creada.creadaEn);
    expect(creada.tipo).toBe(TIPO_VALIDO);
    expect(creada.solicitante).toBe(SOLICITANTE);
    expect(respuesta.headers.location).toBe(`/api/solicitudes/${creada.id}`);

    // Y que es recuperable por la URL que acaba de anunciar.
    const recuperada = await app.inject({ method: 'GET', url: `/api/solicitudes/${creada.id}` });

    expect(recuperada.statusCode).toBe(200);
    expect(recuperada.json<Solicitud>()).toEqual(creada);
  });
});

/* ------------------------------------------------------------------ *
 * POST /api/solicitudes/:id/transiciones
 * ------------------------------------------------------------------ */

describe('POST /api/solicitudes/:id/transiciones', () => {
  it('con un id que no es un UUID devuelve 400 antes de mirar la accion', async () => {
    // El orden importa y por eso la acción que se manda también es inválida:
    // si la ruta mirase primero el cuerpo, esto daría el `400` de la acción y
    // el test pasaría por el motivo equivocado. El `detalle` es lo que separa
    // un caso del otro.
    const app = crearApp();

    const respuesta = await transicion(app, ID_MAL_FORMADO, { accion: 'teletransportar' });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<ErrorApi>()).toEqual({
      mensaje: 'El identificador de la solicitud no es valido.',
      detalle: `Valor recibido: '${ID_MAL_FORMADO}'. Se esperaba un UUID.`,
    });
  });

  it('con una accion no permitida devuelve 409 y menciona las acciones si permitidas', async () => {
    const app = crearApp();

    // Una recién creada: está en `borrador`, y desde ahí lo único legal es
    // `enviar`. Se pide `aprobar`, que es la acción equivocada en el momento
    // equivocado —no una acción inventada, que sería un `400`—.
    const borrador = await crearBorrador(app);

    const respuesta = await transicion(app, borrador.id, { accion: 'aprobar' });

    expect(respuesta.statusCode).toBe(409);

    const cuerpo = respuesta.json<ErrorApi>();

    expect(cuerpo.mensaje).toBe('La transicion no esta permitida.');
    // El `detalle` es el `motivo` del dominio tal cual, y `estados.test.ts` ya lo
    // compara carácter a carácter. Aquí lo que importa es que llega entero, sin
    // retoques ni recortes al pasar por la capa HTTP.
    expect(cuerpo.detalle).toBe(
      'Estado actual: borrador; accion solicitada: aprobar. Acciones permitidas desde borrador: enviar.',
    );

    // Lo que el enunciado pide dicho aparte: el error no solo dice que no, dice
    // qué sí. Y la acción que se acaba de rechazar no puede aparecer entre las
    // permitidas: un mensaje que dijera "acciones permitidas: aprobar" pasaría el
    // `toBe` de arriba solo si además se cambiara el texto esperado, pero
    // fallaría aquí de cualquier forma.
    const permitidas = accionesQueSiValen(cuerpo.detalle ?? '', 'borrador');

    expect(permitidas).toContain('enviar');
    expect(permitidas).not.toContain('aprobar');
  });

  it('el 409 no cambia el estado de la solicitud', async () => {
    const app = crearApp();

    const borrador = await crearBorrador(app);

    await transicion(app, borrador.id, { accion: 'rechazar' });

    const despues = await app.inject({ method: 'GET', url: `/api/solicitudes/${borrador.id}` });

    // Ni el estado ni la marca de tiempo: una transición rechazada no es una
    // modificación.
    expect(despues.json<Solicitud>()).toEqual(borrador);
  });

  it('sobre un estado final devuelve 409 con el mensaje de estado final', async () => {
    const app = crearApp();

    // Los dos `409` del contrato son fallos distintos para quien los lee, y la
    // ruta los separa con `esFinal`. Este es el otro.
    const aprobada = await unaEn(app, 'aprobada');

    const respuesta = await transicion(app, aprobada.id, { accion: 'aprobar' });

    expect(respuesta.statusCode).toBe(409);

    const cuerpo = respuesta.json<ErrorApi>();

    expect(cuerpo.mensaje).toBe('La solicitud ya esta en un estado final.');
    expect(cuerpo.detalle).toContain('ninguna (estado final)');
    // Y no miente llamando "desconocido" a un estado que sí existe.
    expect(cuerpo.detalle).not.toContain('estado desconocido');
  });

  it('con una accion valida devuelve 200 y el nuevo estado', async () => {
    const app = crearApp();

    const borrador = await crearBorrador(app);

    const respuesta = await transicion(app, borrador.id, { accion: 'enviar' });

    expect(respuesta.statusCode).toBe(200);

    const actualizada = respuesta.json<Solicitud>();

    // El nuevo estado, que es lo que el contrato promete devolver para que el
    // cliente no tenga que hacer un `GET` detrás.
    expect(actualizada.estado).toBe('enviada');
    // Y lo que no cambia: la identidad de la solicitud.
    expect(actualizada.id).toBe(borrador.id);
    expect(actualizada.referencia).toBe(borrador.referencia);
    expect(actualizada.tipo).toBe(borrador.tipo);
    expect(actualizada.solicitante).toBe(borrador.solicitante);
    expect(actualizada.creadaEn).toBe(borrador.creadaEn);
    // La marca de modificación sí se toca. Se compara con `>=` y no con `>`
    // porque el formato del contrato no lleva milisegundos: crear y transicionar
    // dentro del mismo segundo da la misma cadena, y eso no es un fallo.
    expect(actualizada.actualizadaEn >= borrador.creadaEn).toBe(true);
    expect(actualizada.actualizadaEn).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('la accion valida persiste: el GET posterior ve el nuevo estado', async () => {
    const app = crearApp();

    const borrador = await crearBorrador(app);

    const actualizada = (await transicion(app, borrador.id, { accion: 'enviar' })).json<Solicitud>();

    const recuperada = await app.inject({ method: 'GET', url: `/api/solicitudes/${borrador.id}` });

    expect(recuperada.json<Solicitud>()).toEqual(actualizada);

    // Y el filtro la ve en su nuevo estado, no en el viejo.
    const enviadas = await listar(app, '/api/solicitudes?estado=enviada');
    const borradores = await listar(app, '/api/solicitudes?estado=borrador');

    expect(enviadas.map((solicitud) => solicitud.id)).toContain(borrador.id);
    expect(borradores.map((solicitud) => solicitud.id)).not.toContain(borrador.id);
  });

  it('recorre el camino completo borrador -> enviada -> aprobada', async () => {
    const app = crearApp();

    const borrador = await crearBorrador(app);

    const enviada = (await transicion(app, borrador.id, { accion: 'enviar' })).json<Solicitud>();
    const aprobada = (await transicion(app, borrador.id, { accion: 'aprobar' })).json<Solicitud>();

    expect(enviada.estado).toBe('enviada');
    expect(aprobada.estado).toBe('aprobada');

    // Y una vez arriba, ya no se puede volver a mover.
    expect((await transicion(app, borrador.id, { accion: 'rechazar' })).statusCode).toBe(409);
  });

  it('con una accion inventada devuelve 400, no 409', async () => {
    const app = crearApp();

    const borrador = await crearBorrador(app);

    const respuesta = await transicion(app, borrador.id, { accion: 'archivar' });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<ErrorApi>()).toEqual({
      mensaje: 'La accion solicitada no es valida.',
      detalle: "Valor recibido: 'archivar'. Valores admitidos: enviar, aprobar, rechazar.",
    });
  });

  it('sin el campo accion devuelve 400 y lo dice', async () => {
    const app = crearApp();

    const borrador = await crearBorrador(app);

    const respuesta = await transicion(app, borrador.id, {});

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<ErrorApi>().detalle).toContain('Valor recibido: ninguno');
  });

  it('con un id inexistente devuelve 404 aunque la accion tampoco valga', async () => {
    const app = crearApp();

    // El orden que `RUTAS.md` razona y que no se puede invertir: contestar `400`
    // o `409` sobre una solicitud que no existe le confirmaría a quien pregunta
    // que ese id es real. El `404` va primero.
    const respuesta = await transicion(app, ID_INEXISTENTE, { accion: 'archivar' });

    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json<ErrorApi>().mensaje).toBe('La solicitud no existe.');
  });
});

/* ------------------------------------------------------------------ *
 * El aislamiento entre instancias.
 * ------------------------------------------------------------------ */

// El test que justifica que todos los de arriba puedan escribir sin limpiar. Si
// `crearRepositorio()` se hubiera evaluado una sola vez al cargar el módulo —el
// error clásico de un valor por defecto compartido—, este fichero sería una
// sucesión de fallos intermitentes según el orden de ejecución, y este es el
// único test que lo diría en voz alta.
describe('crearApp: cada instancia tiene sus propios datos', () => {
  it('lo que se crea en una app no se ve en otra', async () => {
    const primeraApp = crearApp();
    const segundaApp = crearApp();

    const creada = await crearBorrador(primeraApp);

    expect(await listar(primeraApp)).toHaveLength(TOTAL_EN_DATA + 1);
    expect(await listar(segundaApp)).toHaveLength(TOTAL_EN_DATA);

    const enLaSegunda = await segundaApp.inject({
      method: 'GET',
      url: `/api/solicitudes/${creada.id}`,
    });

    expect(enLaSegunda.statusCode).toBe(404);
  });

  it('una transicion en una app no mueve la solicitud de otra', async () => {
    const primeraApp = crearApp();
    const segundaApp = crearApp();

    // El mismo `id` del juego de datos existe en las dos, y aquí está el riesgo
    // real: las dos apps leen el mismo JSON de disco. Que la escritura no se
    // filtre de una a otra es lo que hace que el fichero se pueda paralelizar.
    const enviada = await unaEn(primeraApp, 'enviada');

    expect((await transicion(primeraApp, enviada.id, { accion: 'aprobar' })).statusCode).toBe(200);

    const enLaPrimera = await primeraApp.inject({
      method: 'GET',
      url: `/api/solicitudes/${enviada.id}`,
    });
    const enLaSegunda = await segundaApp.inject({
      method: 'GET',
      url: `/api/solicitudes/${enviada.id}`,
    });

    expect(enLaPrimera.json<Solicitud>().estado).toBe('aprobada');
    expect(enLaSegunda.json<Solicitud>().estado).toBe('enviada');
  });
});
