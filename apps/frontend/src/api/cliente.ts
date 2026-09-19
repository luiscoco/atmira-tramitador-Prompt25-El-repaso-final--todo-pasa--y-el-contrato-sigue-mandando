// El unico sitio del frontend donde se llama a `fetch`.
//
// Todo lo que la aplicacion sabe hacer contra la API pasa por aqui, y por un
// motivo concreto: el `fetch` suelto de un componente siempre acaba repitiendo
// las mismas cuatro lineas —montar la URL, mirar `respuesta.ok`, hacer
// `json()`, poner un `as` encima— y cada repeticion es una oportunidad de
// olvidarse de una. `pedir<T>()` las escribe una sola vez; el resto del fichero
// son seis funciones de una linea que se limitan a decir qué ruta y qué tipo.
//
// Tres decisiones que conviene leer antes de usarlo:
//
//   - **Rutas relativas.** Las funciones reciben la ruta SIN `/api`; el prefijo
//     lo pone `pedir`. Nunca aparece un host ni un puerto: el navegador resuelve
//     `/api/...` contra la pagina actual, el proxy de `vite.config.ts` lo
//     reenvia al 3001 en desarrollo, y en produccion lo atiende el servidor que
//     sirva `dist/`. Por eso no hay ninguna `VITE_API_URL` que configurar.
//
//   - **Un error es un `throw`.** `fetch` solo rechaza cuando la peticion no
//     llega a completarse: un 404 o un 409 son respuestas validas que hay que
//     mirar a mano. `pedir` las convierte en `ErrorDeApi`, asi que quien llame
//     solo tiene dos caminos: el valor que pidio, o un `catch`.
//
//   - **Sin validacion en runtime.** El `as T` de `json()` es un acto de fe en
//     el contrato: si el backend cumple `openapi.yaml`, la forma es la que dice
//     el tipo. Es la costura donde los tipos dejan de comprobarse solos, y esta
//     concentrada en una unica linea a proposito —el dia que haga falta validar
//     de verdad, se cambia ahi y en ningun otro sitio—.
//
// Nota sobre los acentos, misma regla que en el backend y en `vite.config.ts`:
// los comentarios van acentuados; lo que pueda acabar en un `mensaje` que lea
// una persona o en la consola del navegador va en ASCII.

import type {
  Accion,
  ErrorApi,
  Estado,
  NuevaSolicitud,
  Operador,
  Solicitud,
  Tipo,
} from '@tramitador/contrato';

/* ------------------------------------------------------------------ *
 * El error.
 * ------------------------------------------------------------------ */

/**
 * Una respuesta de la API que no ha salido bien.
 *
 * Es una clase y no una interfaz suelta por dos motivos que se notan justo en
 * el sitio donde se usa —un `catch`, donde lo que llega es `unknown`—:
 *
 *   - `instanceof ErrorDeApi` estrecha el tipo. Con un objeto plano habria que
 *     escribir un predicado a mano en cada `catch`.
 *   - Al heredar de `Error` trae `message` y `stack`, asi que cae de pie en
 *     cualquier sitio que ya trate errores (`fallo instanceof Error`, el
 *     `console.error` del navegador, un error boundary de React).
 *
 * `message` es el `mensaje` que manda el backend y `detalle` es su `detalle`
 * opcional: el mismo cuerpo `Error` del contrato. El nombre en ingles no es un
 * despiste, lo impone `Error`.
 */
export class ErrorDeApi extends Error {
  /** El codigo HTTP de la respuesta: 400, 404, 409, 500... */
  readonly status: number;

  /** Informacion adicional, cuando el backend la incluye. */
  readonly detalle?: string;

  constructor(status: number, message: string, detalle?: string) {
    super(message);

    // `name` se pone a mano: sin esto, un `ErrorDeApi` se imprime como "Error"
    // en la consola y en cualquier log, porque el `name` se hereda del padre.
    this.name = 'ErrorDeApi';

    this.status = status;

    // La asignacion va dentro de un `if` en vez de hacerse siempre: escribir
    // `this.detalle = undefined` crea la propiedad igualmente, y entonces un
    // `'detalle' in fallo` contesta `true` sobre un error que no tiene detalle.
    if (detalle !== undefined) {
      this.detalle = detalle;
    }
  }
}

