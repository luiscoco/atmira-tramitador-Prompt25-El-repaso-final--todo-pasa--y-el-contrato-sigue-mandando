// Las cuatro rutas de `/solicitudes`: el sitio donde el backend deja de ser
// fontanería y empieza a aplicar el contrato.
//
// Aquí no se decide ninguna regla de negocio. La máquina de estados vive en
// `dominio/estados.ts`, el formato de las referencias en `dominio/referencia.ts`
// y los datos en `datos/repositorio.ts`. Lo único que hace este fichero es
// **traducir** entre esas tres piezas y HTTP:
//
//   `obtenerSolicitud` devuelve `undefined`   ->  404
//   `transicionar` devuelve `{ ok: false }`   ->  409
//   un `?estado=` que no está en `ESTADOS`    ->  400
//
// Esa es toda la responsabilidad. Si aparece aquí un `if` que decide qué
// transición es legal, está en el fichero equivocado.
//
// La validación de lo que entra se hace **a mano**, contra las constantes que
// exporta `@tramitador/contrato`, y no con los esquemas JSON de Fastify. Es una
// decisión, no una omisión: el guardarrail de `ESTADOS` / `ACCIONES` ya obliga a
// que esas constantes cubran el enum del YAML, así que validar contra ellas es
// validar contra el contrato, y además el error que se devuelve es el que
// openapi.yaml documenta palabra por palabra, no el que genera Ajv.
//
// Nota sobre los acentos, misma regla que en `dominio/`, `datos/` y `app.ts`:
// los comentarios van acentuados; todo lo que pueda acabar en un log o en el
// `mensaje`/`detalle` de una respuesta va en ASCII, porque así lo escribe
// openapi.yaml y lo que viaja por el cable debe ser idéntico a lo que promete la
// especificación.

import { randomUUID } from 'node:crypto';

import {
  ACCIONES,
  ESTADOS,
  type Accion,
  type ErrorApi,
  type Estado,
  type Solicitud,
} from '@tramitador/contrato';
import type { FastifyInstance } from 'fastify';

import type { Repositorio } from '../datos/repositorio';
import { esFinal, transicionar } from '../dominio/estados';
import { siguienteReferencia } from '../dominio/referencia';

/* ------------------------------------------------------------------ *
 * El registrador.
 * ------------------------------------------------------------------ */

/**
 * Registra en `app` las cuatro operaciones de `/solicitudes` del contrato.
 *
 * Es una función y no un plugin de Fastify (`fastify-plugin`, `app.register`) a
 * propósito: un plugin introduce un contexto de encapsulación —hooks propios,
 * decoradores que no se ven desde fuera, prefijos— y aquí no hace falta ninguna
 * de las tres cosas. Lo que hace falta es registrar cuatro rutas sobre la
 * instancia que ya existe, y para eso una llamada síncrona es lo más directo:
 * `app.ts` la invoca, las rutas quedan puestas, y no hay nada asíncrono que
 * esperar ni ningún `await app.ready()` nuevo que recordar.
 *
 * @param app La instancia que construye `crearApp()`. Se muta: al volver de
 *   esta llamada tiene cuatro rutas más.
 * @param repositorio La capa de datos, la misma que usan las demás rutas. Se
 *   pasa por parámetro y no se importa la fábrica aquí por el motivo de siempre:
 *   un test inyecta un doble y fija los datos que quiere probar.
 */
