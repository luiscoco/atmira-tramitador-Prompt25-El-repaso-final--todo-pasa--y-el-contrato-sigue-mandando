// Capa de datos de Tramitador: el único sitio del backend que sabe que las
// solicitudes viven en tres ficheros JSON debajo de `data/`.
//
// Lo que hay aquí no es dominio —no decide ninguna regla— ni es HTTP —no sabe
// qué es un `404`—. Es la pieza intermedia: lee el disco una vez, guarda lo
// leído en memoria y ofrece a las rutas una API pequeña de consultas y una sola
// escritura. Cambiar mañana los tres JSON por una base de datos debería tocar
// este fichero y ninguno más.
//
// Dos decisiones que conviene leer antes que el código:
//
//   1. Se lee una sola vez, al crear el repositorio. No hay relectura por
//      petición, ni caché con invalidación, ni `watch` sobre el fichero. Doce
//      solicitudes caben de sobra en memoria, y releer en cada `GET` haría que
//      la misma petición devolviera cosas distintas según quién hubiera tocado
//      el disco por detrás.
//   2. Las escrituras NO se persisten. Ver `guardarSolicitud`.
//
// Nota sobre los acentos, misma regla que en `dominio/`: los comentarios van
// acentuados; los textos que puedan acabar en un log o en el `detalle` de una
// respuesta, en ASCII.

import { readFileSync } from 'node:fs';

import { ESTADOS, type Estado, type Operador, type Solicitud, type Tipo } from '@tramitador/contrato';

/* ------------------------------------------------------------------ *
 * Dónde está `data/`.
 * ------------------------------------------------------------------ */

// `data/` cuelga de la raíz del monorepo, fuera de `apps/`, porque el contrato
// llama a los tipos "catálogo externo" y los datos no son del backend
// (8. DATOS.md). Desde este fichero son cuatro niveles hacia arriba:
//
//   src/datos/repositorio.ts -> src/ -> backend/ -> apps/ -> raíz
//
// Se resuelve contra `import.meta.url` y no contra `process.cwd()` a propósito:
// el directorio de trabajo depende de desde dónde se lance el proceso, y con
// workspaces eso cambia según se arranque desde la raíz o desde `apps/backend`.
// La ruta relativa al módulo, en cambio, es la misma ejecutando con `tsx` sobre
// `src/` que ejecutando el JS emitido en `dist/`, porque `rootDir: "src"` y
// `outDir: "dist"` conservan la estructura de carpetas y, con ella, la
// profundidad.
const DIRECTORIO_DATOS = new URL('../../../../data/', import.meta.url);

/* ------------------------------------------------------------------ *
 * La API que ve el resto del backend.
 * ------------------------------------------------------------------ */

/**
 * Lo que devuelve {@link crearRepositorio}. Se exporta como tipo para que una
 * ruta pueda declarar que recibe "un repositorio" sin importar la fábrica, y
 * para que un test pueda sustituirlo por un doble con la misma forma.
 */
export interface Repositorio {
  /**
   * Las solicitudes, o solo las que están en `estado` si se indica.
   *
   * Devuelve siempre un array nuevo, nunca el interno (ver la nota larga del
   * final del fichero). Filtrar por un estado sin solicitudes devuelve un array
   * vacío, que es lo que el contrato pide para ese caso: `200` con `[]`, no un
   * `404`.
   *
   * No valida `estado`. Quien recibe el `?estado=` de la query es quien tiene
   * que comprobarlo contra `ESTADOS` y responder `400` si no casa; aquí llega
   * ya tipado.
   */
  listarSolicitudes: (estado?: Estado) => Solicitud[];

  /**
   * La solicitud con ese `id`, o `undefined` si no existe. No lanza: "no está"
   * es una respuesta normal de la capa de datos, y traducirla a `404` es
   * trabajo de la ruta.
   */
  obtenerSolicitud: (id: string) => Solicitud | undefined;

  /** Guarda `actualizada` en memoria. Ver la implementación: no toca el disco. */
  guardarSolicitud: (actualizada: Solicitud) => void;

  /**
   * `true` si `tipo` está en el catálogo. Lo usa `POST /solicitudes` para
   * rechazar con `400` un tipo inexistente antes de crear nada.
   */
  existeTipo: (tipo: string) => boolean;

  /** El catálogo de tipos completo. Array nuevo, igual que el resto. */
  listarTipos: () => Tipo[];

  /** Los operadores de back-office. Array nuevo. */
  listarOperadores: () => Operador[];

  /**
   * Las referencias ya adjudicadas, de todos los años y en el orden en que
   * estén guardadas.
   *
   * Existe para alimentar a `siguienteReferencia` de `dominio/referencia.ts`,
   * que necesita la lista entera para calcular el máximo del año. Es un método
   * aparte, y no un `listarSolicitudes().map(...)` escrito en la ruta, porque
   * esa función pura exige explícitamente TODAS las referencias: si alguien le
   * pasara la lista ya filtrada por estado, generaría una repetida sin
   * enterarse.
   */
  referencias: () => string[];
}