/* ------------------------------------------------------------------ *
 * La unica llamada a `fetch` de la aplicacion.
 * ------------------------------------------------------------------ */

/** Prefijo de todas las rutas. Es el que declara `servers` en `openapi.yaml`. */
const BASE = '/api';

/**
 * Pide `ruta` a la API y devuelve el cuerpo ya interpretado como `T`.
 *
 * @param ruta     Ruta SIN el prefijo `/api`, empezando por `/`
 *                 (`/solicitudes`, `/solicitudes/<id>/transiciones`...).
 * @param opciones Las de `fetch`, tal cual. `signal` es la que mas se usa, para
 *                 cancelar la peticion cuando el componente se desmonta.
 *
 * @throws {ErrorDeApi} Si la respuesta no es `2xx`.
 *
 * El `T` no se comprueba en ningun momento: es lo que el contrato promete para
 * esa ruta, y quien llama es responsable de escribirlo bien. De ahi que la
 * aplicacion no deba usar `pedir` directamente, sino las envolturas de abajo:
 * son ellas las que fijan la pareja ruta/tipo en un unico sitio.
 */
export async function pedir<T>(
  ruta: string,
  opciones?: RequestInit,
): Promise<T> {
  const respuesta = await fetch(BASE + ruta, {
    ...opciones,

    // Las cabeceras se reconstruyen aparte porque el spread de arriba las
    // reemplazaria enteras: `Accept` se pone primero y lo que traiga `opciones`
    // va despues, de modo que quien llama puede anadir las suyas sin perder
    // esta y puede sobrescribirla si de verdad lo necesita.
    headers: {
      Accept: 'application/json',
      ...opciones?.headers,
    },
  });

  if (!respuesta.ok) {
    throw await comoError(respuesta);
  }

  // Ninguna de las siete operaciones del contrato contesta `204`, asi que
  // siempre hay cuerpo que leer. Si algun dia aparece una que no lo tenga,
  // este es el punto que habria que partir.
  return (await respuesta.json()) as T;
}

/**
 * Convierte una respuesta fallida en el `ErrorDeApi` que se va a lanzar.
 *
 * El contrato dice que todo error trae un cuerpo `{ mensaje, detalle? }`, pero
 * esa promesa solo cubre al backend: un `502` del proxy, la pagina de error de
 * un balanceador o una respuesta cortada a la mitad llegan igual por aqui y no
 * son JSON. De ahi el `try`: si el cuerpo no se puede leer, el error se
 * construye con el `status`, que es lo unico que se sabe con certeza.
 */
async function comoError(respuesta: Response): Promise<ErrorDeApi> {
  const porDefecto = `La API ha respondido ${respuesta.status}.`;

  try {
    const cuerpo = (await respuesta.json()) as Partial<ErrorApi>;

    // `typeof` y no `??` ni `||`: el cuerpo viene de la red y puede ser
    // cualquier cosa —un numero, `null`, un array—. Lo que no sea una cadena
    // no se puede ensenar como mensaje.
    const mensaje =
      typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje : porDefecto;
    const detalle =
      typeof cuerpo.detalle === 'string' ? cuerpo.detalle : undefined;

    return new ErrorDeApi(respuesta.status, mensaje, detalle);
  } catch {
    // El cuerpo no era JSON, o no habia cuerpo. No es motivo para tapar lo que
    // si se sabe: el `status` sigue siendo informacion util.
    return new ErrorDeApi(respuesta.status, porDefecto);
  }
}