export function registrarRutasDeSolicitudes(
  app: FastifyInstance,
  repositorio: Repositorio,
): void {
  // ------------------------------------------------------------------
  // GET /api/solicitudes
  //
  // Lista todas las solicitudes, o solo las de un estado si viene `?estado=`.
  //
  // La distinción que RUTAS.md marca como la más equivocada al implementar:
  //
  //   ?estado=enviada y hay tres       -> 200 con tres elementos
  //   ?estado=enviada y no hay ninguna -> 200 con []      <- NO es 404
  //   ?estado=pendiente                -> 400
  //   sin ?estado                      -> 200 con todas
  //
  // Las dos de en medio son las que se confunden: un filtro válido sin
  // resultados es un éxito; un filtro inválido es un error del cliente. Que la
  // lista vacía salga `200` se consigue justamente por NO escribir el `if` de
  // más que lo rompería.
  //
  // El genérico declara `estado` como `unknown`, no como `string`. No es
  // pedantería: `?estado=a&estado=b` le llega a Fastify como array, y tipar el
  // campo como `string` sería mentirle al compilador sobre un valor que viene
  // de la red. Dejándolo en `unknown`, el único camino para usarlo es pasar por
  // `esEstado`, que lo rechaza. Eso además cierra los dos huecos que RUTAS.md
  // dejaba anotados —`?estado=` vacío y `?estado` repetido— del mismo lado:
  // `400`, que es lo que el enum implica.
  // ------------------------------------------------------------------
  app.get<{ Querystring: { estado?: unknown } }>(
    '/api/solicitudes',
    (peticion, respuesta) => {
      const { estado } = peticion.query;

      // Sin filtro no hay nada que validar. Se compara con `undefined` y no se
      // escribe `if (!estado)` porque la cadena vacía también es falsy y ahí sí
      // hay algo que validar: `?estado=` es un filtro escrito mal, no un filtro
      // ausente.
      if (estado === undefined) {
        return repositorio.listarSolicitudes();
      }

      if (!esEstado(estado)) {
        return respuesta.code(400).send(
          error(
            'El filtro de estado no es valido.',
            `Valor recibido: ${describir(estado)}. Valores admitidos: ${ESTADOS.join(', ')}.`,
          ),
        );
      }

      // A partir de aquí `estado` es `Estado` para el compilador, gracias al
      // predicado de `esEstado`. El repositorio documenta que NO valida este
      // parámetro y que quien recibe la query es quien debe hacerlo: esta
      // llamada es el otro extremo de ese trato.
      return repositorio.listarSolicitudes(estado);
    },
  );

  // ------------------------------------------------------------------
  // GET /api/solicitudes/:id
  //
  // Dos salidas y nada más: la solicitud, o `404`.
  //
  // El repositorio devuelve `undefined` cuando no hay nadie con ese `id` y lo
  // documenta como "una respuesta normal de la capa de datos". Traducir ese
  // `undefined` a un `404` es exactamente —y únicamente— el trabajo de esta
  // ruta.
  // ------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/solicitudes/:id',
    (peticion, respuesta) => {
      const { id } = peticion.params;

      // El `400` va ANTES de consultar el repositorio, y eso no contradice la
      // regla de "`404` primero" de la ruta de transiciones: aquella protege de
      // confirmar si un id existe, y un id que ni siquiera tiene forma de UUID
      // no puede existir. No se filtra nada respondiendo que está mal escrito.
      if (!esUuid(id)) {
        return respuesta.code(400).send(idMalFormado(id));
      }

      const solicitud = repositorio.obtenerSolicitud(id);

      if (solicitud === undefined) {
        return respuesta.code(404).send(noEncontrada(id));
      }

      return solicitud;
    },
  );

  // ------------------------------------------------------------------
  // POST /api/solicitudes
  //
  // Crea una solicitud a partir de `{ tipo, solicitante }`. Todo lo demás lo
  // adjudica el servidor, que es lo que dice la `description` del contrato: el
  // cliente no elige ni el `id`, ni la `referencia`, ni el estado inicial, ni
  // las fechas. Un cuerpo que traiga esos campos los verá ignorados, no
  // aceptados.
  //
  // La validación es a mano y en cascada, con un orden que no es casual: se
  // comprueba primero que los campos ESTÉN y luego que SIRVAN. Al revés, un
  // cuerpo vacío se respondería con "el tipo no existe en el catalogo", que
  // manda al cliente a mirar el catálogo cuando el problema es suyo.
  //
  // Los tres `400` son los tres `examples` que openapi.yaml nombra
  // (`campoAusente`, `solicitanteNoValido`, `tipoDesconocido`), y solo se
  // distinguen por el texto: `Error` no tiene `codigo`. RUTAS.md ya dejó
  // anotado que eso es un hueco del contrato; aquí se nota en que los tres
  // mensajes hay que escribirlos a mano y con cuidado, porque son lo único que
  // el frontend puede leer para separarlos.
  // ------------------------------------------------------------------
  app.post<{ Body: unknown }>('/api/solicitudes', (peticion, respuesta) => {
    const cuerpo = peticion.body;

    // `typeof null === 'object'` y `typeof [] === 'object'`: las dos
    // comprobaciones extra no sobran. Un `[1,2]` como cuerpo pasaría el
    // `typeof` y luego daría `undefined` en las dos propiedades, respondiendo
    // "falta el campo 'tipo'" sobre algo que ni siquiera es un objeto.
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      return respuesta.code(400).send(
        error(
          'El cuerpo de la peticion no es valido.',
          'Se esperaba un objeto JSON con los campos obligatorios: tipo, solicitante.',
        ),
      );
    }

    // El `as` no inventa nada: solo dice "de este objeto me interesan estas dos
    // claves, y no sé qué hay dentro". Siguen siendo `unknown`, así que el
    // compilador obliga a comprobarlas antes de usarlas.
    const { tipo, solicitante } = cuerpo as { tipo?: unknown; solicitante?: unknown };

    if (typeof tipo !== 'string') {
      return respuesta
        .code(400)
        .send(error('El cuerpo de la peticion no es valido.', faltaONoEsCadena('tipo', tipo)));
    }

    if (typeof solicitante !== 'string') {
      return respuesta
        .code(400)
        .send(
          error('El cuerpo de la peticion no es valido.', faltaONoEsCadena('solicitante', solicitante)),
        );
    }

    // Se recorta antes de comprobar y se guarda lo recortado. Un solicitante
    // que sean tres espacios está vacío a todos los efectos, y guardarlo tal
    // cual dejaría una fila que en la interfaz se ve en blanco sin que nada lo
    // explique.
    const nombreSolicitante = solicitante.trim();

    if (nombreSolicitante === '') {
      return respuesta
        .code(400)
        .send(
          error('El solicitante no es valido.', "El campo 'solicitante' no puede estar vacio."),
        );
    }

    // El catálogo manda. `existeTipo` está en el repositorio precisamente para
    // esto —lo dice su documentación— y se consulta ANTES de crear nada: una
    // solicitud con un tipo que no existe no debe llegar a tener referencia.
    //
    // Un `tipo` de cadena vacía cae también aquí, y no en un "falta el campo":
    // el campo venía, lo que pasa es que no hay ningún tipo con ese id.
    if (!repositorio.existeTipo(tipo)) {
      return respuesta
        .code(400)
        .send(
          error(
            'El tipo de solicitud no es valido.',
            `No existe ningun tipo con id '${tipo}' en el catalogo.`,
          ),
        );
    }

    // Un solo `Date` para las tres cosas que dependen del reloj: el año de la
    // referencia, `creadaEn` y `actualizadaEn`. Con dos llamadas distintas a
    // `new Date()`, una creación a las 23:59:59.999 del 31 de diciembre podría
    // sacar `SOL-2026-0001` con `creadaEn` ya en 2027.
    const ahora = new Date();
    const instante = comoIso(ahora);

    // `referencias()` y no `listarSolicitudes().map(...)`: el repositorio
    // explica por qué existe ese método aparte. `siguienteReferencia` exige la
    // lista COMPLETA —de todos los años y en cualquier orden— y pasarle una
    // filtrada generaría una referencia repetida sin que nada avisara.
    //
    // Lo que esto no resuelve, y conviene tenerlo escrito: dos `POST`
    // simultáneos leen la misma lista y calculan el mismo secuencial. La
    // unicidad real es un problema de la capa que persiste, y `8. DATOS.md` ya
    // lo dejó anotado; no se arregla desde una ruta.
    const solicitud: Solicitud = {
      id: randomUUID(),
      referencia: siguienteReferencia(repositorio.referencias(), ahora.getUTCFullYear()),
      tipo,
      solicitante: nombreSolicitante,
      // Nace en `borrador` y sin operador: lo fija el contrato, no el cliente.
      // `operador` va explícito a `null` y no se omite porque el esquema lo
      // declara obligatorio: "sin operador" es `null`, no "campo ausente".
      estado: 'borrador',
      operador: null,
      creadaEn: instante,
      // "Coincide con `creadaEn` mientras no se haya modificado", dice el
      // contrato. Recién creada, no se ha modificado.
      actualizadaEn: instante,
    };

    repositorio.guardarSolicitud(solicitud);

    // `Location` con la ruta del recurso creado: la convención HTTP para una
    // creación, y una cabecera que el contrato declara en el `201`. Lleva el
    // prefijo `/api` porque es lo que el cliente tiene que pedir, y lo que va
    // en la URL es el `id`, no la `referencia` (RUTAS.md lo decidió al escribir
    // las dos rutas con `{id}`).
    return respuesta
      .code(201)
      .header('Location', `/api/solicitudes/${solicitud.id}`)
      .send(solicitud);
  });

  // ------------------------------------------------------------------
  // POST /api/solicitudes/:id/transiciones
  //
  // La operación con más superficie de error del contrato, y el motivo por el
  // que `dominio/estados.ts` existe separado: aquí no hay ni una regla de la
  // máquina de estados escrita, solo la traducción de su resultado a un código
  // HTTP.
  //
  // El orden de las comprobaciones es el que hay escrito abajo:
  //
  //   1. ¿Existe la solicitud?                    -> 404
  //   2. ¿La accion esta en ACCIONES?             -> 400
  //   3. ¿La transicion es legal desde su estado? -> 409
  //
  // Lo que NO se puede invertir es 1 con 3, y es la advertencia que RUTAS.md
  // razona: contestar `409` sobre una solicitud que no existe le confirma a
  // quien pregunta que ese id es real. El `404` va siempre antes que el `409`.
  // ------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/solicitudes/:id/transiciones',
    (peticion, respuesta) => {
      const { id } = peticion.params;

      // Mismo orden que en la ruta de arriba y por el mismo motivo: un id sin
      // forma de UUID se contesta antes de mirar nada.
      if (!esUuid(id)) {
        return respuesta.code(400).send(idMalFormado(id));
      }

      const solicitud = repositorio.obtenerSolicitud(id);

      if (solicitud === undefined) {
        return respuesta.code(404).send(noEncontrada(id));
      }

      // El cuerpo puede ser cualquier cosa. Se saca `accion` sin suponer que
      // haya un objeto detrás: si no lo hay, `accion` queda `undefined` y cae
      // en el mismo `400` que un verbo inventado, que es justo lo que el
      // contrato describe para esta respuesta ("falta `accion` o su valor no
      // pertenece al enum `Accion`").
      const accion =
        typeof peticion.body === 'object' && peticion.body !== null
          ? (peticion.body as { accion?: unknown }).accion
          : undefined;

      if (!esAccion(accion)) {
        return respuesta.code(400).send(
          error(
            'La accion solicitada no es valida.',
            `Valor recibido: ${describir(accion)}. Valores admitidos: ${ACCIONES.join(', ')}.`,
          ),
        );
      }

      const resultado = transicionar(solicitud.estado, accion);

      if (!resultado.ok) {
        // Los dos `409` del contrato son fallos distintos para el operador que
        // los lee —"ya esta aprobada" y "todavia es borrador"— y por eso
        // openapi.yaml los documenta con dos ejemplos. `esFinal` los separa sin
        // volver a escribir aquí cuáles son los estados finales: esa lista vive
        // en la tabla de `dominio/estados.ts` y en ningún otro sitio.
        //
        // El `detalle` es el `motivo` que devuelve el dominio, tal cual. Ya
        // viene con el estado de partida, la acción pedida y las acciones que
        // sí valdrían desde ahí, y está escrito en ASCII precisamente para
        // poder viajar sin retoques hasta aquí.
        return respuesta
          .code(409)
          .send(
            error(
              esFinal(solicitud.estado)
                ? 'La solicitud ya esta en un estado final.'
                : 'La transicion no esta permitida.',
              resultado.motivo,
            ),
          );
      }

      // Objeto nuevo, no mutación. El repositorio advierte de que las copias
      // que entrega son superficiales —`lista[0].estado = ...` sí tocaría su
      // estado interno— y de que el resto del backend trata las solicitudes
      // como inmutables por convención. Esto es esa convención cumplida:
      // `transicionar` no muta nada, y la escritura pasa por la única puerta
      // que existe para ello.
      const actualizada: Solicitud = {
        ...solicitud,
        estado: resultado.estado,
        actualizadaEn: comoIso(new Date()),
      };

      repositorio.guardarSolicitud(actualizada);

      // `200` con la solicitud ya actualizada, no `204`: el contrato promete
      // devolverla, y le ahorra al cliente un `GET` para ver en qué estado
      // quedó.
      return actualizada;
    },
  );
}

