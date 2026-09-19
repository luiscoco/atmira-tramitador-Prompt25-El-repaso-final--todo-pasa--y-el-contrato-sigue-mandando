// La etiqueta de estado: un componente de una sola linea util.
//
// Es su propio fichero y no un `<span>` suelto dentro de `<Bandeja>` por una
// razon concreta: el estado se va a pintar en dos sitios (la fila de la bandeja
// y la cabecera del detalle) y tiene que verse IGUAL en los dos. Con el color
// escrito en linea dentro de la tabla, el detalle acabaria con su propia copia
// y las dos se separarian en cuanto una cambie.
//
// No recibe `onClick` ni nada parecido: es decorativo y no se puede pulsar.
// Quien selecciona la solicitud es el boton de la referencia, y tener dos
// elementos clicables en la misma fila para la misma accion solo anade ruido
// para quien navega con teclado.
//
// Dos cosas han cambiado respecto a la primera version:
//
//   1. Ya no pinta el identificador crudo (`enviada`), sino el texto para
//      leer (`Enviada`). El identificador sigue estando, pero en
//      `data-estado`, que es donde lo quiere el CSS y donde lo buscan los
//      tests.
//   2. Los colores ya no van en `style`: viven en `estilos.css`, colgados de
//      ese mismo `data-estado`. Es la deuda que `20. BANDEJA.md` dejo anotada
//      ("el dia que haya CSS de verdad, `data-estado` ya esta puesto para
//      engancharlo sin tocar el JSX"), y se cobra sin tocar el JSX, tal cual.
//
// Acentos: comentarios acentuados, texto en pantalla en ASCII. Los cuatro
// estados del contrato no llevan tilde, asi que aqui la regla no cuesta nada.

import type { Estado } from '@tramitador/contrato';

/**
 * Texto e icono de cada estado.
 *
 * `Record<Estado, ...>` y no un objeto suelto: el dia que `openapi.yaml` anada
 * un quinto estado, `npm run gen` lo mete en la union y este objeto deja de
 * compilar hasta que se le den texto e icono. Es el mismo truco que usa
 * `ESTADOS` en el paquete de contrato, y el motivo de que no haya aqui ningun
 * `default`.
 *
 * El color NO esta aqui. Esta en `estilos.css`, y esa separacion es la que
 * permite cambiar la paleta entera sin recompilar un solo componente.
 *
 * Sobre el `icono`: es la `d` de un unico `<path>` sobre un lienzo de 16x16.
 * Se guarda la cadena y no un elemento JSX para que esta tabla siga siendo
 * datos —se lee de un vistazo, se compara, se prueba— en vez de cuatro trozos
 * de maquetado. Las cuatro formas se eligieron para que se distingan por su
 * SILUETA, no por su relleno: circulo abierto, flecha, check y aspa siguen
 * siendo cuatro cosas distintas impresas en blanco y negro.
 */
const ETIQUETAS: Record<
  Estado,
  { readonly texto: string; readonly icono: string }
> = {
  // Circulo abierto: aun no ha salido de las manos de quien la creo.
  borrador: {
    texto: 'Borrador',
    icono: 'M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11',
  },
  // Flecha: ya ha salido, esta en juego esperando decision.
  enviada: { texto: 'Enviada', icono: 'M3 8h9m-3.5-3.5L13 8l-4.5 3.5' },
  // Check y aspa: los dos estados finales, y los dos unicos iconos que la
  // mayoria de la gente reconoce sin leer nada.
  aprobada: { texto: 'Aprobada', icono: 'M3.5 8.5l3 3 6-7' },
  rechazada: { texto: 'Rechazada', icono: 'M4 4l8 8m0-8l-8 8' },
};

interface PropsEstadoChip {
  readonly estado: Estado;
}

export function EstadoChip({ estado }: PropsEstadoChip) {
  const { texto, icono } = ETIQUETAS[estado];

  return (
    // `data-estado` hace ahora dos trabajos: es el gancho del CSS (cada estado
    // tiene su regla en `estilos.css`) y es el identificador del contrato, sin
    // tilde y sin mayusculas, para quien tenga que comprobar el estado sin
    // depender del texto visible. Lo segundo importa mas de lo que parece: el
    // texto es de la interfaz y puede traducirse manana; `enviada` es del
    // contrato y no.
    <span className="chip-estado" data-estado={estado}>
      {/*
        El icono es la mitad de la accesibilidad de este componente. El color de
        fondo no puede ser la unica senal que distinga un estado de otro: quien
        no distinga el verde del rojo —una de cada doce personas, mas o menos—,
        quien lo imprima en blanco y negro o quien tenga el modo de alto
        contraste del sistema encendido (que descarta los fondos) se quedaria
        sin la informacion. Aqui hay tres senales redundantes: la FORMA del
        icono, el TEXTO y, solo de propina, el color.

        `aria-hidden` porque para un lector de pantalla el icono es ruido: el
        texto de al lado ya dice lo mismo, y anunciarlo dos veces molesta.
        `focusable="false"` es el equivalente para el Internet Explorer viejo y
        para algun motor que todavia mete los <svg> en el orden de tabulacion.
      */}
      <svg
        className="chip-estado__icono"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        {/*
          `stroke="currentColor"` y no un color propio: el trazo hereda el
          `color` que el CSS le da al chip, asi que el icono nunca se puede
          descuadrar de su estado. Una regla menos que mantener sincronizada.
        */}
        <path
          d={icono}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/*
        El texto va suelto, sin envolverlo en otro `<span>`. No es pereza: con
        un envoltorio, `getByText('Enviada')` encontraria DOS elementos (el
        interior y el chip, que tiene el mismo textContent) y Testing Library
        falla con "found multiple elements". Asi el unico que casa es el chip, y
        de el se puede leer `data-estado` directamente.
      */}
      {texto}
    </span>
  );
}
