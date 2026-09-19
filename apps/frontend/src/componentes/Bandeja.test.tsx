/**
 * @vitest-environment jsdom
 */

// Los primeros tests del frontend, y la deuda que `17. FRONTEND.md` y
// `19. ESTADO.md` venian anotando: hacia falta un entorno DOM y una libreria de
// render. Son `jsdom` y Testing Library, los dos como devDependencies de
// `@tramitador/frontend`.
//
// El entorno se pide con el docblock de arriba y no en un `vitest.config.ts`
// global: el resto de la suite es backend y corre en Node, y montar un DOM para
// todo el monorepo seria pagar por algo que hoy solo usa este fichero.
//
// La regla que ordena lo que sigue: se comprueba lo que VE quien usa la
// aplicacion, no como esta hecho por dentro. Nada de buscar por clase CSS ni de
// contar `<div>`s. Por eso casi todas las consultas van por rol y por nombre
// accesible —`row`, `button`, `columnheader`—, que es exactamente lo que
// encuentra un lector de pantalla. El beneficio se cobra al refactorizar: se
// puede cambiar el maquetado entero y estos tests siguen valiendo; si dejan de
// pasar, es que ha cambiado lo que se ve.
//
// Acentos: comentarios acentuados, cadenas comparadas en ASCII, igual que en el
// resto de la suite.

import type { Solicitud, Tipo } from '@tramitador/contrato';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Bandeja } from './Bandeja';

// Testing Library desmonta sola entre tests cuando el framework expone
// `afterEach` como global. Vitest no lo hace salvo que se active `globals`, que
// aqui no esta activado, asi que se registra a mano. Sin esta linea el segundo
// test encontraria en el documento las filas del primero y las consultas
// fallarian por ambiguas.
afterEach(cleanup);

/* ------------------------------------------------------------------ *
 * Datos de ejemplo.
 * ------------------------------------------------------------------ */

// Escritos a mano y no leidos de `data/solicitudes.json`: el fichero de datos
// es un hecho del repo, y atar estos tests a el los pondria rojos el dia que
// alguien anada un registro de ejemplo.
//
// `satisfies` en vez de anotar el tipo: comprueba que cada objeto cumple
// `Solicitud` —si el contrato anade un campo obligatorio, esto deja de
// compilar— sin ensanchar los literales, asi que `estado` sigue siendo
// 'enviada' y no `Estado` a secas.
const TIPOS = [
  {
    id: 'alta-cuenta',
    nombre: 'Alta de cuenta',
    descripcion: 'Apertura de una cuenta nueva para un cliente.',
  },
  {
    id: 'cambio-titular',
    nombre: 'Cambio de titular',
    descripcion: 'Cambio del titular de una cuenta existente.',
  },
] as const satisfies readonly Tipo[];

const SOLICITUDES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    referencia: 'SOL-2026-0001',
    tipo: 'alta-cuenta',
    solicitante: 'Marta Ruiz Delgado',
    estado: 'enviada',
    operador: null,
    creadaEn: '2026-02-11T09:14:32Z',
    actualizadaEn: '2026-02-11T09:14:32Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    referencia: 'SOL-2026-0002',
    tipo: 'cambio-titular',
    solicitante: 'Javier Nunez Prieto',
    estado: 'aprobada',
    operador: 'op-0042',
    creadaEn: '2026-02-12T10:00:00Z',
    actualizadaEn: '2026-02-13T11:30:00Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    referencia: 'SOL-2026-0003',
    // A proposito: un tipo que NO esta en TIPOS. Tiene su propio test mas
    // abajo, y de paso asegura que las otras dos filas no dependen de que el
    // catalogo este completo.
    tipo: 'tipo-que-no-existe',
    solicitante: 'Ana Gil Sanz',
    estado: 'borrador',
    operador: null,
    creadaEn: '2026-02-14T08:00:00Z',
    actualizadaEn: '2026-02-14T08:00:00Z',
  },
] as const satisfies readonly Solicitud[];

/**
 * Monta la bandeja con los datos de ejemplo y devuelve el espia de seleccion.
 *
 * Existe para que cada test diga solo lo que le distingue —que hay
 * seleccionado— en vez de repetir las cuatro props enteras.
 */
function pintar(seleccionada: string | null = null) {
  const onSeleccionar = vi.fn<(id: string) => void>();

  render(
    <Bandeja
      solicitudes={SOLICITUDES}
      tipos={TIPOS}
      seleccionada={seleccionada}
      onSeleccionar={onSeleccionar}
    />,
  );

  return { onSeleccionar };
}

