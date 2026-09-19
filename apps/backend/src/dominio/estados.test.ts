// Tests de la máquina de estados.
//
// Todo lo que hay aquí son llamadas a función con valores literales: no se
// levanta Fastify, no se lee `data/`, no hay `async` ni mocks. Eso no es una
// casualidad del test, es la consecuencia de la decisión que documenta
// `9. DOMINIO.md`: `transicionar` devuelve el fallo como valor en vez de
// lanzarlo, así que el caso ilegal se afirma igual que el legal y recorrer los
// doce pares (4 estados × 3 acciones) sale gratis.
//
// El oráculo del test es `LEGALES`, escrito a mano justo debajo a partir del
// contrato. Deliberadamente NO se importa `TRANSICIONES`: un test que leyera la
// misma tabla que el código solo comprobaría que un objeto es igual a sí mismo.
// Todo lo demás (qué está permitido, qué es final, qué motivo se espera) se
// deriva de esa lista, de modo que tocar la tabla del dominio sin tocar el
// contrato pone rojo este fichero.
//
// Sobre los acentos, misma regla que en `estados.ts`: los comentarios van
// acentuados; los textos que se comparan carácter a carácter con `motivo` van
// en ASCII, porque así los documenta openapi.yaml.

import { describe, expect, it } from 'vitest';

import { ACCIONES, ESTADOS, type Accion, type Estado } from '@tramitador/contrato';

import { accionesPermitidas, esFinal, transicionar } from './estados';

/* ------------------------------------------------------------------ *
 * El oráculo: las tres transiciones legales del contrato.
 * ------------------------------------------------------------------ */

interface Legal {
  readonly estado: Estado;
  readonly accion: Accion;
  readonly destino: Estado;
}

// borrador --enviar--> enviada --aprobar--> aprobada (final)
//                             \--rechazar-> rechazada (final)
const LEGALES = [
  { estado: 'borrador', accion: 'enviar', destino: 'enviada' },
  { estado: 'enviada', accion: 'aprobar', destino: 'aprobada' },
  { estado: 'enviada', accion: 'rechazar', destino: 'rechazada' },
] as const satisfies readonly Legal[];

/** Destino esperado de un par, o `undefined` si el par no es legal. */
function destinoEsperado(estado: Estado, accion: Accion): Estado | undefined {
  return LEGALES.find((legal) => legal.estado === estado && legal.accion === accion)?.destino;
}

/** Acciones que el contrato permite desde `estado`, en el orden de `ACCIONES`. */
function permitidasEsperadas(estado: Estado): Accion[] {
  return ACCIONES.filter((accion) => destinoEsperado(estado, accion) !== undefined);
}

/** El `motivo` exacto que debe salir de un par ilegal. */
function motivoEsperado(estado: Estado, accion: Accion, lista: string): string {
  return `Estado actual: ${estado}; accion solicitada: ${accion}. Acciones permitidas desde ${estado}: ${lista}.`;
}

/** Los doce pares (estado, acción), para las tablas exhaustivas. */
const PARES = ESTADOS.flatMap((estado) => ACCIONES.map((accion) => ({ estado, accion })));

const ILEGALES = PARES.filter(({ estado, accion }) => destinoEsperado(estado, accion) === undefined);

/* ------------------------------------------------------------------ *
 * transicionar: los tres pares legales.
 * ------------------------------------------------------------------ */

describe('transicionar: transiciones legales', () => {
  it.each(LEGALES)('$estado + $accion -> $destino', ({ estado, accion, destino }) => {
    // `toEqual` sobre el objeto entero y no sobre `resultado.estado`: así el
    // test también afirma que no aparece ningún campo de más (un `motivo`
    // colado en el caso bueno, por ejemplo).
    expect(transicionar(estado, accion)).toEqual({ ok: true, estado: destino });
  });

  it('cubre las tres transiciones que describe el contrato, ni una mas', () => {
    const legalesSegunElDominio = PARES.filter(
      ({ estado, accion }) => transicionar(estado, accion).ok,
    );

    expect(legalesSegunElDominio).toHaveLength(LEGALES.length);
  });
});

