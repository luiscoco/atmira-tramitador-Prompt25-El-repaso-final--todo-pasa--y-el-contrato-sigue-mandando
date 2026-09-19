// El detalle: la ficha de la solicitud seleccionada, y el sitio donde por fin
// se pulsan las transiciones.
//
// Cinco props y ningun `useState`, igual que `<Bandeja>`. Todo lo que pinta
// sale de `solicitud`, que `App` deriva en cada render a partir de la lista
// (`solicitudes.find(...) ?? null`). Esa es la razon de que no haya que
// sincronizar nada despues de una transicion: `onAccion` refresca la lista y
// esta ficha se repinta sola con la version nueva.
//
// Tres cosas que se deciden aqui y conviene leer antes:
//
//   - **Los botones salen de `accionesDeEstado()`, no de una lista fija.** Y no
//     de la API: el modulo `dominio/acciones.ts` responde en el mismo render,
//     sin peticion. Lo que ese fichero explica en su cabecera —que la tabla
//     esta duplicada a proposito y que el backend es quien manda— vale entero
//     para este componente, porque es su unico consumidor.
//
//   - **"Ya esta cerrada" es el array vacio.** No hay ninguna comprobacion de
//     `estado === 'aprobada' || estado === 'rechazada'` escrita a mano: los
//     estados finales son exactamente los que no tienen salidas, y preguntarlo
//     por su nombre seria una tercera copia de la maquina de estados.
//
//   - **`ocupado` deshabilita, no esconde.** Un boton que desaparece mientras
//     dura la peticion mueve los de al lado bajo el cursor, y el siguiente clic
//     cae en el equivocado. Deshabilitado se queda donde estaba.
//
// Acentos: comentarios acentuados, texto en pantalla en ASCII. Misma regla que
// el backend, `api/cliente.ts` y `<Bandeja>`.

import type { Accion, Operador, Solicitud, Tipo } from '@tramitador/contrato';

import { accionesDeEstado } from '../dominio/acciones';
import { nombreDeOperador, nombreDeTipo } from '../etiquetas';
import { EstadoChip } from './EstadoChip';

interface PropsDetalle {
  /**
   * La solicitud que se esta mirando, o `null` si no hay ninguna.
   *
   * Una sola ausencia y no dos: `App` ya convierte el `undefined` que devuelve
   * `find` en `null` con un `?? null`, justamente para que aqui solo haya que
   * comprobar un caso.
   */
  readonly solicitud: Solicitud | null;

  /** El catalogo de tipos, entero. Mismo criterio que en `<Bandeja>`: el cruce
   *  id -> nombre se hace donde se necesita, no en `App`. */
  readonly tipos: readonly Tipo[];

  /** El catalogo de operadores, entero. Igual que `tipos`. */
  readonly operadores: readonly Operador[];

  /**
   * `true` mientras hay una peticion que modifica algo en vuelo.
   *
   * Es el `ocupado` de `App`, no un `cargando`: la ficha se sigue viendo
   * entera, solo que sin poder pulsar. Lo que evita es el doble clic —dos
   * `POST /transiciones` seguidos, donde el segundo llega cuando el estado ya
   * ha cambiado y se lleva un 409 que nadie ha pedido—.
   */
  readonly ocupado: boolean;

  /**
   * Aviso hacia arriba con la accion pulsada.
   *
   * Manda la `Accion` sola y no `(id, accion)` por lo mismo que `<Bandeja>`
   * manda solo el id: quien lo recibe ya sabe cual esta seleccionada, porque es
   * el mismo componente que decidio pasarla por `solicitud`. Dos fuentes para
   * el mismo dato es una de mas.
   *
   * Devuelve `void` y no una promesa: este componente no espera a nada ni
   * atrapa errores. De la peticion, del `ocupado` y del mensaje de error se
   * ocupa `App`, que es donde vive el estado.
   */
  readonly onAccion: (accion: Accion) => void;
}