/* ------------------------------------------------------------------ *
 * La fábrica.
 * ------------------------------------------------------------------ */

/**
 * Lee los tres ficheros de `data/` y devuelve un repositorio sobre lo leído.
 *
 * El estado vive en el cierre léxico de esta función, no en variables de
 * módulo: cada llamada produce un repositorio independiente con su propia copia
 * de los datos. Eso es lo que permite que un test escriba en uno sin ensuciar
 * el siguiente, algo imposible si el array colgara del módulo, porque un módulo
 * ES se evalúa una sola vez por proceso y su estado se comparte entre todo lo
 * que lo importe.
 *
 * @param directorio De dónde leer los tres JSON. Por defecto `data/` en la raíz
 *   del monorepo, que es lo que quiere el backend de verdad. El parámetro
 *   existe para que `repositorio.test.ts` pueda apuntar a un directorio con un
 *   fichero roto a propósito y comprobar que la validación de abajo revienta:
 *   sin él, los validadores solo se podrían ejercitar rompiendo `data/`, que es
 *   justo el fichero del que dependen los otros 134 tests.
 *
 * @throws Si algún fichero no existe, no es JSON válido, o su contenido no
 *   tiene la forma que el contrato describe. Es deliberado: sin datos no hay
 *   nada que servir, y un backend que arranca y responde `[]` —o peor, que
 *   sirve una solicitud con un `estado` inventado— es peor que uno que no
 *   arranca.
 */
