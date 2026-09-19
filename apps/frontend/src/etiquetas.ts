// Traducciones de identificador a texto para la interfaz.
//
// La API devuelve identificadores (`Solicitud.tipo` es un `Tipo.id`,
// `Solicitud.operador` es un `Operador.id`) y los catalogos vienen aparte. El
// cruce entre unos y otros no pertenece a ningun componente en concreto —la
// bandeja lo necesita para la columna de tipo, el detalle lo necesitara para el
// operador—, asi que vive aqui: funciones puras, sin React dentro, que se
// prueban llamandolas.
//
// Acentos: misma regla que en el resto del proyecto. Los comentarios van
// acentuados; lo que acaba en pantalla, no.

import type { Operador, Tipo } from '@tramitador/contrato';

/**
 * Devuelve el nombre para mostrar del tipo cuyo `id` se pasa.
 *
 * El caso interesante es el otro: que el catalogo NO tenga ese id. Puede pasar
 * de verdad —`tipos` y `solicitudes` son dos peticiones distintas, y el
 * catalogo es externo—, asi que hay que decidir que se pinta entonces. Las tres
 * opciones eran lanzar, devolver algo generico ("Desconocido") o devolver el id
 * crudo. Se elige el id:
 *
 *   - Lanzar convertiria un desajuste de datos en una pantalla en blanco. Una
 *     fila con el tipo feo sigue siendo una fila util: la referencia, el
 *     solicitante y el estado se leen igual.
 *   - "Desconocido" borra la unica pista que habia para investigarlo. Con el id
 *     a la vista, quien lo vea sabe exactamente que buscar en el catalogo.
 *
 * Que el id crudo se vea raro es justamente la senal de que algo no cuadra, y
 * por eso no se disfraza.
 */
export function nombreDeTipo(tipos: readonly Tipo[], id: string): string {
  return tipos.find((tipo) => tipo.id === id)?.nombre ?? id;
}

/**
 * Devuelve el nombre para mostrar del operador cuyo `id` se pasa, o
 * `"Sin asignar"` cuando no hay ninguno.
 *
 * Es la gemela de {@link nombreDeTipo} que `20. BANDEJA.md` dejo anunciada, con
 * una diferencia que justifica que sea otra funcion y no la misma con un
 * parametro mas: aqui hay DOS ausencias distintas y no significan lo mismo.
 *
 *   - `id === null` es el caso normal. El contrato dice que
 *     `Solicitud.operador` es `null` mientras no haya nadie asignado, y eso no
 *     es un fallo de datos: es el estado inicial de toda solicitud recien
 *     creada. Se traduce a un texto de interfaz, "Sin asignar".
 *   - Un `id` que no esta en el catalogo SI es un desajuste, y se trata igual
 *     que en `nombreDeTipo`: se devuelve el id crudo, porque es la unica pista
 *     que le queda a quien tenga que investigarlo.
 *
 * Devolver "Sin asignar" tambien para el segundo caso seria el error facil:
 * taparia un operador borrado del catalogo haciendolo pasar por una solicitud
 * sin asignar, que es un estado legitimo y que nadie iria a mirar.
 */
export function nombreDeOperador(
  operadores: readonly Operador[],
  id: string | null,
): string {
  if (id === null) {
    return 'Sin asignar';
  }

  return operadores.find((operador) => operador.id === id)?.nombre ?? id;
}