/**
 * Texto del boton de cada accion.
 *
 * `Record<Accion, string>` por el mismo motivo que el `ETIQUETAS` de
 * `<EstadoChip>`: si `openapi.yaml` anade una cuarta accion y `npm run gen` la
 * mete en la union, este objeto deja de compilar hasta que alguien le ponga
 * texto. Un `Partial` o un `?? accion` de respaldo se tragarian el aviso y
 * pintarian un boton que pone "devolver", en minuscula y sin traducir.
 *
 * El texto NO se deriva de la accion poniendo en mayuscula su primera letra.
 * Funcionaria para las tres de hoy y dejaria de funcionar con la primera que no
 * sea una sola palabra; y el identificador del contrato y lo que lee una
 * persona son dos cosas distintas, que aqui se mantienen separadas a proposito
 * igual que en el chip.
 */
const TEXTO_ACCION: Record<Accion, string> = {
  enviar: 'Enviar',
  aprobar: 'Aprobar',
  rechazar: 'Rechazar',
};

/**
 * La clase de cada boton.
 *
 * `Record<Accion, string>` por el mismo motivo que {@link TEXTO_ACCION}: si
 * `openapi.yaml` anade una cuarta accion y `npm run gen` la trae, esto deja de
 * compilar y hay que decidir como se ve, en vez de que salga sin estilo.
 *
 * Las dos que avanzan el expediente —`enviar` y `aprobar`— van en azul solido,
 * y `rechazar` queda en rojo perfilado. No es simetrico a proposito: en una
 * ficha con dos botones, que los dos pesen lo mismo obliga a leerlos siempre;
 * el destructivo se reconoce por el color y se pulsa por decision, no por
 * inercia.
 */
const CLASE_ACCION: Record<Accion, string> = {
  enviar: 'boton boton--principal',
  aprobar: 'boton boton--principal',
  rechazar: 'boton boton--peligro',
};

/**
 * Formateador de las dos fechas.
 *
 * Se construye UNA vez, a nivel de modulo, y no dentro del componente:
 * `Intl.DateTimeFormat` es caro de crear y esto se repintaria en cada render.
 *
 * Las fechas llegan en ISO 8601 UTC (`2026-02-11T09:14:32Z`) y se ensenan en la
 * zona horaria del navegador, que es lo que espera quien las lee. El idioma va
 * fijo a `es-ES` y no a `undefined` (el del sistema) a proposito: con el del
 * sistema, la misma pantalla se ve distinta en dos maquinas y un test pasa o
 * falla segun la configuracion regional de quien lo ejecute.
 */
const FECHA = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * Convierte una fecha ISO del contrato en texto legible.
 *
 * La comprobacion no es paranoia gratuita: el valor viene de un `json()` con un
 * `as` encima (ver `api/cliente.ts`), asi que "es una fecha ISO" es una promesa
 * del contrato, no una garantia del tipo. `Intl` sobre una fecha invalida
 * escribe "Invalid Date" en medio de la ficha; devolver la cadena cruda al
 * menos ensena lo que de verdad mando el servidor.
 */
function comoFecha(iso: string): string {
  const fecha = new Date(iso);

  return Number.isNaN(fecha.getTime()) ? iso : FECHA.format(fecha);
}

