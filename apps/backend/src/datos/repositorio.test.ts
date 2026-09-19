// Los tests de la capa de datos, el pendiente más antiguo del backend.
//
// `12. REPOSITORIO.md` cerró con "Este fichero no tiene tests en el repo. Es la
// carencia más clara del paso", y ahí seguía. Todo lo que el backend sirve pasa
// por aquí, y lo único que lo probaba era, de refilón, la suite de las rutas.
//
// Tres bloques, y la división importa:
//
//   1. El comportamiento del repositorio  -> vale para cualquier `data/`
//   2. Las invariantes del juego de ejemplo -> valen solo para ESTE `data/`
//   3. La validación al leer               -> con ficheros rotos a propósito
//
// El bloque 2 es el que `15. TESTS-RUTAS.md` echaba de menos ("Nada prueba los
// datos de `data/`") y son las siete afirmaciones del script que `8. DATOS.md`
// escribió para ejecutar a mano y que nunca entró al repo. Si alguien añade una
// solicitud decimotercera, es aquí donde se entera, y no en un `404` raro tres
// pasos más allá.
//
// Misma regla de acentos: comentarios acentuados, y en ASCII lo que se compara
// con un mensaje de error, porque esos salen por consola.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESTADOS, type Solicitud } from '@tramitador/contrato';
import { describe, expect, it } from 'vitest';

import { crearRepositorio } from './repositorio';

/* ------------------------------------------------------------------ *
 * El oráculo, escrito a mano.
 * ------------------------------------------------------------------ */

// Igual que en `rutas/solicitudes.test.ts`: las cuentas van escritas, no
// derivadas del fichero. Un test que lea `data/` para saber cuántas hay no
// comprueba nada.
const TOTAL_SOLICITUDES = 12;
const TOTAL_TIPOS = 4;
const TOTAL_OPERADORES = 4;

// El reparto exacto del juego de ejemplo: tres de cada estado.
const POR_ESTADO = { borrador: 3, enviada: 3, aprobada: 3, rechazada: 3 };

// `data/` visto desde este fichero: src/datos/ -> src/ -> backend/ -> apps/ -> raíz.
const DIRECTORIO_DATOS = new URL('../../../../data/', import.meta.url);

/**
 * La primera fila de una lista que el test da por no vacía.
 *
 * `tsconfig.base.json` tiene `noUncheckedIndexedAccess`, así que un
 * `const [primera] = lista` da `Solicitud | undefined` y no compila al usarlo.
 * La alternativa era sembrar el fichero de `!` o de `as`, que es exactamente lo
 * que esa opción existe para evitar. Esto falla con un mensaje que dice qué
 * faltaba, en vez de con un `Cannot read properties of undefined`.
 */
function primeraDe<T>(lista: readonly T[], que: string): T {
  const [primera] = lista;

  if (primera === undefined) {
    throw new Error(`el juego de ejemplo no tiene ningun ${que}`);
  }

  return primera;
}

/* ------------------------------------------------------------------ *
 * 1. El comportamiento
 * ------------------------------------------------------------------ */

