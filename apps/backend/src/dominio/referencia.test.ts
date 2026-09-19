// Tests del generador de referencias.
//
// Mismo régimen que `estados.test.ts`: llamadas a función con arrays literales.
// No se lee `data/solicitudes.json` ni se levanta nada. Que el fichero de datos
// tenga hoy doce referencias de 2026 es un hecho del repo, no del dominio, y
// atarlo aquí haría que estos tests se pusieran rojos el día que alguien añada
// un registro de ejemplo.
//
// El oráculo es el enunciado, escrito a mano en cada caso: el secuencial más
// alto ENTRE LAS REFERENCIAS DEL MISMO AÑO, más uno, con cuatro dígitos. Los
// tres casos límite del enunciado tienen cada uno su `describe`, porque son los
// que de verdad distinguen esta implementación de las ingenuas (contar cuántas
// hay, o mirar la última de la lista).
//
// Acentos: comentarios acentuados, cadenas comparadas en ASCII, igual que en el
// resto del dominio.

import { describe, expect, it } from 'vitest';

import { PATRON_REFERENCIA, siguienteReferencia } from './referencia';

/* ------------------------------------------------------------------ *
 * Caso limite 1: no hay ninguna referencia del anio pedido.
 * ------------------------------------------------------------------ */

describe('sin referencias del anio pedido', () => {
  it('empieza en 0001 con la lista vacia', () => {
    expect(siguienteReferencia([], 2026)).toBe('SOL-2026-0001');
  });

  it('empieza en 0001 cuando todas las referencias son de otros anios', () => {
    const existentes = ['SOL-2024-0009', 'SOL-2025-0431', 'SOL-2023-9999'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0001');
  });

  it('cada anio nuevo vuelve a empezar en 0001', () => {
    // El caso real del repo: `data/solicitudes.json` llega hasta SOL-2026-0012,
    // y aun asi 2027 arranca de cero. Si el maximo se calculara sobre TODAS las
    // referencias, aqui saldria SOL-2027-0013.
    const dosMilVeintiseis = Array.from(
      { length: 12 },
      (_, i) => `SOL-2026-${String(i + 1).padStart(4, '0')}`,
    );

    expect(siguienteReferencia(dosMilVeintiseis, 2026)).toBe('SOL-2026-0013');
    expect(siguienteReferencia(dosMilVeintiseis, 2027)).toBe('SOL-2027-0001');
  });

  it('el anio anterior no arrastra su secuencial al siguiente', () => {
    expect(siguienteReferencia(['SOL-2025-0999'], 2026)).toBe('SOL-2026-0001');
  });
});

/* ------------------------------------------------------------------ *
 * Caso limite 2: hay referencias de otros anios que no deben contar.
 * ------------------------------------------------------------------ */

describe('referencias de otros anios', () => {
  it('ignora un secuencial mas alto de un anio anterior', () => {
    // La trampa: 9999 es el numero mas grande de la lista, pero es de 2025. El
    // maximo de 2026 es 3, asi que la respuesta es 0004 y no 10000 ni 0001.
    const existentes = ['SOL-2025-9999', 'SOL-2026-0003', 'SOL-2025-0500'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0004');
  });

  it('ignora tambien los anios posteriores', () => {
    // Que existan referencias de 2027 no dice nada sobre lo que queda libre en
    // 2026: el filtro es por anio exacto, no "hasta el anio pedido".
    const existentes = ['SOL-2027-0050', 'SOL-2026-0007'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0008');
  });

  it('cuenta el maximo del anio, no cuantas referencias hay en total', () => {
    // Nueve referencias en la lista, pero solo dos de 2026, y su maximo es 40.
    // Una implementacion que hiciera `existentes.length + 1` daria 0010, y una
    // que contara solo las del anio daria 0003.
    const existentes = [
      'SOL-2024-0001',
      'SOL-2024-0002',
      'SOL-2024-0003',
      'SOL-2025-0001',
      'SOL-2025-0002',
      'SOL-2026-0040',
      'SOL-2025-0003',
      'SOL-2026-0011',
      'SOL-2025-0004',
    ];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0041');
  });

  it('el mismo secuencial en otro anio no es el mismo secuencial', () => {
    const existentes = ['SOL-2025-0007', 'SOL-2026-0007', 'SOL-2027-0007'];

    expect(siguienteReferencia(existentes, 2025)).toBe('SOL-2025-0008');
    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0008');
    expect(siguienteReferencia(existentes, 2027)).toBe('SOL-2027-0008');
    expect(siguienteReferencia(existentes, 2028)).toBe('SOL-2028-0001');
  });
});

/* ------------------------------------------------------------------ *
 * Caso limite 3: las referencias no vienen ordenadas.
 * ------------------------------------------------------------------ */

describe('lista desordenada', () => {
  it('no se queda con la ultima de la lista', () => {
    // `SOL-2026-0002` ocupa la ultima posicion del array, pero el maximo es
    // 0012. Una implementacion que leyera `existentes.at(-1)` daria 0003.
    const existentes = ['SOL-2026-0012', 'SOL-2026-0005', 'SOL-2026-0002'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0013');
  });

  it('no se queda con la primera de la lista', () => {
    const existentes = ['SOL-2026-0002', 'SOL-2026-0005', 'SOL-2026-0012'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0013');
  });

  it('da el mismo resultado en cualquier orden', () => {
    const base = ['SOL-2026-0004', 'SOL-2025-0100', 'SOL-2026-0031', 'SOL-2026-0018'];
    const ordenes = [
      base,
      [...base].reverse(),
      ['SOL-2026-0031', 'SOL-2026-0004', 'SOL-2025-0100', 'SOL-2026-0018'],
      ['SOL-2025-0100', 'SOL-2026-0018', 'SOL-2026-0031', 'SOL-2026-0004'],
    ];

    for (const orden of ordenes) {
      expect(siguienteReferencia(orden, 2026)).toBe('SOL-2026-0032');
    }
  });

  it('no muta el array que recibe', () => {
    // Si ordenara con `.sort()` en vez de recorrer, este test lo cazaria: en la
    // capa de datos ese array sale de la lista de solicitudes cargada en
    // memoria, y reordenarla de rebote cambiaria el orden de un listado.
    const existentes = ['SOL-2026-0012', 'SOL-2026-0005', 'SOL-2026-0002'];
    const copia = [...existentes];

    siguienteReferencia(existentes, 2026);

    expect(existentes).toEqual(copia);
  });

  it('el maximo es numerico, aunque con cuatro digitos coincida con el textual', () => {
    // Con relleno de ceros, ordenar como texto da el mismo maximo que ordenar
    // como numero. Es cierto hoy, y por eso conviene dejarlo dicho: el codigo
    // compara numeros y no depende de esa coincidencia.
    const existentes = ['SOL-2026-0100', 'SOL-2026-0099', 'SOL-2026-0009'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0101');
  });
});

/* ------------------------------------------------------------------ *
 * El formato de salida.
 * ------------------------------------------------------------------ */

describe('formato de la referencia generada', () => {
  it.each([
    { existentes: [], esperada: 'SOL-2026-0001' },
    { existentes: ['SOL-2026-0008'], esperada: 'SOL-2026-0009' },
    { existentes: ['SOL-2026-0009'], esperada: 'SOL-2026-0010' },
    { existentes: ['SOL-2026-0099'], esperada: 'SOL-2026-0100' },
    { existentes: ['SOL-2026-0999'], esperada: 'SOL-2026-1000' },
    { existentes: ['SOL-2026-9998'], esperada: 'SOL-2026-9999' },
  ])('$existentes -> $esperada', ({ existentes, esperada }) => {
    // Los saltos de digito (0009 -> 0010, 0099 -> 0100, 0999 -> 1000) son donde
    // se rompe un `padStart` mal puesto o una concatenacion a mano.
    expect(siguienteReferencia(existentes, 2026)).toBe(esperada);
  });

  it('siempre casa con el pattern del contrato', () => {
    const casos = [
      { existentes: [] as string[], anio: 2026 },
      { existentes: ['SOL-2026-0007'], anio: 2026 },
      { existentes: ['SOL-2026-9998'], anio: 2026 },
      { existentes: ['SOL-1999-0001'], anio: 1999 },
    ];

    for (const { existentes, anio } of casos) {
      expect(siguienteReferencia(existentes, anio)).toMatch(PATRON_REFERENCIA);
    }
  });

  it('el pattern local es el mismo que el de openapi.yaml', () => {
    // Copiado a mano del `pattern` de `Solicitud.referencia`. Si alguien afloja
    // la expresion del dominio, esta comparacion lo dice.
    expect(PATRON_REFERENCIA.source).toBe('^SOL-\\d{4}-\\d{4}$');
    expect('SOL-2026-0007').toMatch(PATRON_REFERENCIA);
    expect('SOL-2026-7').not.toMatch(PATRON_REFERENCIA);
  });
});

/* ------------------------------------------------------------------ *
 * Entradas que no deberian existir.
 * ------------------------------------------------------------------ */

describe('referencias que no casan con el formato', () => {
  it.each([
    ['sol-2026-0004', 'minusculas'],
    ['REF-2026-0004', 'otro prefijo'],
    ['SOL-2026-4', 'sin relleno de ceros'],
    ['SOL-2026-00004', 'cinco digitos'],
    ['SOL-2026-0004-bis', 'con sufijo'],
    [' SOL-2026-0004', 'con espacio delante'],
    ['SOL-20260004', 'sin guion'],
    ['', 'cadena vacia'],
  ])('ignora %s (%s)', (rara) => {
    // Ninguna de estas participa en el maximo: el unico valor que cuenta es
    // SOL-2026-0002, asi que la respuesta es 0003 en todos los casos.
    expect(siguienteReferencia([rara, 'SOL-2026-0002'], 2026)).toBe('SOL-2026-0003');
  });

  it('no lanza aunque todas las referencias sean basura', () => {
    const basura = ['', 'x', 'SOL--', 'SOL-2026-', '2026-0001'];

    expect(siguienteReferencia(basura, 2026)).toBe('SOL-2026-0001');
  });

  it('sobrevive a valores que ni siquiera son cadenas', () => {
    // El array sale de un `JSON.parse` de `data/solicitudes.json`: el tipo
    // `string[]` es una promesa, no un hecho. El cast reproduce ese caso.
    const sucias = [null, undefined, 7, {}, ['SOL-2026-0099'], 'SOL-2026-0002'] as unknown as string[];

    expect(() => siguienteReferencia(sucias, 2026)).not.toThrow();
    expect(siguienteReferencia(sucias, 2026)).toBe('SOL-2026-0003');
  });

  it('el secuencial 0000 no cuenta como referencia adjudicada', () => {
    expect(siguienteReferencia(['SOL-2026-0000'], 2026)).toBe('SOL-2026-0001');
  });

  it('los duplicados no suman', () => {
    const existentes = ['SOL-2026-0005', 'SOL-2026-0005', 'SOL-2026-0005'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0006');
  });

  it('los huecos no se rellenan: importa el maximo, no el primero libre', () => {
    // Decision explicita. Falta la 0002, pero la nueva es la 0010: reutilizar
    // huecos daria referencias fuera de orden cronologico y obligaria a mirar
    // las fechas para entender el fichero.
    const existentes = ['SOL-2026-0001', 'SOL-2026-0003', 'SOL-2026-0009'];

    expect(siguienteReferencia(existentes, 2026)).toBe('SOL-2026-0010');
  });
});

/* ------------------------------------------------------------------ *
 * Los dos limites duros.
 * ------------------------------------------------------------------ */

describe('limites', () => {
  it('lanza cuando el anio ha agotado sus 9999 secuenciales', () => {
    // No hay ninguna cadena que devolver que cumpla el contrato, asi que falla
    // ruidosamente en vez de inventarse SOL-2026-10000.
    expect(() => siguienteReferencia(['SOL-2026-9999'], 2026)).toThrow(RangeError);
    expect(() => siguienteReferencia(['SOL-2026-9999'], 2026)).toThrow(/agotados/);

    // Y el agotamiento es de ese anio, no del generador: 2027 sigue libre.
    expect(siguienteReferencia(['SOL-2026-9999'], 2027)).toBe('SOL-2027-0001');
  });

  it.each([2026.5, -1, 0, 999, 10000, Number.NaN, Number.POSITIVE_INFINITY])(
    'lanza con el anio %s, que no cabe en cuatro digitos',
    (anio) => {
      expect(() => siguienteReferencia([], anio)).toThrow(RangeError);
    },
  );

  it('acepta los anios de cuatro digitos de los extremos', () => {
    expect(siguienteReferencia([], 1000)).toBe('SOL-1000-0001');
    expect(siguienteReferencia([], 9999)).toBe('SOL-9999-0001');
  });

  it('es pura: la misma llamada devuelve siempre lo mismo', () => {
    const existentes = ['SOL-2026-0003', 'SOL-2025-0100'];

    expect(siguienteReferencia(existentes, 2026)).toBe(siguienteReferencia(existentes, 2026));
  });
});
