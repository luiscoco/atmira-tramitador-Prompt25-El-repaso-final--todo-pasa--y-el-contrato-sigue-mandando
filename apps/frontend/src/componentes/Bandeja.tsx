// La bandeja: la lista de solicitudes, y el primer consumidor de verdad de la
// decision que tomo `App.tsx`.
//
// Cuatro props y ningun `useState`. Eso no es austeridad decorativa: es la
// prueba de que el estado esta en el sitio correcto. Si la bandeja necesitara
// guardar algo suyo —cual esta seleccionada, por ejemplo— habria dos copias de
// esa respuesta y alguna de las dos envejeceria. Aqui recibe el id que hay
// seleccionado y devuelve hacia arriba el que se ha pulsado; quien decide sigue
// siendo `App`.
//
// La consecuencia practica, que es la que importa: despues de una transicion
// basta con que `App` reemplace `solicitudes`. La bandeja se repinta con los
// datos nuevos sin que nadie le avise de nada, porque no recuerda nada.
//
// Acentos: comentarios acentuados, texto en pantalla en ASCII. Misma regla que
// el backend y que `api/cliente.ts`.

import type { Solicitud, Tipo } from '@tramitador/contrato';

import { nombreDeTipo } from '../etiquetas';
import { EstadoChip } from './EstadoChip';

interface PropsBandeja {
  /** Lo que hay que pintar, en el orden en que llega de la API. */
  readonly solicitudes: readonly Solicitud[];

  /**
   * El catalogo de tipos, entero.
   *
   * La bandeja recibe la LISTA y hace ella el cruce, en vez de recibir un
   * `Record<string, string>` ya resuelto o —peor— unas solicitudes con el
   * nombre del tipo ya metido dentro. Los dos atajos obligarian a `App` a
   * preparar datos para la vista, y `App` solo tiene lo que devuelve la API.
   * El cruce es un `find` sobre una lista de una decena de entradas: se hace
   * donde se necesita.
   */
  readonly tipos: readonly Tipo[];

  /** Id de la solicitud seleccionada, o `null` si no hay ninguna. */
  readonly seleccionada: string | null;

  /**
   * Aviso hacia arriba con el id pulsado.
   *
   * Devuelve el `id` y no la `Solicitud` entera por lo mismo que `App` guarda
   * un id: quien lo recibe ya tiene la lista y puede buscar el objeto cuando lo
   * necesite, mientras que el objeto que viajara por aqui seria una foto que
   * envejece.
   */
  readonly onSeleccionar: (id: string) => void;
}

/**
 * Realce de la fila seleccionada.
 *
 * Sigue aqui, en un `style` en linea, y NO en `estilos.css`.
 *
 * Se intento moverlo a una regla `tr[aria-current='true']` durante el paso de
 * apariencia, que es lo que se hizo con los colores de `EstadoChip`. Lo
 * revirtio un test: `Bandeja.test.tsx` comprueba que "el realce tambien se ve,
 * no solo se anuncia" leyendo `fila.style.backgroundColor`, y jsdom no carga
 * la hoja de estilos —`.style` solo refleja lo que esta en linea—, asi que en
 * CSS esa garantia deja de poder comprobarse.
 *
 * El caso es distinto al del chip: alli el color ES el componente y se
 * comprueba por `data-estado`. Aqui lo que el test protege es que la seleccion
 * no dependa SOLO de `aria-current`, y esa es justamente la clase de regresion
 * que un `style` en linea permite vigilar y una hoja externa no.
 *
 * El `:hover` de las filas si vive en `estilos.css`: no colisiona, porque un
 * estilo en linea gana a una regla de la hoja, que es exactamente lo que se
 * quiere —el hover no debe pisar a la fila abierta—.
 */
const FILA_SELECCIONADA = {
  backgroundColor: '#eef2ff',
  // El fondo solo no basta: quien no distinga bien ese azul muy claro del
  // blanco se queda sin saber cual esta abierta. La barra lateral es la senal
  // que sigue estando ahi en blanco y negro, y el `aria-current` de abajo es la
  // que llega a un lector de pantalla.
  boxShadow: 'inset 3px 0 0 0 #4338ca',
} as const;