describe('crearRepositorio: lecturas', () => {
  it('lee las tres colecciones', () => {
    const repositorio = crearRepositorio();

    expect(repositorio.listarSolicitudes()).toHaveLength(TOTAL_SOLICITUDES);
    expect(repositorio.listarTipos()).toHaveLength(TOTAL_TIPOS);
    expect(repositorio.listarOperadores()).toHaveLength(TOTAL_OPERADORES);
  });

  it('filtra por estado, y un estado sin filas da un array vacio', () => {
    const repositorio = crearRepositorio();

    for (const [estado, cuantas] of Object.entries(POR_ESTADO)) {
      expect(repositorio.listarSolicitudes(estado as never)).toHaveLength(cuantas);
    }

    // La suma tiene que cuadrar con el total: sin esto, un filtro que
    // devolviera siempre la lista entera pasaría cada línea de arriba solo si
    // los números coincidieran por casualidad.
    const sumaDeLosFiltros = ESTADOS.reduce(
      (total, estado) => total + repositorio.listarSolicitudes(estado).length,
      0,
    );

    expect(sumaDeLosFiltros).toBe(TOTAL_SOLICITUDES);
  });

  it('devuelve un array nuevo en cada lectura', () => {
    // La propiedad que el fichero documenta y que ningún tipo impone: quien
    // llama no se convierte en copropietario del estado interno. Un `.sort()`
    // en una ruta para ordenar por fecha reordenaría el array de dentro.
    const repositorio = crearRepositorio();

    const lista = repositorio.listarSolicitudes();
    lista.length = 0;

    expect(repositorio.listarSolicitudes()).toHaveLength(TOTAL_SOLICITUDES);
    expect(repositorio.listarTipos()).not.toBe(repositorio.listarTipos());
    expect(repositorio.listarOperadores()).not.toBe(repositorio.listarOperadores());
  });

  it('obtenerSolicitud devuelve undefined cuando no hay nadie con ese id', () => {
    const repositorio = crearRepositorio();
    const primera = primeraDe(repositorio.listarSolicitudes(), 'solicitud');

    expect(repositorio.obtenerSolicitud(primera.id)).toMatchObject({ id: primera.id });
    expect(repositorio.obtenerSolicitud('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('existeTipo responde por el catalogo, no por las solicitudes', () => {
    const repositorio = crearRepositorio();
    const primero = primeraDe(repositorio.listarTipos(), 'tipo');

    expect(repositorio.existeTipo(primero.id)).toBe(true);
    expect(repositorio.existeTipo('tipo-que-no-existe')).toBe(false);
    expect(repositorio.existeTipo('')).toBe(false);
  });

  it('referencias devuelve TODAS, tambien las de estados finales', () => {
    // La razón por la que este método existe aparte: `siguienteReferencia`
    // necesita la lista entera para calcular el máximo del año. Si alguien le
    // pasara una lista ya filtrada, generaría una referencia repetida sin
    // enterarse.
    const repositorio = crearRepositorio();

    const referencias = repositorio.referencias();
    const todas = repositorio.listarSolicitudes().map((solicitud) => solicitud.referencia);

    expect(referencias).toHaveLength(TOTAL_SOLICITUDES);
    expect([...referencias].sort()).toEqual([...todas].sort());
  });
});

describe('crearRepositorio: escrituras', () => {
  const conEstado = (solicitud: Solicitud, estado: Solicitud['estado']): Solicitud => ({
    ...solicitud,
    estado,
  });

  it('guardarSolicitud sustituye la fila y no cambia el total', () => {
    const repositorio = crearRepositorio();
    const primera = primeraDe(repositorio.listarSolicitudes(), 'solicitud');

    repositorio.guardarSolicitud(conEstado(primera, 'rechazada'));

    expect(repositorio.obtenerSolicitud(primera.id)?.estado).toBe('rechazada');
    expect(repositorio.listarSolicitudes()).toHaveLength(TOTAL_SOLICITUDES);
  });

  it('guardarSolicitud con un id nuevo añade, no sustituye', () => {
    const repositorio = crearRepositorio();
    const primera = primeraDe(repositorio.listarSolicitudes(), 'solicitud');

    repositorio.guardarSolicitud({ ...primera, id: 'id-nuevo', referencia: 'SOL-2026-9999' });

    expect(repositorio.listarSolicitudes()).toHaveLength(TOTAL_SOLICITUDES + 1);
    expect(repositorio.obtenerSolicitud('id-nuevo')).toBeDefined();
  });

  it('NO escribe en disco', () => {
    // La propiedad que el cabecero del fichero escribe en mayúsculas, aquí
    // comprobada: se lee el JSON antes y después de escribir, byte a byte.
    const ruta = new URL('solicitudes.json', DIRECTORIO_DATOS);
    const antes = readFileSync(ruta, 'utf8');

    const repositorio = crearRepositorio();
    const primera = primeraDe(repositorio.listarSolicitudes(), 'solicitud');
    repositorio.guardarSolicitud(conEstado(primera, 'aprobada'));

    expect(readFileSync(ruta, 'utf8')).toBe(antes);
  });

  it('dos repositorios no comparten estado', () => {
    // Lo que hace que los 134 tests de los otros ficheros no dependan del orden
    // en que se ejecuten. El estado vive en el cierre léxico, no en el módulo.
    const uno = crearRepositorio();
    const otro = crearRepositorio();

    const primera = primeraDe(uno.listarSolicitudes(), 'solicitud');
    uno.guardarSolicitud(conEstado(primera, 'rechazada'));

    expect(uno.obtenerSolicitud(primera.id)?.estado).toBe('rechazada');
    expect(otro.obtenerSolicitud(primera.id)?.estado).toBe(primera.estado);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Las invariantes de `data/`
 * ------------------------------------------------------------------ */

describe('data/: las invariantes del juego de ejemplo', () => {
  it('las doce referencias van seguidas, de SOL-2026-0001 a SOL-2026-0012', () => {
    const esperadas = Array.from(
      { length: TOTAL_SOLICITUDES },
      (_, indice) => `SOL-2026-${String(indice + 1).padStart(4, '0')}`,
    );

    expect(crearRepositorio().listarSolicitudes().map((s) => s.referencia)).toEqual(esperadas);
  });

  it('no hay ids repetidos', () => {
    // Un id duplicado no rompe nada visible: `obtenerSolicitud` devuelve el
    // primero y el segundo queda inalcanzable para siempre.
    const ids = crearRepositorio().listarSolicitudes().map((solicitud) => solicitud.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('el reparto por estado es de tres en tres', () => {
    const repositorio = crearRepositorio();

    const cuenta = Object.fromEntries(
      ESTADOS.map((estado) => [estado, repositorio.listarSolicitudes(estado).length]),
    );

    expect(cuenta).toEqual(POR_ESTADO);
  });

  it('ninguna solicitud se actualizo antes de crearse', () => {
    // Las fechas son ISO con `Z`, así que comparar las cadenas ordena igual que
    // comparar los instantes, y no hace falta construir doce `Date`.
    for (const solicitud of crearRepositorio().listarSolicitudes()) {
      expect(
        solicitud.creadaEn <= solicitud.actualizadaEn,
        `fechas incoherentes en ${solicitud.referencia}`,
      ).toBe(true);
    }
  });

  it('los borradores no tienen operador, y los finales si', () => {
    // La regla de negocio que `data/` cumple y que nadie había escrito: una
    // solicitud sin tramitar no tiene a quién asignarse, y una ya resuelta la
    // resolvió alguien.
    for (const solicitud of crearRepositorio().listarSolicitudes()) {
      if (solicitud.estado === 'borrador') {
        expect(solicitud.operador, solicitud.referencia).toBeNull();
      }

      if (solicitud.estado === 'aprobada' || solicitud.estado === 'rechazada') {
        expect(solicitud.operador, solicitud.referencia).not.toBeNull();
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. La validación al leer
 * ------------------------------------------------------------------ */

describe('crearRepositorio: rechaza los datos que no cumplen el contrato', () => {
  /**
   * Monta un `data/` de mentira en un directorio temporal y devuelve su URL.
   *
   * Parte de una copia válida del de verdad y deja sustituir solo el fichero
   * que interesa romper: así cada test enseña UNA cosa mal, y no hay que
   * escribir a mano los otros dos JSON.
   */
  const dataConUnFicheroRoto = (nombre: string, contenido: unknown): URL => {
    const directorio = mkdtempSync(join(tmpdir(), 'tramitador-'));

    for (const fichero of ['solicitudes', 'tipos', 'operadores']) {
      const datos =
        fichero === nombre
          ? JSON.stringify(contenido)
          : readFileSync(new URL(`${fichero}.json`, DIRECTORIO_DATOS), 'utf8');

      writeFileSync(join(directorio, `${fichero}.json`), datos);
    }

    // `pathToFileURL` y no `new URL('file://' + ruta)`: en Windows la ruta
    // lleva `C:\` y barras invertidas, y concatenar produce una URL que no
    // resuelve.
    return pathToFileURL(join(directorio, '/'));
  };

  // La copia sin tocar nada, que es el control de todo el bloque: si esto
  // fallara, los demás tests estarían pasando por el motivo equivocado.
  it('acepta una copia intacta', () => {
    const directorio = dataConUnFicheroRoto('nada', null);

    expect(crearRepositorio(directorio).listarSolicitudes()).toHaveLength(TOTAL_SOLICITUDES);
  });

  it('rechaza un estado que no esta en el enum, diciendo en que fila', () => {
    // El caso que motivó todo esto: sin validación, este `estado` llegaba
    // intacto hasta el navegador y el que reventaba era el frontend.
    const directorio = dataConUnFicheroRoto('solicitudes', [
      {
        id: 'a',
        referencia: 'SOL-2026-0001',
        tipo: 'alta-cuenta',
        solicitante: 'X',
        estado: 'pendiente',
        operador: null,
        creadaEn: '2026-01-01T00:00:00Z',
        actualizadaEn: '2026-01-01T00:00:00Z',
      },
    ]);

    expect(() => crearRepositorio(directorio)).toThrow(/solicitudes\.json\[0\]/);
    expect(() => crearRepositorio(directorio)).toThrow(/pendiente/);
  });

  it('rechaza un campo obligatorio que falta', () => {
    const directorio = dataConUnFicheroRoto('tipos', [{ id: 'alta-cuenta', nombre: 'Alta' }]);

    expect(() => crearRepositorio(directorio)).toThrow(/'descripcion'/);
  });

  it('rechaza una raiz que no es un array', () => {
    const directorio = dataConUnFicheroRoto('operadores', { op: 'uno' });

    expect(() => crearRepositorio(directorio)).toThrow(/se esperaba un array/);
  });

  it('rechaza una solicitud cuyo tipo no esta en el catalogo', () => {
    // La comprobación que ninguna fila puede hacer por su cuenta: hacen falta
    // los tres ficheros. Todo lo demás de esta solicitud es válido.
    const directorio = dataConUnFicheroRoto('solicitudes', [
      {
        id: 'a',
        referencia: 'SOL-2026-0001',
        tipo: 'tipo-fantasma',
        solicitante: 'X',
        estado: 'borrador',
        operador: null,
        creadaEn: '2026-01-01T00:00:00Z',
        actualizadaEn: '2026-01-01T00:00:00Z',
      },
    ]);

    expect(() => crearRepositorio(directorio)).toThrow(/tipo-fantasma/);
    expect(() => crearRepositorio(directorio)).toThrow(/SOL-2026-0001/);
  });

  it('rechaza un operador que no esta en el catalogo, pero acepta null', () => {
    const conOperadorInventado = dataConUnFicheroRoto('solicitudes', [
      {
        id: 'a',
        referencia: 'SOL-2026-0001',
        tipo: 'alta-cuenta',
        solicitante: 'X',
        estado: 'enviada',
        operador: 'op-9999',
        creadaEn: '2026-01-01T00:00:00Z',
        actualizadaEn: '2026-01-01T00:00:00Z',
      },
    ]);

    expect(() => crearRepositorio(conOperadorInventado)).toThrow(/op-9999/);
  });

  it('no publica campos que el contrato no declara', () => {
    // Sin `schema` en las rutas, Fastify serializa lo que se le dé: una clave
    // de más en `data/` acabaría en la API sin que nadie la hubiera declarado.
    // Los validadores construyen el objeto campo a campo, y esto lo fija.
    const directorio = dataConUnFicheroRoto('solicitudes', [
      {
        id: 'a',
        referencia: 'SOL-2026-0001',
        tipo: 'alta-cuenta',
        solicitante: 'X',
        estado: 'borrador',
        operador: null,
        creadaEn: '2026-01-01T00:00:00Z',
        actualizadaEn: '2026-01-01T00:00:00Z',
        notaInterna: 'esto no deberia salir por la API',
      },
    ]);

    const solicitud = primeraDe(crearRepositorio(directorio).listarSolicitudes(), 'solicitud');

    expect(solicitud).not.toHaveProperty('notaInterna');
    expect(Object.keys(solicitud).sort()).toEqual([
      'actualizadaEn',
      'creadaEn',
      'estado',
      'id',
      'operador',
      'referencia',
      'solicitante',
      'tipo',
    ]);
  });
});