/* ------------------------------------------------------------------ *
 * Las operaciones del contrato, una funcion cada una.
 * ------------------------------------------------------------------ *
 *
 * Todas devuelven exactamente el tipo que `openapi.yaml` documenta para su
 * respuesta correcta, y todas propagan `ErrorDeApi` por las demas. Las listas
 * salen como `readonly` porque nadie tiene por que modificar la respuesta de la
 * API en el sitio donde la recibe.
 *
 * El `opciones` que arrastran todas existe sobre todo para el `signal` del
 * `AbortController`: cancelar la peticion cuando el componente se desmonta es
 * lo normal en un `useEffect`, y sin este parametro habria que saltarse el
 * cliente para poder hacerlo.
 * ------------------------------------------------------------------ */

/**
 * `GET /api/solicitudes`, con el filtro opcional por estado.
 *
 * La query se monta con `URLSearchParams` y no concatenando: es quien se ocupa
 * de escapar lo que haga falta. Hoy los estados son cuatro palabras sin
 * sorpresas, pero la URL se construye igual el dia que dejen de serlo.
 */
export function listarSolicitudes(
  estado?: Estado,
  opciones?: RequestInit,
): Promise<readonly Solicitud[]> {
  // Sin filtro se pide la ruta limpia. Enviar `?estado=` vacio NO es lo mismo:
  // el backend lo trata como un filtro escrito mal y contesta `400`.
  const consulta =
    estado === undefined ? '' : `?${new URLSearchParams({ estado }).toString()}`;

  return pedir<Solicitud[]>(`/solicitudes${consulta}`, opciones);
}

/**
 * `GET /api/solicitudes/{id}`.
 *
 * @throws {ErrorDeApi} `404` si no existe; `400` si el `id` no tiene forma de
 *         UUID —el backend lo comprueba antes de mirar los datos—.
 */
export function obtenerSolicitud(
  id: string,
  opciones?: RequestInit,
): Promise<Solicitud> {
  return pedir<Solicitud>(`/solicitudes/${encodeURIComponent(id)}`, opciones);
}

/** `GET /api/tipos`: el catalogo externo de tipos de solicitud. */
export function listarTipos(opciones?: RequestInit): Promise<readonly Tipo[]> {
  return pedir<Tipo[]>('/tipos', opciones);
}

/** `GET /api/operadores`: los operadores de back-office. */
export function listarOperadores(
  opciones?: RequestInit,
): Promise<readonly Operador[]> {
  return pedir<Operador[]>('/operadores', opciones);
}

/**
 * `POST /api/solicitudes`: crea una solicitud y devuelve la creada (`201`).
 *
 * Lo que vuelve NO es lo que se envia: el backend anade `id`, `referencia`,
 * `estado` (siempre `borrador`), `operador` y las dos fechas. De ahi que el
 * tipo de entrada sea `NuevaSolicitud` y el de vuelta `Solicitud`.
 *
 * @throws {ErrorDeApi} `400` si falta `tipo` o `solicitante`, o si no son
 *         cadenas con contenido.
 */
export function crearSolicitud(
  nueva: NuevaSolicitud,
  opciones?: RequestInit,
): Promise<Solicitud> {
  return pedir<Solicitud>('/solicitudes', {
    ...opciones,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...opciones?.headers,
    },
    body: JSON.stringify(nueva),
  });
}

/**
 * `POST /api/solicitudes/{id}/transiciones`: aplica `accion` y devuelve la
 * solicitud ya actualizada.
 *
 * La firma recibe la `Accion` suelta y monta el `PeticionTransicion` aqui
 * dentro. Es el envoltorio de un unico campo: obligar a quien llama a escribir
 * `{ accion }` no le da ninguna garantia que no tenga ya el tipo `Accion`.
 *
 * @throws {ErrorDeApi} `404` si la solicitud no existe; `400` si la accion no
 *         esta en el enum; `409` si la transicion no es legal desde el estado
 *         actual —`detalle` dice cual era ese estado—.
 */
export function transicionarSolicitud(
  id: string,
  accion: Accion,
  opciones?: RequestInit,
): Promise<Solicitud> {
  return pedir<Solicitud>(
    `/solicitudes/${encodeURIComponent(id)}/transiciones`,
    {
      ...opciones,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...opciones?.headers,
      },
      body: JSON.stringify({ accion }),
    },
  );
}
