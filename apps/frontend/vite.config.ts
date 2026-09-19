// Configuracion del servidor de desarrollo y del empaquetado del frontend.
//
// Este fichero contesta a una sola pregunta: que pasa cuando el navegador pide
// algo mientras se trabaja. La respuesta corta es que TODO lo pide al 5173 —la
// aplicacion y la API—, y que Vite reenvia al backend lo que empiece por /api.
// Por que eso es mejor que apuntar al 3001 directamente esta explicado abajo,
// en el bloque del proxy.
//
// Nota sobre los acentos, misma regla que en el backend: los comentarios van
// acentuados; lo que acabe en una cadena que el navegador o una consola puedan
// imprimir, en ASCII.

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/* ------------------------------------------------------------------ *
 * Las dos direcciones del desarrollo.
 * ------------------------------------------------------------------ */

/**
 * El puerto del servidor de desarrollo.
 *
 * No es un numero cualquiera: `apps/backend/src/app.ts` lista
 * `http://localhost:5173` y `http://127.0.0.1:5173` como los unicos origenes a
 * los que responde con cabeceras CORS. Cambiar este numero sin cambiar aquella
 * lista deja una de las dos formas de llamar a la API rota.
 */
const PUERTO = 5173;

/**
 * El backend, escrito igual que en `apps/backend/src/servidor.ts`.
 *
 * `127.0.0.1` y no `localhost` por el mismo motivo que alli: `localhost` puede
 * resolver a `::1` (IPv6) o a `127.0.0.1` segun la maquina, y el backend escucha
 * SOLO en la IPv4. Un proxy apuntado a `http://localhost:3001` falla con
 * ECONNREFUSED en cuanto el sistema decide resolver por IPv6 —el clasico "el
 * servidor esta arrancado pero el proxy no conecta"—.
 */
const BACKEND = 'http://127.0.0.1:3001';

/* ------------------------------------------------------------------ *
 * La configuracion.
 * ------------------------------------------------------------------ */

export default defineConfig({
  // El plugin oficial de React. Hace dos cosas que se notan al minuto:
  // transforma el JSX (con el runtime automatico, que es lo que declara
  // `"jsx": "react-jsx"` en tsconfig.json, y por eso ningun fichero necesita
  // `import React`), y engancha Fast Refresh, que sustituye un componente al
  // guardar sin recargar la pagina ni perder el estado de los `useState`.
  plugins: [react()],

  server: {
    port: PUERTO,

    // Si el 5173 esta ocupado, fallar en vez de saltar al 5174.
    //
    // Por defecto Vite busca el siguiente puerto libre y lo anuncia en la
    // terminal. Aqui eso seria el peor de los fallos: el servidor arranca, la
    // aplicacion carga, y cada llamada a la API muere con un error de CORS
    // porque el backend no conoce el 5174. Mejor un arranque que no ocurre y
    // dice por que, que una aplicacion a medias.
    strictPort: true,

    /* -------------------------------------------------------------- *
     * El proxy: por que el cliente puede escribir fetch('/api/...').
     * -------------------------------------------------------------- *
     *
     * Sin proxy hay dos servidores y dos origenes: la aplicacion se descarga
     * de `http://localhost:5173` y la API vive en `http://127.0.0.1:3001`.
     * Para el navegador eso son sitios distintos —basta con que difiera el
     * puerto—, asi que toda llamada seria "cross-origin": el cliente tendria
     * que escribir la URL absoluta del backend (de ahi salen las
     * `VITE_API_URL` que hay que definir, documentar y cambiar por entorno) y
     * el backend tendria que dar permiso con cabeceras CORS, preflight
     * `OPTIONS` incluido.
     *
     * Con el proxy solo hay UN origen para el navegador. `fetch('/api/salud')`
     * resuelve contra la pagina actual, o sea `http://localhost:5173/api/salud`,
     * y esa peticion se la come el servidor de Vite. Lo que ocurre despues es
     * una peticion HTTP normal de servidor a servidor, hecha por Node, fuera
     * del navegador: alli no hay politica de mismo origen que aplicar, porque
     * esa politica es una regla del navegador, no del protocolo.
     *
     * De ahi los dos efectos que se buscaban:
     *
     *   - Sin CORS: el navegador nunca ve una peticion a otro origen, asi que
     *     no hay nada que autorizar. (Las cabeceras de `app.ts` siguen puestas
     *     y siguen sirviendo para quien llame al 3001 a pelo.)
     *
     *   - Sin variables de entorno: la URL que escribe el cliente es relativa,
     *     y una ruta relativa vale igual en desarrollo (donde la atiende este
     *     proxy) que en produccion (donde la atiende el servidor que sirva
     *     dist/ bajo el mismo dominio). No hay nada que configurar porque no
     *     hay ningun host escrito en el codigo del cliente.
     *
     * La clave: '/api' es un PREFIJO de ruta, no una ruta exacta. Cubre las
     * siete operaciones del contrato (/api/salud, /api/tipos, /api/operadores,
     * /api/solicitudes...) de una vez.
     * -------------------------------------------------------------- */
    proxy: {
      '/api': {
        target: BACKEND,

        // Sin `rewrite`. Esta es la parte que mas se equivoca: aqui NO se
        // quita el prefijo. El backend registra sus rutas con `/api` incluido
        // (`app.get('/api/salud', ...)`, porque openapi.yaml declara
        // `servers: [{ url: /api }]`), asi que `/api/salud` debe llegar al
        // 3001 tal cual. Un `rewrite` que borrara el prefijo convertiria todas
        // las llamadas en 404 del backend.

        // `changeOrigin` reescribe la cabecera `Host` de la peticion reenviada
        // para que diga `127.0.0.1:3001` en vez de `localhost:5173`. Fastify no
        // enruta por `Host` —no hay virtual hosts aqui—, asi que hoy da igual;
        // se deja puesto porque es lo que espera cualquier backend que si mire
        // esa cabecera (o que redirija usandola), y porque el dia que el target
        // deje de ser loopback es lo que evita que el otro extremo rechace la
        // peticion por un Host que no reconoce.
        changeOrigin: true,

        // WebSocket apagado a proposito. El backend no tiene ninguno, y el
        // servidor de Vite si usa un WebSocket propio (el de HMR): dejar `ws`
        // encendido en una ruta que no lo necesita solo abre la puerta a que
        // un upgrade acabe en el sitio equivocado.
        ws: false,
      },
    },
  },
});