/* ------------------------------------------------------------------ *
 * Interno: validación contra las constantes del contrato.
 * ------------------------------------------------------------------ */

// Estos dos predicados son el motivo por el que `@tramitador/contrato` exporta
// `ESTADOS` y `ACCIONES` como arrays de verdad y no solo como uniones de tipos.
// Una unión se borra al compilar y no se puede consultar en tiempo de
// ejecución; el `?estado=` de una query y el `accion` de un cuerpo llegan como
// `unknown` y hay que comprobarlos contra algo que exista cuando el proceso ya
// está corriendo.
//
// El `is` del retorno es lo que hace que valgan la pena: tras un
// `if (!esEstado(v)) return ...`, el compilador sabe que `v` es `Estado` en el
// resto de la función, sin un solo `as`.
//
// El `as readonly string[]` del cuerpo, en cambio, sí hace falta: `ESTADOS` es
// una tupla de literales, así que su `includes` solo acepta un `Estado`, y
// preguntarle por un `unknown` no compilaría. Ensanchar el tipo del array —no
// el del valor— es lo que permite hacer la pregunta sin mentir sobre la
// respuesta.
//
// Y el beneficio de fondo: el día que openapi.yaml añada un estado, `npm run
// gen` lo mete en la unión, el guardarrail de `@tramitador/contrato` obliga a
// añadirlo a `ESTADOS`, y esta ruta lo acepta sin que nadie la toque. Una lista
// de estados copiada a mano aquí sería el sitio donde ese cambio se quedaría
// olvidado.