/* ------------------------------------------------------------------ *
 * transicionar: los nueve pares ilegales.
 * ------------------------------------------------------------------ */

describe('transicionar: acciones no permitidas', () => {
  it('hay nueve pares ilegales de los doce posibles', () => {
    expect(PARES).toHaveLength(ESTADOS.length * ACCIONES.length);
    expect(ILEGALES).toHaveLength(9);
  });

  it.each(ILEGALES)('$estado + $accion devuelve ok:false', ({ estado, accion }) => {
    const resultado = transicionar(estado, accion);

    expect(resultado.ok).toBe(false);
    // El estrechamiento de la unión discriminada es justo lo que permite leer
    // `motivo` sin castear: dentro del `if` el tipo ya no tiene el caso `ok:
    // true`.
    if (resultado.ok) throw new Error('inalcanzable: el par es ilegal');

    expect(resultado).toEqual({ ok: false, motivo: expect.any(String) });
    expect(resultado).not.toHaveProperty('estado');
  });

  it.each(ILEGALES)(
    '$estado + $accion explica que se puede hacer en su lugar',
    ({ estado, accion }) => {
      const resultado = transicionar(estado, accion);
      if (resultado.ok) throw new Error('inalcanzable: el par es ilegal');

      const permitidas = permitidasEsperadas(estado);
      const lista = permitidas.length > 0 ? permitidas.join(', ') : 'ninguna (estado final)';

      // La igualdad exacta es la afirmación fuerte: fija el texto que acabará
      // en el `detalle` del 409, incluido el orden de la lista de acciones.
      expect(resultado.motivo).toBe(motivoEsperado(estado, accion, lista));

      // Y estas dos, más flojas, dicen en voz alta lo que importa del mensaje:
      // menciona el estado y la acción rechazada...
      expect(resultado.motivo).toContain(`Estado actual: ${estado}`);
      expect(resultado.motivo).toContain(`accion solicitada: ${accion}`);

      // ...y menciona TODAS las acciones que sí valen desde ese estado, y solo
      // esas: la que se acaba de rechazar no puede aparecer en la lista.
      const trasLosDosPuntos = resultado.motivo.split(`permitidas desde ${estado}: `)[1] ?? '';
      for (const accionOk of permitidas) {
        expect(trasLosDosPuntos).toContain(accionOk);
      }
      expect(trasLosDosPuntos).not.toContain(accion);
    },
  );

  it('el motivo de un estado no final nombra la alternativa real', () => {
    // Dos casos escritos enteros a mano, sin plantilla, como ancla legible de
    // lo que las tablas de arriba comprueban en bucle.
    expect(transicionar('borrador', 'aprobar')).toEqual({
      ok: false,
      motivo:
        'Estado actual: borrador; accion solicitada: aprobar. Acciones permitidas desde borrador: enviar.',
    });

    expect(transicionar('enviada', 'enviar')).toEqual({
      ok: false,
      motivo:
        'Estado actual: enviada; accion solicitada: enviar. Acciones permitidas desde enviada: aprobar, rechazar.',
    });
  });

  it('nunca lanza: los doce pares devuelven un resultado', () => {
    for (const { estado, accion } of PARES) {
      expect(() => transicionar(estado, accion)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Estados finales.
 * ------------------------------------------------------------------ */

describe('estados finales', () => {
  const FINALES = ['aprobada', 'rechazada'] as const satisfies readonly Estado[];
  const NO_FINALES = ['borrador', 'enviada'] as const satisfies readonly Estado[];

  it.each(FINALES)('%s no permite ninguna accion', (estado) => {
    expect(accionesPermitidas(estado)).toEqual([]);
    expect(esFinal(estado)).toBe(true);
  });

  it.each(NO_FINALES)('%s no es final', (estado) => {
    expect(accionesPermitidas(estado).length).toBeGreaterThan(0);
    expect(esFinal(estado)).toBe(false);
  });

  // La tabla cruzada: los seis pares (2 finales × 3 acciones) fallan todos, y
  // con el motivo que distingue "aqui se acabo" de "ahora no toca".
  it.each(FINALES.flatMap((estado) => ACCIONES.map((accion) => ({ estado, accion }))))(
    '$estado rechaza $accion por ser estado final',
    ({ estado, accion }) => {
      expect(transicionar(estado, accion)).toEqual({
        ok: false,
        motivo: motivoEsperado(estado, accion, 'ninguna (estado final)'),
      });
    },
  );

  it('los estados finales son exactamente aprobada y rechazada', () => {
    expect(ESTADOS.filter(esFinal)).toEqual([...FINALES]);
  });
});

/* ------------------------------------------------------------------ *
 * accionesPermitidas: los cuatro estados.
 * ------------------------------------------------------------------ */

describe('accionesPermitidas', () => {
  // Escrito a mano, valor a valor, incluido el orden. No se deriva de nada: es
  // la lista que alguien tendría que venir a cambiar aquí a propósito si
  // cambiara la máquina de estados.
  const ESPERADAS: Record<Estado, Accion[]> = {
    borrador: ['enviar'],
    enviada: ['aprobar', 'rechazar'],
    aprobada: [],
    rechazada: [],
  };

  it.each(ESTADOS)('devuelve el array correcto para %s', (estado) => {
    expect(accionesPermitidas(estado)).toEqual(ESPERADAS[estado]);
  });

  it('cubre los cuatro estados del contrato', () => {
    expect(Object.keys(ESPERADAS).sort()).toEqual([...ESTADOS].sort());
  });

  it('respeta el orden canonico de ACCIONES, no el de insercion de la tabla', () => {
    // `enviada` es el único estado con más de una salida, así que es el único
    // sitio donde el orden se puede observar.
    expect(accionesPermitidas('enviada')).toEqual(['aprobar', 'rechazar']);
    expect(accionesPermitidas('enviada')).not.toEqual(['rechazar', 'aprobar']);
  });

  it('cada accion devuelta es realmente aplicable', () => {
    // Cierra el círculo entre las dos funciones públicas: lo que
    // `accionesPermitidas` anuncia, `transicionar` lo acepta.
    for (const estado of ESTADOS) {
      for (const accion of accionesPermitidas(estado)) {
        expect(transicionar(estado, accion).ok).toBe(true);
      }
    }
  });

  it('devuelve un array nuevo en cada llamada', () => {
    // Si compartiera el array, quien llamara podría vaciarle la máquina de
    // estados a otro con un `.pop()`.
    const primera = accionesPermitidas('enviada');
    primera.pop();

    expect(accionesPermitidas('enviada')).toEqual(['aprobar', 'rechazar']);
  });
});

/* ------------------------------------------------------------------ *
 * El valor que no debería existir.
 * ------------------------------------------------------------------ */

describe('estado fuera del contrato', () => {
  // Los estados llegan de un JSON en disco o de una query: `Estado` ahí es una
  // promesa, no un hecho. El cast reproduce ese caso a propósito.
  const DESCONOCIDO = 'archivada' as Estado;

  it('no lanza y lo trata como estado sin salidas', () => {
    expect(accionesPermitidas(DESCONOCIDO)).toEqual([]);
    expect(transicionar(DESCONOCIDO, 'enviar')).toEqual({
      ok: false,
      motivo: motivoEsperado(DESCONOCIDO, 'enviar', 'ninguna (estado desconocido)'),
    });
  });

  it('no lo confunde con un estado final en el mensaje', () => {
    const resultado = transicionar(DESCONOCIDO, 'aprobar');
    if (resultado.ok) throw new Error('inalcanzable: el estado no existe');

    expect(resultado.motivo).toContain('ninguna (estado desconocido)');
    expect(resultado.motivo).not.toContain('estado final');
  });
});
