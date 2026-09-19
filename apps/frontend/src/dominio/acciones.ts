// Las acciones legales desde cada estado, decididas en el navegador.
//
// ============================================================================
// AVISO: ESTA TABLA ESTA DUPLICADA A PROPOSITO
// ============================================================================
//
// `TRANSICIONES` es una COPIA literal de la tabla que vive en
// `apps/backend/src/dominio/estados.ts`. No es un descuido ni un resto de un
// refactor a medias: es una decision, y conviene entender las dos mitades —por
// que se copia, y que se rompe cuando la copia se queda atras—.
//
// ---------------------------------------------------------------------------
// Por que hay una copia y no una sola tabla
// ---------------------------------------------------------------------------
//
// Las tres alternativas, y por que ninguna se eligio:
//
//   1. **Preguntar a la API.** Seria lo ideal, y es lo que haria falta si la
//      maquina de estados fuese a crecer. Pero `openapi.yaml` no publica las
//      acciones permitidas en ningun sitio: `Solicitud` trae `estado`, y nada
//      mas. No hay un `GET /solicitudes/{id}/acciones` ni un campo
//      `accionesPermitidas` que consultar, asi que hoy no se puede preguntar.
//      Anadirlo es un cambio de contrato, no de frontend.
//
//   2. **Importar el modulo del backend.** `accionesPermitidas` ya existe y
//      hace exactamente esto. Importarla obligaria al frontend a depender del
//      workspace `@tramitador/backend`, es decir, a meter en el bundle del
//      navegador un paquete cuyo arbol de imports lleva a Fastify y al sistema
//      de ficheros. Un modulo de dominio puro no justifica arrastrar un
//      servidor entero al cliente.
//
//   3. **Subir la tabla a `@tramitador/contrato`.** Es la cura de verdad, y es
//      donde esto deberia acabar. Lo que lo frena es que el paquete tiene hoy
//      una regla clara —lo generado (`tipos.gen.ts`) y lo minimo escrito a
//      mano para que la especificacion exista en runtime (`ESTADOS`,
//      `ACCIONES`)— y la maquina de estados NO esta en el .yaml: solo aparece
//      como prosa en la descripcion de `Accion`. Meterla ahi es decidir que el
//      contrato incluye el grafo de transiciones, y esa decision no es de este
//      fichero.
//
// Hasta entonces: dos tablas, y este aviso.
//
// ---------------------------------------------------------------------------
// Que pasa si alguien toca solo uno de los dos ficheros
// ---------------------------------------------------------------------------
//
// El backend es el que manda. Esta copia solo decide QUE BOTONES SE PINTAN;
// quien acepta o rechaza la transicion es `POST /solicitudes/{id}/transiciones`,
// que llama a su propia tabla y no sabe que esta existe. Cuando las dos dejan
// de coincidir, el desajuste se ve de una de estas dos formas:
//
//   - **Aqui sobra una salida que el backend ya no tiene.** La interfaz pinta
//     el boton, el usuario lo pulsa, y la API contesta **409**. El boton
//     promete algo que el servidor rechaza: lo peor de los dos mundos, porque
//     el fallo aparece despues del clic y con cara de error del sistema, no de
//     "eso no se puede hacer ahora".
//
//   - **Al backend le sobra una salida que aqui falta.** No hay boton. La
//     transicion es perfectamente legal y el usuario no tiene forma de
//     provocarla: una funcionalidad que existe en el servidor y es invisible.
//     No hay ningun error en ninguna consola, que es lo que la hace dificil de
//     encontrar.
//
// El compilador cubre un solo caso de los tres posibles, y conviene saber cual:
//
//   - Un ESTADO nuevo en el contrato: cubierto. `Record<Estado, Salidas>`
//     obliga a que esten los cuatro (o los cinco), asi que en cuanto
//     `npm run gen` meta el estado nuevo en la union, este fichero deja de
//     compilar hasta que alguien decida que acciones salen de el.
//   - Una ACCION escrita con un typo: cubierta. No pertenece a `Accion`.
//   - Un cambio en las salidas de un estado que YA EXISTE: **no cubierto**.
//     `borrador: { enviar: 'aprobada' }` compila igual de bien que el valor
//     correcto. Y es justo el caso mas frecuente, porque anadir un estado en
//     medio del recorrido reescribe las salidas de los que ya estaban.
//
// Si cambias `apps/backend/src/dominio/estados.ts`, cambia tambien este fichero.
// ============================================================================
//
// Acentos: comentarios acentuados, y aqui no sale nada por pantalla —los textos
// de los botones estan en `componentes/Detalle.tsx`—, asi que la otra mitad de
// la regla no aplica.

import { ACCIONES, type Accion, type Estado } from '@tramitador/contrato';

/** Acciones que salen de un estado, y adonde llevan. Parcial, porque casi
 *  ninguna accion aplica a todos los estados y los finales no tienen ninguna. */
type Salidas = Readonly<Partial<Record<Accion, Estado>>>;

// La copia. Mismo contenido, mismo orden y mismos tipos que la del backend, a
// proposito: cuanto mas identicas sean las dos, mas facil es compararlas de un
// vistazo el dia que una de las dos cambie.
//
//   borrador --enviar--> enviada --aprobar--> aprobada (final)
//                                \--rechazar-> rechazada (final)
const TRANSICIONES: Readonly<Record<Estado, Salidas>> = {
  borrador: { enviar: 'enviada' },
  enviada: { aprobar: 'aprobada', rechazar: 'rechazada' },
  aprobada: {},
  rechazada: {},
};

/**
 * Acciones legales desde `estado`, en el orden canonico del contrato, SIN
 * llamar a la API.
 *
 * Que no haya red es el motivo de que exista: los botones del detalle se
 * pintan en el mismo render en que llega la solicitud, sin un estado de carga
 * intermedio ni una peticion por cada fila que se selecciona.
 *
 * Devuelve un array vacio para los estados finales (`aprobada`, `rechazada`).
 * "Sin salidas" es precisamente lo que los hace finales, no un caso especial
 * escrito aparte, y quien llama puede tratar ambas cosas con un `length === 0`.
 *
 * Se recorre `ACCIONES` en vez de las claves del objeto por lo mismo que en el
 * backend: el orden es el del contrato y no el de insercion, y el array sale
 * tipado como `Accion[]` sin ningun cast.
 */
export function accionesDeEstado(estado: Estado): Accion[] {
  // Los tipos dicen que `TRANSICIONES[estado]` siempre existe, pero eso solo es
  // cierto si `estado` llego validado. Aqui llega de un `json()` con un `as`
  // encima (ver `api/cliente.ts`: no hay validacion en runtime), asi que un
  // estado que no este en la tabla se trata como un estado sin salidas. Sin
  // este `?? {}`, la pantalla entera se cae con un TypeError.
  const salidas = TRANSICIONES[estado] ?? {};

  return ACCIONES.filter((accion) => salidas[accion] !== undefined);
}