function esEstado(valor: unknown): valor is Estado {
  return typeof valor === 'string' && (ESTADOS as readonly string[]).includes(valor);
}

function esAccion(valor: unknown): valor is Accion {
  return typeof valor === 'string' && (ACCIONES as readonly string[]).includes(valor);
}

// El `format: uuid` del parámetro `IdSolicitud` de openapi.yaml, comprobado.
//
// Es una expresión regular escrita aquí y no `crypto.randomUUID`-algo ni una
// dependencia: la forma de un UUID son cinco grupos hexadecimales de longitud
// fija, cabe en una línea y no cambia. Se aceptan mayúsculas (`/i`) porque el
// RFC las permite al leer, aunque los ids que genera esta API vayan siempre en
// minúsculas.
//
// Lo que NO comprueba es la versión ni la variante. `openapi.yaml` pide
// `format: uuid` a secas, y un validador más estricto que el contrato
// rechazaría ids que el contrato admite.
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esUuid(valor: string): boolean {
  return FORMATO_UUID.test(valor);
}

/* ------------------------------------------------------------------ *
 * Interno: construcción de respuestas y formatos.
 * ------------------------------------------------------------------ */

/**
 * Un cuerpo de error del contrato. Existe para que el tipo `ErrorApi` se
 * compruebe en un solo sitio: si mañana el esquema gana el campo `codigo` que
 * RUTAS.md echa de menos, esta función es la que deja de compilar, y no los
 * nueve `send()` repartidos por el fichero.
 *
 * `detalle` es opcional en el esquema, pero todas las llamadas de aquí lo pasan:
 * un error sin detalle obliga al cliente a adivinar qué valor concreto le sobró
 * o le faltó.
 */