/** Las filas de datos, sin la de cabecera. */
function filasDeDatos(): readonly HTMLElement[] {
  const [, ...filas] = screen.getAllByRole('row');

  return filas;
}

/**
 * La fila en la posicion pedida, o un fallo claro si no esta.
 *
 * Es el precio de `noUncheckedIndexedAccess` (ver tsconfig.base.json): indexar
 * un array devuelve `HTMLElement | undefined`. En vez de sembrar el fichero de
 * `!`, se comprueba una vez aqui, y de paso un descuadre en el numero de filas
 * falla diciendo cual falta en lugar de reventar con "cannot read properties of
 * undefined" tres lineas mas abajo.
 */
function fila(indice: number): HTMLElement {
  const encontrada = filasDeDatos()[indice];

  if (encontrada === undefined) {
    throw new Error(`No hay fila de datos en la posicion ${String(indice)}.`);
  }

  return encontrada;
}

/* ------------------------------------------------------------------ *
 * Las filas.
 * ------------------------------------------------------------------ */

describe('las filas', () => {
  it('pinta una fila por solicitud, mas la de cabecera', () => {
    pintar();

    // 3 + 1. El `+ 1` se escribe explicitamente porque la fila del `<thead>`
    // tambien es un `row`: es el detalle que hace fallar este test la primera
    // vez que se escribe, y dejarlo a la vista evita que quien lo lea luego
    // crea que hay cuatro solicitudes.
    expect(screen.getAllByRole('row')).toHaveLength(SOLICITUDES.length + 1);
    expect(filasDeDatos()).toHaveLength(3);
  });

  it('tiene las cuatro columnas del enunciado, en orden', () => {
    pintar();

    expect(
      screen.getAllByRole('columnheader').map((celda) => celda.textContent),
    ).toEqual(['Referencia', 'Tipo', 'Solicitante', 'Estado']);
  });

  it('pinta en cada fila la referencia, el tipo, el solicitante y el estado', () => {
    pintar();

    // `within` acota la busqueda a una fila: sin el, `getByText('Enviada')`
    // buscaria en toda la tabla y un test verde no probaria que el dato esta en
    // la fila que le toca, solo que esta en alguna parte.
    const primera = within(fila(0));

    expect(primera.getByRole('button').textContent).toBe('SOL-2026-0001');
    expect(primera.getByText('Alta de cuenta')).toBeDefined();
    expect(primera.getByText('Marta Ruiz Delgado')).toBeDefined();
    expect(primera.getByText('Enviada')).toBeDefined();

    const segunda = within(fila(1));

    expect(segunda.getByRole('button').textContent).toBe('SOL-2026-0002');
    expect(segunda.getByText('Cambio de titular')).toBeDefined();
    expect(segunda.getByText('Javier Nunez Prieto')).toBeDefined();
    expect(segunda.getByText('Aprobada')).toBeDefined();
  });

  it('la referencia de cada fila es un boton', () => {
    pintar();

    expect(
      screen.getAllByRole('button').map((boton) => boton.textContent),
    ).toEqual(['SOL-2026-0001', 'SOL-2026-0002', 'SOL-2026-0003']);
  });

  it('el estado va en un chip, no en texto suelto', () => {
    pintar();

    // Lo unico que se le pide al chip desde aqui: que exista como elemento
    // propio y que lleve el estado en `data-estado`. Como este pintado —el
    // color, el icono, el borde— es cosa de `EstadoChip` y no de la bandeja.
    //
    // Los dos valores son distintos y eso es justo lo que se comprueba: lo que
    // se LEE es 'Enviada', con mayuscula, y lo que viaja en el atributo es el
    // identificador del contrato, 'enviada'. El texto puede cambiar (o
    // traducirse); el identificador, no.
    const chip = within(fila(0)).getByText('Enviada');

    expect(chip.getAttribute('data-estado')).toBe('enviada');
  });

  it('avisa cuando no hay ninguna solicitud', () => {
    render(
      <Bandeja
        solicitudes={[]}
        tipos={TIPOS}
        seleccionada={null}
        onSeleccionar={vi.fn()}
      />,
    );

    expect(screen.getByText('No hay solicitudes.')).toBeDefined();
    // Y no una tabla con cabecera y cero filas, que deja a quien mira sin saber
    // si esta cargando, si ha fallado algo o si de verdad no hay nada.
    expect(screen.queryByRole('table')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * El tipo: nombre, nunca el id.
 * ------------------------------------------------------------------ */

describe('la columna de tipo', () => {
  it('ensena el nombre del catalogo y no el id', () => {
    pintar();

    expect(screen.getByText('Alta de cuenta')).toBeDefined();
    expect(screen.getByText('Cambio de titular')).toBeDefined();

    // La otra mitad, que es la que de verdad fija el requisito: el id NO
    // aparece. Sin estos `queryByText` el test pasaria igual con una celda que
    // pintase "alta-cuenta (Alta de cuenta)".
    expect(screen.queryByText('alta-cuenta')).toBeNull();
    expect(screen.queryByText('cambio-titular')).toBeNull();
  });

  it('cae al id cuando el catalogo no tiene ese tipo', () => {
    pintar();

    // No es un capricho: `tipos` y `solicitudes` son dos peticiones distintas y
    // el catalogo es externo, asi que el desajuste puede ocurrir. Lo que se fija
    // aqui es que la fila se sigue pintando entera en vez de romper la tabla.
    const tercera = within(fila(2));

    expect(tercera.getByText('tipo-que-no-existe')).toBeDefined();
    expect(tercera.getByText('Ana Gil Sanz')).toBeDefined();
    expect(tercera.getByRole('button').textContent).toBe('SOL-2026-0003');
  });
});

/* ------------------------------------------------------------------ *
 * El clic.
 * ------------------------------------------------------------------ */

describe('la seleccion', () => {
  it('llama a onSeleccionar con el id al pulsar la referencia', async () => {
    const usuario = userEvent.setup();
    const { onSeleccionar } = pintar();

    await usuario.click(screen.getByRole('button', { name: 'SOL-2026-0002' }));

    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    // El `id`, no la referencia ni el objeto entero: es lo que `App` guarda en
    // su estado y lo que necesita la API para transicionar.
    expect(onSeleccionar).toHaveBeenCalledWith(SOLICITUDES[1].id);
  });

  it('cada fila manda su propio id', async () => {
    const usuario = userEvent.setup();
    const { onSeleccionar } = pintar();

    await usuario.click(screen.getByRole('button', { name: 'SOL-2026-0001' }));
    await usuario.click(screen.getByRole('button', { name: 'SOL-2026-0003' }));

    // Se comprueban las dos llamadas y no solo la ultima: el fallo clasico de
    // un componente asi es capturar mal la variable del map y mandar siempre el
    // mismo id, y con una sola llamada eso no se ve.
    expect(onSeleccionar.mock.calls).toEqual([
      [SOLICITUDES[0].id],
      [SOLICITUDES[2].id],
    ]);
  });

  it('pulsar la que ya esta seleccionada vuelve a avisar', async () => {
    const usuario = userEvent.setup();
    const { onSeleccionar } = pintar(SOLICITUDES[0].id);

    await usuario.click(screen.getByRole('button', { name: 'SOL-2026-0001' }));

    // La bandeja no filtra el clic redundante. Que significa —ignorarlo,
    // deseleccionar— lo decide `App`, que es quien tiene el estado; si la
    // bandeja se lo guardase, estaria tomando esa decision por su cuenta.
    expect(onSeleccionar).toHaveBeenCalledWith(SOLICITUDES[0].id);
  });

  it('no llama a nadie si no se pulsa nada', () => {
    const { onSeleccionar } = pintar();

    expect(onSeleccionar).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * El realce.
 * ------------------------------------------------------------------ */

describe('la fila seleccionada', () => {
  it('marca solo la fila cuyo id coincide', () => {
    pintar(SOLICITUDES[1].id);

    expect(fila(1).getAttribute('aria-current')).toBe('true');
    expect(fila(0).hasAttribute('aria-current')).toBe(false);
    expect(fila(2).hasAttribute('aria-current')).toBe(false);
  });

  it('el realce tambien se ve, no solo se anuncia', () => {
    pintar(SOLICITUDES[1].id);

    // Se comprueba que hay ALGUN fondo, no cual: el color concreto es una
    // decision de diseno que puede cambiar manana, y fijar el hexadecimal aqui
    // convertiria este test en un freno en vez de en una red.
    expect(fila(1).style.backgroundColor).not.toBe('');
    expect(fila(0).style.backgroundColor).toBe('');
  });

  it('con seleccionada a null no hay ninguna fila marcada', () => {
    pintar(null);

    expect(screen.queryByRole('row', { current: true })).toBeNull();
  });

  it('un id que no esta en la lista no marca nada', () => {
    pintar('99999999-9999-4999-8999-999999999999');

    // El caso real: `App` deriva la solicitud con un `find` que puede devolver
    // `undefined` —una recarga que ya no la trae, un filtro por estado—. La
    // bandeja tiene que quedarse sin realce, no elegir una al azar.
    expect(screen.queryByRole('row', { current: true })).toBeNull();
  });
});