export function Bandeja({
  solicitudes,
  tipos,
  seleccionada,
  onSeleccionar,
}: PropsBandeja) {
  // Salida temprana con la lista vacia. Una tabla con cabecera y sin ninguna
  // fila deja a quien mira preguntandose si esta cargando, si ha fallado algo o
  // si de verdad no hay nada; la frase lo dice.
  if (solicitudes.length === 0) {
    return <p>No hay solicitudes.</p>;
  }

  return (
    /* El envoltorio existe por una sola razon: a anchos de movil, cuatro
       columnas no caben en 400px y la tabla desbordaba la PAGINA entera, que
       es el peor sitio donde puede aparecer una barra horizontal. Con esto el
       scroll es de la tabla y el resto de la pantalla se queda quieto.

       `tabIndex={0}` y `role="group"` no son adorno: una zona que se desplaza
       tiene que poder desplazarse tambien con el teclado, y para eso necesita
       poder recibir el foco. Sin el `role`, un contenedor con `tabIndex` es un
       elemento enfocable sin nombre ni papel, que es justo lo que un lector de
       pantalla no sabe anunciar. El nombre sale del `aria-label`.

       La estructura de la tabla no cambia: `table > thead/tbody > tr >
       th[scope=row]` sigue intacta, y con ella todas las consultas por rol. */
    <div
      className="bandeja__marco"
      role="group"
      aria-label="Solicitudes, desplazable"
      tabIndex={0}
    >
      <table className="bandeja">
      {/*
        El `<caption>` es el nombre accesible de la tabla: es lo que anuncia un
        lector de pantalla al entrar en ella, y lo que permite pedirla por
        nombre desde un test. Un `<h2>` encima no haria ninguna de las dos
        cosas.

        El contador va DENTRO del caption, y no en un `<p>` encima, por eso
        mismo: asi el numero forma parte del nombre accesible ("Solicitudes
        12") en vez de ser un texto suelto que queda huerfano al entrar en la
        tabla. Es un `<span>` aparte solo para que el CSS pueda darle otro
        tamano; el texto "Solicitudes" no cambia.
      */}
      <caption>
        Solicitudes <span className="bandeja__contador">{solicitudes.length}</span>
      </caption>

      <thead>
        <tr>
          {/*
            `scope="col"` ata cada cabecera a su columna. Sin el, una tabla de
            mas de una fila se lee como una sucesion de celdas sueltas: quien
            navega con lector de pantalla oye "aprobada" sin oir "Estado".
          */}
          <th scope="col">Referencia</th>
          <th scope="col">Tipo</th>
          <th scope="col">Solicitante</th>
          <th scope="col">Estado</th>
        </tr>
      </thead>

      <tbody>
        {solicitudes.map((solicitud) => {
          const estaSeleccionada = solicitud.id === seleccionada;

          return (
            <tr
              // `key` por `id` y no por indice: el indice cambia en cuanto se
              // crea una solicitud o se filtra la lista, y React reutilizaria
              // la fila equivocada.
              key={solicitud.id}
              // `aria-current` es la mitad accesible del realce. Se pone
              // `undefined` y no `"false"` en las demas: el atributo ausente es
              // lo que significa "esta no", mientras que un `aria-current`
              // escrito con la cadena "false" es igual de verdadero para
              // algunos lectores.
              aria-current={estaSeleccionada ? 'true' : undefined}
              style={estaSeleccionada ? FILA_SELECCIONADA : undefined}
            >
              {/*
                La referencia es `<th scope="row">` y no `<td>`: es lo que
                identifica a la fila, y con ese scope un lector de pantalla la
                repite al moverse por las celdas de al lado ("SOL-2026-0007,
                Estado, aprobada"). Ademas es un boton de verdad y no un `<tr
                onClick>`: se enfoca con el tabulador, se activa con Enter y con
                espacio, y sale en la lista de controles sin que haya que
                anadirle un `role` ni un `tabIndex` a mano.
              */}
              <th scope="row">
                <button
                  type="button"
                  onClick={() => {
                    onSeleccionar(solicitud.id);
                  }}
                >
                  {solicitud.referencia}
                </button>
              </th>

              {/*
                Aqui esta el motivo de que `tipos` sea una prop. `solicitud.tipo`
                es un id del catalogo (`alta-cuenta`), y ensenarlo tal cual es
                ensenar la clave primaria de otro sistema. Se resuelve a su
                nombre; si el catalogo no lo tiene, `nombreDeTipo` devuelve el id
                y al menos se ve cual falta.
              */}
              <td>{nombreDeTipo(tipos, solicitud.tipo)}</td>

              <td>{solicitud.solicitante}</td>

              <td>
                <EstadoChip estado={solicitud.estado} />
              </td>
            </tr>
          );
        })}
        </tbody>
      </table>
    </div>
  );
}