function error(mensaje: string, detalle?: string): ErrorApi {
  return detalle === undefined ? { mensaje } : { mensaje, detalle };
}

/** El `404` de las dos rutas con `:id`, escrito una sola vez. */
function noEncontrada(id: string): ErrorApi {
  return error('La solicitud no existe.', `No hay ninguna solicitud con id '${id}'.`);
}

/**
 * El `400` de las dos rutas con `:id` cuando el id no tiene forma de UUID.
 *
 * El texto es el del `example` de `components/responses/IdMalFormado`, palabra
 * por palabra. Esa respuesta llevaba desde el principio en `openapi.yaml` y no
 * la producía ningún camino del código: un `SOL-2026-0007` en la URL se
 * contestaba con el `404` de "no existe", que es cierto pero manda a buscar una
 * solicitud borrada cuando lo que pasa es que se ha puesto la referencia donde
 * va el identificador. Con el frontend delante, esa confusión es exactamente la
 * que va a ocurrir.
 */
function idMalFormado(id: string): ErrorApi {
  return error(
    'El identificador de la solicitud no es valido.',
    `Valor recibido: ${describir(id)}. Se esperaba un UUID.`,
  );
}

/**
 * El `detalle` de un campo obligatorio que no es una cadena, distinguiendo los
 * dos casos que antes se contestaban igual.
 *
 * `{"solicitante": 42}` respondía "Falta el campo obligatorio 'solicitante'",
 * y el campo estaba: lo que fallaba era el tipo. Quien lee eso se va a buscar
 * una clave ausente que está delante de sus ojos.
 */
