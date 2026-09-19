// Máquina de estados de Tramitador: la única pieza que decide si una acción
// puede aplicarse sobre una solicitud, y en qué estado la deja.
//
// Es dominio puro. No importa Fastify, ni nada de HTTP, ni la capa de datos:
// no sabe que existe un `409`, ni un fichero JSON, ni una petición. Solo conoce
// `Estado` y `Accion`, que vienen del contrato. Esa restricción es el motivo de
// que el fichero viva aquí y no dentro de la ruta: así la regla se ejercita
// entera con llamadas a función, sin levantar un servidor ni tocar disco.
//
// Nota sobre los acentos: los comentarios van acentuados, pero los textos que
// se devuelven en `motivo` no. Esos textos acaban en el `detalle` de un `Error`
// del contrato, y openapi.yaml los documenta en ASCII ("Estado actual:
// borrador; accion solicitada: aprobar."). Se mantiene esa forma para que lo
// que viaja por el cable sea idéntico a lo que promete la especificación.

import { ACCIONES, ESTADOS, type Accion, type Estado } from '@tramitador/contrato';

/* ------------------------------------------------------------------ *
 * La tabla: única fuente de verdad de la máquina.
 * ------------------------------------------------------------------ */

/** Acciones que salen de un estado, y adónde llevan. Parcial: casi ninguna
 *  acción aplica a todos los estados, y los finales no tienen ninguna. */
type Salidas = Readonly<Partial<Record<Accion, Estado>>>;

// El tipo `Record<Estado, Salidas>` no es decorativo: obliga a que la tabla
// tenga TODOS los estados del contrato. Si mañana openapi.yaml añade un estado
// y `npm run gen` lo mete en la unión, este objeto deja de compilar hasta que
// alguien decida qué acciones salen de él. Lo mismo, por el lado de `Salidas`,
// con una acción nueva escrita con un typo: no pertenece a `Accion` y falla.
//
// Lo que hay aquí es exactamente lo que dice el contrato:
//   borrador --enviar--> enviada --aprobar--> aprobada (final)
//                                \--rechazar-> rechazada (final)
const TRANSICIONES: Readonly<Record<Estado, Salidas>> = {
  borrador: { enviar: 'enviada' },
  enviada: { aprobar: 'aprobada', rechazar: 'rechazada' },
  aprobada: {},
  rechazada: {},
};

/* ------------------------------------------------------------------ *
 * El resultado: unión discriminada, nunca una excepción.
 * ------------------------------------------------------------------ */

/**
 * Lo que devuelve {@link transicionar}. `ok` es el discriminante: dentro de un
 * `if (resultado.ok)` el compilador sabe que existe `estado`, y en el `else`
 * que existe `motivo`. Leer el campo equivocado no compila, así que quien llama
 * no puede olvidarse del caso de fallo.
 */
export type ResultadoTransicion =
  | { readonly ok: true; readonly estado: Estado }
  | { readonly ok: false; readonly motivo: string };

/* ------------------------------------------------------------------ *
 * API del módulo.
 * ------------------------------------------------------------------ */

/**
 * Acciones legales desde `estado`, en el orden canónico del contrato.
 *
 * Devuelve un array vacío para los estados finales (`aprobada`, `rechazada`):
 * "sin salidas" es precisamente lo que los hace finales, no un caso especial
 * escrito aparte.
 *
 * Se recorre `ACCIONES` en vez de `Object.keys(salidas)` por dos razones: el
 * orden es estable y el del contrato (no el de inserción del objeto), y no hace
 * falta ningún cast para que el array salga tipado como `Accion[]`.
 */
export function accionesPermitidas(estado: Estado): Accion[] {
  const salidas = salidasDe(estado);
  return ACCIONES.filter((accion) => salidas[accion] !== undefined);
}

/**
 * `true` si desde `estado` no sale ninguna acción, es decir, si la solicitud ya
 * terminó su recorrido. El contrato distingue este caso del de una acción que
 * simplemente no toca ahora (sus dos ejemplos de `409` son `estadoFinal` y
 * `transicionNoPermitida`), y esta función es la que permite separarlos sin
 * volver a escribir la lista de estados finales en la capa HTTP.
 */
export function esFinal(estado: Estado): boolean {
  return accionesPermitidas(estado).length === 0;
}

/**
 * Aplica `accion` sobre `estado`.
 *
 * Nunca lanza: una transición ilegal es un resultado previsto del dominio, no
 * un fallo del programa, y sale por `{ ok: false, motivo }`. El `motivo` incluye
 * el estado de partida, la acción pedida y la lista de acciones que sí valdrían
 * desde ahí, para que el mensaje sirva tal cual como `detalle` de la respuesta
 * de error y le diga al cliente qué puede hacer en su lugar.
 *
 * No muta nada ni mira el reloj: dado un par (estado, acción) devuelve siempre
 * lo mismo. Persistir el nuevo estado y actualizar `actualizadaEn` es trabajo de
 * quien llama.
 */
export function transicionar(estado: Estado, accion: Accion): ResultadoTransicion {
  const destino = salidasDe(estado)[accion];

  if (destino === undefined) {
    return { ok: false, motivo: motivoDe(estado, accion) };
  }

  return { ok: true, estado: destino };
}

/* ------------------------------------------------------------------ *
 * Interno.
 * ------------------------------------------------------------------ */

// Los tipos dicen que `TRANSICIONES[estado]` siempre existe, pero eso solo es
// cierto si `estado` llegó validado. Aquí entran valores que vienen de un JSON
// en disco o de una query, donde `Estado` es una promesa, no una garantía: si
// el valor no está en la tabla se trata como un estado sin salidas, y la
// llamada acaba en `{ ok: false }` en vez de en un TypeError.
function salidasDe(estado: Estado): Salidas {
  return TRANSICIONES[estado] ?? {};
}

function motivoDe(estado: Estado, accion: Accion): string {
  const permitidas = accionesPermitidas(estado);

  // Sin salidas hay dos razones posibles, y conviene no confundirlas en el
  // mensaje: o el estado es final de verdad, o es un valor que no pertenece al
  // contrato y que nunca deberia haber llegado hasta aqui.
  const lista =
    permitidas.length > 0
      ? permitidas.join(', ')
      : ESTADOS.includes(estado)
        ? 'ninguna (estado final)'
        : 'ninguna (estado desconocido)';

  return `Estado actual: ${estado}; accion solicitada: ${accion}. Acciones permitidas desde ${estado}: ${lista}.`;
}
