#!/usr/bin/env node
//
// Guardarrail de contrato: comprueba que `src/tipos.gen.ts` es exactamente lo
// que openapi-typescript produce hoy a partir de `openapi.yaml`.
//
// El paquete tiene una regla que ninguna herramienta impone por si sola:
// tipos.gen.ts no se toca a mano y se regenera con `npm run gen`. Es facil
// saltarsela sin querer -- se edita el YAML y se commitea sin regenerar, o al
// reves, se parchea el .gen.ts a mano para arreglar algo rapido. En los dos
// casos el repo queda con un contrato que dice una cosa y unos tipos que dicen
// otra, y nada falla hasta mucho despues.
//
// Lo que hace este script: regenera en un fichero temporal y compara byte a
// byte con el committeado. No interpreta nada -- si un byte baila, falla.
//
// Uso: npm run verifica:contrato   (o `node scripts/verifica.mjs`)
// Salida: 0 si coinciden, 1 si no.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiere = createRequire(import.meta.url);

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ESPECIFICACION = join(RAIZ, 'openapi.yaml');
const COMMITTEADO = join(RAIZ, 'src', 'tipos.gen.ts');

/** Ruta corta para los mensajes, relativa a la raiz del paquete. */
const corta = (ruta) => relative(RAIZ, ruta).split(sep).join('/');

function falla(titulo, ...lineas) {
  console.error(`\n✖ ${titulo}\n`);
  for (const linea of lineas) console.error(`  ${linea}`);
  console.error('');
  process.exit(1);
}

/**
 * Ruta al fichero JS del CLI de openapi-typescript.
 *
 * Se resuelve el package.json del paquete y se lee su campo `bin`, en vez de
 * pedir directamente `openapi-typescript/bin/cli.js`: ese subpath pasa por el
 * mapa de `exports`, que tiene una regla `"./*.js" -> "./*.mjs"` y acaba
 * apuntando a un cli.mjs que no existe.
 */
function rutaDelCli() {
  const manifiesto = requiere.resolve('openapi-typescript/package.json');
  const { bin } = requiere(manifiesto);
  const entrada = typeof bin === 'string' ? bin : bin?.['openapi-typescript'];

  if (!entrada) {
    falla(
      'openapi-typescript no declara un ejecutable.',
      'Instala las dependencias del paquete:',
      '',
      '  npm install',
    );
  }

  return resolve(dirname(manifiesto), entrada);
}

/**
 * Regenera los tipos en `destino` con el mismo node que corre este script.
 *
 * Se evita a proposito el shim de node_modules/.bin: en Windows es un .cmd que
 * obliga a hacer spawn con shell, y con shell hay que empezar a preocuparse
 * por como se escapan las rutas (y aqui la raiz del proyecto tiene espacios y
 * parentesis).
 */
function regenera(destino) {
  const cli = rutaDelCli();

  const resultado = spawnSync(
    process.execPath,
    [cli, ESPECIFICACION, '-o', destino],
    { cwd: RAIZ, encoding: 'utf8' },
  );

  if (resultado.error) {
    falla(
      'No se ha podido ejecutar openapi-typescript.',
      String(resultado.error.message),
    );
  }

  if (resultado.status !== 0) {
    falla(
      `openapi-typescript ha fallado (codigo ${resultado.status}).`,
      'Probablemente openapi.yaml no es valido. Salida de la herramienta:',
      '',
      ...`${resultado.stderr}${resultado.stdout}`.trimEnd().split('\n'),
    );
  }
}

/**
 * Primera diferencia entre los dos ficheros, en forma de numero de linea y las
 * dos lineas enfrentadas. Decir solo "no coinciden" obliga a quien lo lee a ir
 * a buscar el que; esto le deja el sitio senalado.
 */
function primeraDiferencia(esperado, real) {
  const lineasEsperadas = esperado.split('\n');
  const lineasReales = real.split('\n');
  const total = Math.max(lineasEsperadas.length, lineasReales.length);

  for (let i = 0; i < total; i += 1) {
    if (lineasEsperadas[i] !== lineasReales[i]) {
      return {
        linea: i + 1,
        esperada: lineasEsperadas[i],
        real: lineasReales[i],
      };
    }
  }

  // Mismo texto linea a linea pero bytes distintos: BOM, CRLF o similar.
  return null;
}

/** Muestra una linea en el informe, marcando su ausencia si no existe. */
const muestra = (linea) =>
  linea === undefined ? '(la linea no existe)' : JSON.stringify(linea);

function main() {
  let committeado;
  try {
    committeado = readFileSync(COMMITTEADO);
  } catch {
    falla(
      `Falta ${corta(COMMITTEADO)}.`,
      'Los tipos generados se committean; no son un artefacto de build.',
      'Genera el fichero y anadelo al repositorio:',
      '',
      '  npm run gen -w @tramitador/contrato',
    );
  }

  const temporal = mkdtempSync(join(tmpdir(), 'verifica-contrato-'));

  try {
    const destino = join(temporal, 'tipos.gen.ts');
    regenera(destino);
    const reciengenerado = readFileSync(destino);

    if (committeado.equals(reciengenerado)) {
      console.log(
        `✔ ${corta(COMMITTEADO)} coincide con lo que genera ${corta(ESPECIFICACION)}.`,
      );
      return;
    }

    const diferencia = primeraDiferencia(
      reciengenerado.toString('utf8'),
      committeado.toString('utf8'),
    );

    const detalle = diferencia
      ? [
          `Primera diferencia en la linea ${diferencia.linea}:`,
          '',
          `  esperado (regenerado)  ${muestra(diferencia.esperada)}`,
          `  encontrado (en el repo) ${muestra(diferencia.real)}`,
        ]
      : [
          'Las lineas son iguales pero los bytes no: revisa finales de linea',
          '(CRLF frente a LF) o un BOM al principio del fichero.',
        ];

    falla(
      `${corta(COMMITTEADO)} no coincide con ${corta(ESPECIFICACION)}.`,
      'El contrato y los tipos generados se han desincronizado. Alguien ha',
      'tocado el YAML sin regenerar, o ha editado a mano el .gen.ts.',
      '',
      ...detalle,
      '',
      `Tamanos: regenerado ${reciengenerado.length} bytes, en el repo ${committeado.length} bytes.`,
      '',
      'Para arreglarlo, regenera y committea el resultado:',
      '',
      '  npm run gen -w @tramitador/contrato',
      '',
      'Si el cambio del YAML anade o quita valores de un enum, revisa tambien',
      'las constantes ESTADOS / ACCIONES de src/index.ts.',
    );
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}

main();
