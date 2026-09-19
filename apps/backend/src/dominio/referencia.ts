// Generador de referencias de Tramitador: dado lo que ya existe, decide cuál es
// el siguiente código `SOL-AAAA-NNNN`.
//
// Es dominio puro, igual que `estados.ts`. No lee `data/solicitudes.json`, no
// sabe qué es una solicitud ni un `201`, y no mira el reloj: el año entra por
// parámetro y las referencias ya existentes también. Esa restricción es lo que
// hace que el caso difícil —el secuencial más alto DEL AÑO PEDIDO, con la lista
// desordenada y con referencias de otros años por medio— se pueda ejercitar
// entero con llamadas a función.
//
// Quien llama es responsable de darle el conjunto correcto: si le pasa media
// lista, generará una referencia repetida. La unicidad real (dos peticiones a la
// vez creando `SOL-2026-0013`) es un problema de concurrencia de la capa que
// persiste, y `8. DATOS.md` ya lo dejó anotado; aquí no se resuelve.
//
// Nota sobre los acentos, misma regla que en `estados.ts`: los comentarios van
// acentuados; los textos de los errores van en ASCII, porque pueden acabar en un
// log o en el `detalle` de una respuesta, donde el resto del proyecto ya es
// ASCII.

/* ------------------------------------------------------------------ *
 * El formato, que no lo decide este fichero.
 * ------------------------------------------------------------------ */

/**
 * El formato de una referencia, copiado del `pattern` de `Solicitud.referencia`
 * en openapi.yaml: `SOL-`, cuatro dígitos de año, `-`, cuatro dígitos de
 * secuencial.
 *
 * Se exporta porque es lo único de este módulo que le sirve a otra capa (validar
 * una referencia que entra) y porque tenerlo en un solo sitio evita que la
 * expresión se copie a mano en la ruta y las dos se separen.
 */
export const PATRON_REFERENCIA = /^SOL-\d{4}-\d{4}$/;

/** Dígitos del secuencial. Cuatro, porque cuatro dice el contrato. */
const DIGITOS = 4;

/** El secuencial más alto que cabe en `DIGITOS` dígitos: `SOL-AAAA-9999`. */
const SECUENCIAL_MAXIMO = 10 ** DIGITOS - 1;

/* ------------------------------------------------------------------ *
 * API del módulo.
 * ------------------------------------------------------------------ */

/**
 * La siguiente referencia libre de `anio`.
 *
 * Busca el secuencial más alto **entre las referencias de ese mismo año** y le
 * suma uno. Las tres consecuencias que importan:
 *
 * - Si no hay ninguna referencia del año pedido, el máximo es 0 y la primera
 *   referencia del año es `SOL-AAAA-0001`. El año empieza a contar de nuevo:
 *   `SOL-2026-0012` no hace que 2027 arranque en 13.
 * - Las referencias de otros años no cuentan para nada, ni siquiera para el
 *   máximo.
 * - El orden de `referenciasExistentes` da igual: se recorre entera buscando el
 *   máximo, no se mira la última ni se ordena.
 *
 * Lo que no case con {@link PATRON_REFERENCIA} se ignora en silencio en vez de
 * romper la generación: la lista viene de un JSON en disco, donde el formato es
 * una promesa y no un hecho. Ignorar es la opción segura porque solo puede
 * hacer que el secuencial salga más bajo, y eso lo detecta la unicidad de quien
 * persiste; abortar, en cambio, dejaría el alta de solicitudes inservible por un
 * registro viejo mal escrito.
 *
 * No muta el array que recibe, no mira el reloj y no hace E/S: para los mismos
 * argumentos devuelve siempre lo mismo.
 *
 * @param referenciasExistentes Todas las referencias ya adjudicadas, de
 *   cualquier año y en cualquier orden. Puede estar vacío.
 * @param anio Año de la nueva referencia, de cuatro dígitos (p. ej. `2026`).
 * @throws {RangeError} Si `anio` no cabe en cuatro dígitos, o si el año pedido
 *   ya agotó sus 9999 secuenciales. Las dos son situaciones en las que no existe
 *   ninguna referencia válida que devolver: cualquier cadena inventada
 *   incumpliría el `pattern` del contrato, y es mejor que falle aquí, ruidoso,
 *   que dos capas más abajo con un dato corrupto ya escrito en disco.
 */
export function siguienteReferencia(
  referenciasExistentes: readonly string[],
  anio: number,
): string {
  const prefijo = prefijoDe(anio);

  // Un solo recorrido, sin ordenar ni copiar: el máximo no necesita más. Se
  // arranca en 0 a propósito, que es el valor que hace que un año sin
  // referencias empiece en 0001 sin tratarlo como un caso aparte.
  let maximo = 0;
  for (const referencia of referenciasExistentes) {
    const secuencial = secuencialDe(referencia, prefijo);
    if (secuencial > maximo) {
      maximo = secuencial;
    }
  }

  const siguiente = maximo + 1;

  if (siguiente > SECUENCIAL_MAXIMO) {
    throw new RangeError(
      `Secuenciales agotados para el anio ${prefijo.slice(4, 8)}: ` +
        `el ultimo posible es ${prefijo}${String(SECUENCIAL_MAXIMO)}.`,
    );
  }

  return `${prefijo}${String(siguiente).padStart(DIGITOS, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Interno.
 * ------------------------------------------------------------------ */

/**
 * `SOL-AAAA-` para `anio`. Es la parte que comparten todas las referencias del
 * año, y compararla es exactamente lo que significa "del mismo año".
 */
function prefijoDe(anio: number): string {
  // `anio` llega tipado como `number`, que admite 2026.5, -3, NaN e Infinity. Se
  // comprueba aquí y no más arriba porque es el único sitio donde el año se
  // convierte en texto: si pasara, saldría una referencia que no casa con el
  // contrato ("SOL-2026.5-0001") y el fallo aparecería muy lejos de su causa.
  if (!Number.isInteger(anio) || anio < 1000 || anio > 9999) {
    throw new RangeError(`Anio fuera de rango: ${String(anio)}. Se espera un entero de 1000 a 9999.`);
  }

  return `SOL-${String(anio)}-`;
}

/**
 * El secuencial de `referencia` si pertenece a `prefijo`, y `0` en cualquier
 * otro caso: otro año, formato que no casa, o un valor que ni siquiera es una
 * cadena (el array puede venir de un `JSON.parse`).
 *
 * Devolver `0` en vez de `undefined` no pierde información útil: el secuencial
 * `0000` no es válido como referencia adjudicada, así que "no cuenta" y "cuenta
 * cero" son lo mismo para el máximo.
 */
function secuencialDe(referencia: string, prefijo: string): number {
  if (typeof referencia !== 'string' || !referencia.startsWith(prefijo)) {
    return 0;
  }

  const secuencial = referencia.slice(prefijo.length);

  // `startsWith` ya fijó la parte del año; falta comprobar que lo que queda son
  // los cuatro dígitos exactos y nada más. Sin esto, `SOL-2026-12` colaría como
  // 12 y `SOL-2026-0007-bis` como 7.
  if (!/^\d{4}$/.test(secuencial)) {
    return 0;
  }

  // Base 10 explícita y sin `parseInt`: `Number` no se come la cola de una
  // cadena que no sea un número entero, aunque aquí la comprobación de arriba ya
  // lo garantice.
  return Number(secuencial);
}