export function crearRepositorio(directorio: URL = DIRECTORIO_DATOS): Repositorio {
  // Las tres lecturas de disco del backend, todas aquí y todas ahora. A partir
  // de esta línea no se vuelve a tocar el sistema de ficheros.
  //
  // `solicitudes` es `let` porque es lo único que cambia: `guardarSolicitud`
  // sustituye el array entero. `tipos` y `operadores` son `const` porque son
  // catálogos de solo lectura —el contrato no expone ninguna ruta que los
  // modifique— y declararlos así hace que un intento de reasignarlos ni
  // siquiera compile.
  let solicitudes = leerCatalogo(directorio, 'solicitudes', validarSolicitud);
  const tipos = leerCatalogo(directorio, 'tipos', validarTipo);
  const operadores = leerCatalogo(directorio, 'operadores', validarOperador);

  // Las referencias cruzadas, que ninguna fila puede comprobar por su cuenta:
  // hacen falta los tres ficheros leídos. Una solicitud cuyo `tipo` no esté en
  // el catálogo se serviría igual por la API, y el frontend que busque ese id
  // para pintar el nombre del tipo encontraría `undefined` a mitad de un
  // render. Es mejor no arrancar.
  comprobarReferencias(solicitudes, tipos, operadores);

  // Índice de los `id` del catálogo. Se construye una vez y deja `existeTipo`
  // en O(1); con cuatro tipos da igual, pero es la comprobación que corre en
  // cada `POST /solicitudes` y no cuesta nada dejarla bien.
  const idsTipo = new Set(tipos.map((tipo) => tipo.id));

  return {
    listarSolicitudes(estado?: Estado): Solicitud[] {
      // `filter` ya devuelve un array nuevo; el `[...]` cubre el otro camino,
      // el de "sin filtro", que si no devolvería el array interno tal cual.
      return estado === undefined
        ? [...solicitudes]
        : solicitudes.filter((solicitud) => solicitud.estado === estado);
    },

    obtenerSolicitud(id: string): Solicitud | undefined {
      return solicitudes.find((solicitud) => solicitud.id === id);
    },

    // ------------------------------------------------------------------
    // LAS ESCRITURAS NO SE PERSISTEN A DISCO.
    //
    // Esto guarda en el array en memoria y nada más: no hay `writeFileSync`, y
    // `data/solicitudes.json` queda exactamente como estaba. Al reiniciar el
    // proceso se pierde todo lo escrito y vuelven a estar las doce solicitudes
    // originales.
    //
    // Es intencionado, por tres razones:
    //
    //   - `data/` es un juego de datos de ejemplo versionado en el repo, no una
    //     base de datos. Escribirlo haría que ejecutar el backend dejara el
    //     `git status` sucio y que los tests dependieran del orden en que se
    //     ejecutan.
    //   - Reescribir el JSON entero en cada `POST` no es atómico: dos
    //     peticiones a la vez y el fichero queda a medias. Ese problema se
    //     resuelve con una base de datos, no con un `writeFileSync` con más
    //     cuidado.
    //   - El día que haya persistencia de verdad, el cambio ocurre dentro de
    //     este fichero y ninguna ruta se entera.
    //
    // Es un *upsert* a propósito, no solo una actualización: `POST
    // /solicitudes` necesita insertar una solicitud nueva y las transiciones
    // necesitan reemplazar una existente, y las dos cosas son "deja este objeto
    // como el que manda para este `id`".
    //
    // Sustituye el array en vez de mutarlo en el sitio (`solicitudes[i] = ...`)
    // para que las copias ya entregadas a quien estuviera leyendo sigan siendo
    // la foto coherente que eran.
    // ------------------------------------------------------------------
    guardarSolicitud(actualizada: Solicitud): void {
      const indice = solicitudes.findIndex(
        (solicitud) => solicitud.id === actualizada.id,
      );

      solicitudes =
        indice === -1
          ? [...solicitudes, actualizada]
          : solicitudes.map((solicitud, i) => (i === indice ? actualizada : solicitud));
    },

    existeTipo(tipo: string): boolean {
      return idsTipo.has(tipo);
    },

    listarTipos(): Tipo[] {
      return [...tipos];
    },

    listarOperadores(): Operador[] {
      return [...operadores];
    },

    referencias(): string[] {
      return solicitudes.map((solicitud) => solicitud.referencia);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Interno.
 * ------------------------------------------------------------------ */

/**
 * Lee `data/<nombre>.json`, comprueba que es un array y valida cada fila.
 *
 * Aquí estaba el `as T` que `8. DATOS.md` y `12. REPOSITORIO.md` dejaron
 * anotado como la mentira del fichero: `JSON.parse` devuelve `any`, el `as`
 * no comprueba nada, y a partir de ahí el tipo `Solicitud[]` era una promesa
 * que nadie sostenía. Un `estado: "pendiente"` en el JSON llegaba hasta el
 * cliente, y el que reventaba era el frontend, no el servidor.
 *
 * Lo que valida es la forma que el contrato describe, no las invariantes del
 * juego de ejemplo: que haya doce solicitudes o que las referencias vayan
 * seguidas es cosa del fixture, y su sitio es `repositorio.test.ts`.
 *
 * Se lee con `readFileSync` y no con un `import ... with { type: 'json' }`
 * porque un import lo resolvería el empaquetador en tiempo de compilación, y
 * `data/` es un dato de ejecución, no una dependencia del código.
 */
function leerCatalogo<T>(
  directorio: URL,
  nombre: string,
  validar: (fila: unknown, donde: string) => T,
): T[] {
  const ruta = new URL(`${nombre}.json`, directorio);
  const contenido: unknown = JSON.parse(readFileSync(ruta, 'utf8'));

  if (!Array.isArray(contenido)) {
    throw new Error(`data/${nombre}.json: se esperaba un array en la raiz del fichero.`);
  }

  return contenido.map((fila, indice) => validar(fila, `data/${nombre}.json[${indice}]`));
}

/* ------------------------------------------------------------------ *
 * Interno: los validadores.
 * ------------------------------------------------------------------ */

// Escritos a mano y sin dependencia, misma decisión que `esEstado` en
// `rutas/solicitudes.ts`: son tres formas de cuatro a ocho campos, y meter Ajv
// o Zod para esto añadiría un esquema más que mantener al lado del que ya
// manda, que es `openapi.yaml`.
//
// Todos los mensajes llevan el fichero y el índice de la fila. Un
// "expected string, received number" sin sitio obliga a abrir el JSON y contar
// a ojo; aquí el error dice `data/solicitudes.json[7]` y se acabó la búsqueda.
//
// Van en ASCII, como todo lo que puede acabar en una consola.

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** El valor de `campo` si es una cadena; si no, revienta diciendo dónde. */
function cadena(fila: Record<string, unknown>, campo: string, donde: string): string {
  const valor = fila[campo];

  if (typeof valor !== 'string') {
    throw new Error(`${donde}: el campo '${campo}' debe ser una cadena, y es ${describir(valor)}.`);
  }

  return valor;
}

/** Cómo se nombra en un error lo que se ha leído. */
function describir(valor: unknown): string {
  if (valor === undefined) return 'un campo ausente';
  if (valor === null) return 'null';

  return `${typeof valor} (${JSON.stringify(valor)})`;
}

// Los tres validadores construyen un objeto nuevo campo a campo en vez de
// devolver la fila leída. No es ceremonia: sin `schema` en las rutas, Fastify
// serializa lo que se le dé, así que una clave de más en el JSON —un
// `notaInterna`, un `passwordHash`— se publicaría por la API sin que nadie la
// hubiera declarado. Construyendo el objeto, lo que sale es exactamente lo que
// el contrato describe.

function validarSolicitud(fila: unknown, donde: string): Solicitud {
  if (!esObjeto(fila)) {
    throw new Error(`${donde}: se esperaba un objeto, y es ${describir(fila)}.`);
  }

  const estado = fila.estado;

  if (typeof estado !== 'string' || !(ESTADOS as readonly string[]).includes(estado)) {
    throw new Error(
      `${donde}: 'estado' debe ser uno de ${ESTADOS.join(', ')}, y es ${describir(estado)}.`,
    );
  }

  // `operador` es el único campo que el contrato declara anulable: "sin
  // operador asignado" es `null`, no el campo ausente.
  const operador = fila.operador;

  if (operador !== null && typeof operador !== 'string') {
    throw new Error(`${donde}: 'operador' debe ser una cadena o null, y es ${describir(operador)}.`);
  }

  return {
    id: cadena(fila, 'id', donde),
    referencia: cadena(fila, 'referencia', donde),
    tipo: cadena(fila, 'tipo', donde),
    solicitante: cadena(fila, 'solicitante', donde),
    estado: estado as Estado,
    operador,
    creadaEn: cadena(fila, 'creadaEn', donde),
    actualizadaEn: cadena(fila, 'actualizadaEn', donde),
  };
}

function validarTipo(fila: unknown, donde: string): Tipo {
  if (!esObjeto(fila)) {
    throw new Error(`${donde}: se esperaba un objeto, y es ${describir(fila)}.`);
  }

  return {
    id: cadena(fila, 'id', donde),
    nombre: cadena(fila, 'nombre', donde),
    descripcion: cadena(fila, 'descripcion', donde),
  };
}

function validarOperador(fila: unknown, donde: string): Operador {
  if (!esObjeto(fila)) {
    throw new Error(`${donde}: se esperaba un objeto, y es ${describir(fila)}.`);
  }

  return {
    id: cadena(fila, 'id', donde),
    nombre: cadena(fila, 'nombre', donde),
  };
}

/**
 * Las dos referencias cruzadas que el contrato da por buenas y ningún tipo
 * puede imponer: el `tipo` de cada solicitud está en el catálogo, y su
 * `operador` —cuando no es `null`— también.
 *
 * Son dos de las siete afirmaciones del script de invariantes que
 * `8. DATOS.md` escribió para ejecutar a mano. Estas dos viven aquí, y no en un
 * test, porque valen para CUALQUIER `data/`, no solo para el juego de ejemplo:
 * son la diferencia entre no arrancar y servir una solicitud que el frontend no
 * va a saber pintar.
 */
function comprobarReferencias(
  solicitudes: readonly Solicitud[],
  tipos: readonly Tipo[],
  operadores: readonly Operador[],
): void {
  const idsTipo = new Set(tipos.map((tipo) => tipo.id));
  const idsOperador = new Set(operadores.map((operador) => operador.id));

  for (const solicitud of solicitudes) {
    // Se nombra por `referencia` y no por índice: es lo que se ve en la
    // interfaz y en el propio JSON, y quien vaya a arreglarlo la va a buscar.
    if (!idsTipo.has(solicitud.tipo)) {
      throw new Error(
        `data/solicitudes.json: ${solicitud.referencia} tiene el tipo '${solicitud.tipo}', que no esta en data/tipos.json.`,
      );
    }

    if (solicitud.operador !== null && !idsOperador.has(solicitud.operador)) {
      throw new Error(
        `data/solicitudes.json: ${solicitud.referencia} tiene el operador '${solicitud.operador}', que no esta en data/operadores.json.`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Por qué se devuelven copias, y hasta dónde llega la copia.
 * ------------------------------------------------------------------ *
 *
 * `listarSolicitudes` devuelve `[...solicitudes]`, no `solicitudes`. Devolver
 * la referencia interna convertiría a quien llama en copropietario del estado
 * del repositorio: un `.sort()` en una ruta para ordenar por fecha (que ordena
 * en el sitio) o un `.push()` en un test reordenarían o harían crecer el array
 * de dentro, sin pasar por `guardarSolicitud` y sin que nada lo delate. La
 * copia hace que la única puerta de escritura sea la que está documentada como
 * tal.
 *
 * La copia es superficial, y eso hay que decirlo entero: el array es nuevo,
 * pero los objetos `Solicitud` que contiene son los mismos de dentro. Quien
 * haga `lista[0].estado = 'aprobada'` sí muta el estado del repositorio. No se
 * clona en profundidad por dos motivos: cuesta en cada lectura, y el resto del
 * backend trata las solicitudes como inmutables por convención —`transicionar`
 * no muta nada y `guardarSolicitud` recibe un objeto nuevo—. Si algún día esa
 * convención se rompe, el sitio donde ponerle remedio (`structuredClone`, o
 * `Readonly<Solicitud>` en las firmas) es este fichero.
 */
