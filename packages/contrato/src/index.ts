// Punto de entrada unico del paquete de contrato.
//
// `tipos.gen.ts` lo escribe openapi-typescript a partir de openapi.yaml, y su
// forma es la de la especificacion, no la que apetece escribir en el codigo:
// todo cuelga de `components["schemas"][...]`. Este fichero es la capa fina que
// traduce esa estructura a nombres comodos y anade lo unico que un .yaml no
// puede dar por si solo: valores que existen en tiempo de ejecucion.
//
// Regla del paquete: `tipos.gen.ts` no se toca a mano (se regenera con
// `npm run gen`); lo que se escribe a mano vive aqui.

import type { components } from './tipos.gen';

type Esquemas = components['schemas'];

/* ------------------------------------------------------------------ *
 * Tipos: desaparecen al compilar.
 * ------------------------------------------------------------------ */

/** Estado de una solicitud. `aprobada` y `rechazada` son finales. */
export type Estado = Esquemas['Estado'];

/** Accion que provoca una transicion de estado. */
export type Accion = Esquemas['Accion'];

/** Solicitud completa, tal y como la devuelve la API. */
export type Solicitud = Esquemas['Solicitud'];

/** Cuerpo de `POST /solicitudes`: lo que el cliente envia para crear una. */
export type NuevaSolicitud = Esquemas['NuevaSolicitud'];

/** Cuerpo de `POST /solicitudes/{id}/transiciones`. */
export type PeticionTransicion = Esquemas['PeticionTransicion'];

/** Entrada del catalogo externo de tipos de solicitud. */
export type Tipo = Esquemas['Tipo'];

/** Operador de back-office que puede gestionar solicitudes. */
export type Operador = Esquemas['Operador'];

// El esquema se llama `Error` en el contrato, pero `Error` ya existe como
// global de JavaScript: importarlo con ese nombre lo taparia dentro de
// cualquier fichero que lo use, justo donde mas se hacen `throw new Error(...)`.
// Se reexporta como `ErrorApi` para que no compitan.
/** Cuerpo de respuesta de cualquier error de la API. */
export type ErrorApi = Esquemas['Error'];

/* ------------------------------------------------------------------ *
 * Constantes: existen en tiempo de ejecucion.
 * ------------------------------------------------------------------ */

// Un tipo union (`Estado`) no se puede recorrer ni consultar en runtime: al
// compilar se borra. Para validar el `?estado=` de una query o el `accion` de un
// cuerpo hace falta un array de verdad, y eso es lo que sigue.
//
// `listaCompleta` existe para que esos arrays no se queden atras cuando cambie
// el contrato: el compilador exige que esten TODOS los valores de la union.
// Si manana openapi.yaml anade un estado, `npm run gen` lo mete en la union y
// esta llamada deja de compilar hasta que se anada tambien aqui.
// (El error que se ve en ese caso es "no asignable al tipo 'never'".)
const listaCompleta =
  <U extends string>() =>
  <const L extends readonly U[]>(
    valores: L & ([Exclude<U, L[number]>] extends [never] ? unknown : never),
  ): L => valores;

/**
 * Todos los estados posibles, en el orden natural de la maquina de estados.
 * Array real: se puede recorrer, usar con `.includes()` y serializar.
 */
export const ESTADOS = listaCompleta<Estado>()([
  'borrador',
  'enviada',
  'aprobada',
  'rechazada',
]);

/**
 * Todas las acciones de transicion posibles.
 * Array real, mismo uso que {@link ESTADOS}.
 */
export const ACCIONES = listaCompleta<Accion>()([
  'enviar',
  'aprobar',
  'rechazar',
]);

/* ------------------------------------------------------------------ *
 * Guardarrail: la constante y la union generada dicen lo mismo.
 * ------------------------------------------------------------------ */

// `listaCompleta` ya obliga a que los arrays de arriba no se queden cortos ni
// largos, pero lo hace de refilon, en la firma de una funcion, y el error que
// escupe TS ("no asignable al tipo 'never'") no dice QUE valor sobra o falta.
// Lo que sigue repite la comprobacion de forma explicita y en las dos
// direcciones, y sobre todo mete el valor descolgado dentro del mensaje de
// error para que se lea sin tener que deducirlo.
//
// Las dos direcciones que se comprueban, sobre `Estado` (y lo mismo con
// `Accion`):
//
//   union -> constante : todo valor del enum del YAML esta en ESTADOS.
//                        Falla cuando alguien anade un estado al contrato,
//                        regenera los tipos y se olvida de la constante.
//   constante -> union : todo valor de ESTADOS sigue existiendo en el enum.
//                        Falla cuando alguien borra o renombra un estado en el
//                        YAML y la constante se queda con un valor fantasma.
//
// Nada de esto emite codigo: son tipos, desaparecen al compilar. Su unico
// efecto es que `tsc --noEmit` (o sea, el editor y `npm run comprobar`) deja de
// pasar hasta que contrato y constante vuelvan a coincidir.

/** Aparece en el error cuando la constante se ha quedado corta. */
interface FaltanEnLaConstante<_V extends string> {
  readonly _: unique symbol;
}

/** Aparece en el error cuando la constante tiene valores que ya no existen. */
interface SobranEnLaConstante<_V extends string> {
  readonly _: unique symbol;
}

/**
 * `true` si la union `U` y los elementos de la lista `L` son mutuamente
 * asignables; si no, un tipo marcador que nombra los valores descolgados.
 */
type MismosValores<U extends string, L extends readonly string[]> = [
  Exclude<U, L[number]>,
] extends [never]
  ? [Exclude<L[number], U>] extends [never]
    ? true
    : SobranEnLaConstante<Exclude<L[number], U>>
  : FaltanEnLaConstante<Exclude<U, L[number]>>;

/** Rompe la compilacion si `C` no es exactamente `true`. */
type Afirma<C extends true> = C;

// El `export` no es decorativo: sin el, `noUnusedLocals` tumbaria estos alias
// por no usarse en ninguna parte. Exportarlos los hace parte del paquete, pero
// son tipos sin habitantes utiles: nadie los va a escribir en una firma.
export type ESTADOS_CUBRE_ESTADO = Afirma<MismosValores<Estado, typeof ESTADOS>>;
export type ACCIONES_CUBRE_ACCION = Afirma<MismosValores<Accion, typeof ACCIONES>>;