function faltaONoEsCadena(campo: string, valor: unknown): string {
  return valor === undefined
    ? `Falta el campo obligatorio '${campo}'.`
    : `El campo '${campo}' debe ser una cadena de texto. Valor recibido: ${describir(valor)}.`;
}

/**
 * Un valor recibido en la petición, listo para meter en el `detalle` de un
 * `400`.
 *
 * Las cadenas van entre comillas simples, que es como las escribe openapi.yaml
 * ("Valor recibido: 'pendiente'"). Lo demás pasa por `JSON.stringify` o por
 * `String`, porque a estas rutas no siempre les llega texto: `?estado=a&
 * estado=b` es un array y `{"accion": 7}` es un número, y `String(['a','b'])`
 * daría `a,b`, que no se parece a lo que el cliente envió.
 */
function describir(valor: unknown): string {
  if (valor === undefined) return 'ninguno';
  if (typeof valor === 'string') return `'${valor}'`;

  return typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
}

/**
 * Un instante en la forma en que el contrato lo escribe: UTC, ISO 8601 y **sin
 * milisegundos** (`2026-02-11T09:14:32Z`).
 *
 * `toISOString()` siempre los incluye. El `format: date-time` del contrato los
 * admitiría, pero ni los ejemplos de openapi.yaml ni las doce solicitudes de
 * `data/` los llevan, y una API que devuelve dos formatos distintos según si el
 * registro es nuevo o venía del fichero obliga a cualquier cliente a tratar los
 * dos casos.
 */
function comoIso(instante: Date): string {
  return `${instante.toISOString().slice(0, 19)}Z`;
}