export function Detalle({
  solicitud,
  tipos,
  operadores,
  ocupado,
  onAccion,
}: PropsDetalle) {
  // Salida temprana sin seleccion. La alternativa —no pintar nada— dejaria un
  // hueco en blanco al lado de la bandeja y a quien mira sin saber si falta
  // algo por cargar o si es que tiene que hacer el mismo una cosa. La frase lo
  // dice, y ademas ocupa el sitio para que la pagina no de un salto en cuanto
  // se seleccione la primera.
  if (solicitud === null) {
    return (
      <section aria-labelledby="detalle-titulo" className="tarjeta">
        <h2 id="detalle-titulo">Detalle</h2>
        <p>Elige una solicitud.</p>
      </section>
    );
  }

  // Aqui esta la decision del componente: los botones NO estan escritos en el
  // JSX, se derivan del estado actual. Una solicitud en `borrador` ensena un
  // boton; en `enviada`, dos; en los finales, ninguno.
  const acciones = accionesDeEstado(solicitud.estado);

  return (
    <section aria-labelledby="detalle-titulo" className="tarjeta">
      {/*
        La referencia en el titulo y no solo en la lista de abajo: es el nombre
        accesible de toda la seccion (`aria-labelledby`), asi que un lector de
        pantalla anuncia "SOL-2026-0007" al entrar, en vez de "Detalle" cuatro
        veces seguidas segun se van seleccionando solicitudes distintas.
      */}
      <h2 id="detalle-titulo">
        {solicitud.referencia} <EstadoChip estado={solicitud.estado} />
      </h2>

      {/*
        `<dl>` y no una pila de `<p>` ni una tabla de dos columnas: esto es
        exactamente una lista de pares nombre/valor, que es para lo que existe
        el elemento. Lo que se gana no es semantica de adorno —un lector de
        pantalla lee "Solicitante, Marta Ruiz Delgado" como una unidad, en vez
        de dos textos sueltos que hay que emparejar de oido—.
      */}
      <dl>
        <dt>Tipo</dt>
        {/*
          Mismo cruce que hace la bandeja en su columna, y con la misma funcion:
          `solicitud.tipo` es un id del catalogo externo (`alta-cuenta`) y
          ensenarlo crudo es ensenar la clave primaria de otro sistema.
        */}
        <dd>{nombreDeTipo(tipos, solicitud.tipo)}</dd>

        <dt>Solicitante</dt>
        <dd>{solicitud.solicitante}</dd>

        <dt>Operador</dt>
        {/*
          El `null` del contrato se traduce en `nombreDeOperador` y no con un
          `?? 'Sin asignar'` escrito aqui, porque hay DOS ausencias que no
          significan lo mismo: sin asignar (normal) y asignado a alguien que el
          catalogo no conoce (desajuste). La funcion las distingue; un `??` las
          confundiria.
        */}
        <dd>{nombreDeOperador(operadores, solicitud.operador)}</dd>

        <dt>Creada</dt>
        {/*
          `<time dateTime={...}>` guarda el valor de maquina —el ISO exacto que
          mando la API, con su zona— junto al texto formateado. Es lo que
          permite comprobar la fecha en un test sin depender de como se vea, y
          lo unico que queda si manana el formato cambia.
        */}
        <dd>
          <time dateTime={solicitud.creadaEn}>
            {comoFecha(solicitud.creadaEn)}
          </time>
        </dd>

        <dt>Actualizada</dt>
        <dd>
          <time dateTime={solicitud.actualizadaEn}>
            {comoFecha(solicitud.actualizadaEn)}
          </time>
        </dd>
      </dl>

      {/*
        Los dos caminos: o hay acciones y se pintan, o no hay ninguna y se dice
        por que. El segundo no es un adorno —sin el, una solicitud aprobada
        ensenaria la ficha y despues nada, y "no hay botones" se lee igual que
        "los botones todavia no han cargado"—.
      */}
      {acciones.length === 0 ? (
        <p>Esta solicitud ya esta cerrada.</p>
      ) : (
        <p className="tarjeta__acciones">
          {acciones.map((accion) => (
            <button
              // `key` por la accion y no por el indice: las acciones son
              // identificadores unicos y estables dentro de la lista, que es
              // justo lo que `key` quiere.
              key={accion}
              // `type="button"` explicito aunque no haya ningun `<form>`
              // alrededor: el valor por defecto de un `<button>` es `submit`, y
              // el dia que esto acabe dentro de un formulario, un clic enviaria
              // el formulario ademas de disparar la transicion.
              type="button"
              className={CLASE_ACCION[accion]}
              disabled={ocupado}
              onClick={() => {
                onAccion(accion);
              }}
            >
              {TEXTO_ACCION[accion]}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}
