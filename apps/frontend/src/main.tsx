// El arranque del cliente: coge el <div id="root"> del index.html y monta React
// dentro. Es el equivalente de `servidor.ts` en el backend —el unico fichero
// con efectos sobre el mundo exterior— y por eso no exporta nada: se ejecuta.
//
// Todo lo que sea pintar o pedir datos vive en componentes; aqui solo esta el
// enganche con el DOM.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
// La hoja de estilos, importada UNA vez y desde el punto de entrada.
//
// No se importa desde `EstadoChip.tsx` —que es quien usa sus clases— a
// proposito: un `import './estilos.css'` dentro de un componente lo ata a una
// hoja global y obliga a cualquier test que lo renderice a saber que hacer con
// un fichero .css. Aqui, en cambio, es lo mismo que el <link> que habria en el
// index.html si no hubiera empaquetador: se carga con la aplicacion y punto.
//
// Vite la extrae a un .css con hash en `vite build`; en `dev` la inyecta y la
// recarga en caliente sin repintar React.
import './estilos.css';

// `getElementById` devuelve `HTMLElement | null`, y con `strict` activado eso no
// se le puede pasar a `createRoot` sin comprobarlo. La comprobacion no es un
// tramite para callar al compilador: si alguien renombra el id en index.html,
// este `throw` lo dice en la consola del navegador en la primera linea, en vez
// de dejar una pagina en blanco sin explicacion.
const contenedor = document.getElementById('root');

if (contenedor === null) {
  throw new Error("No existe el elemento #root en index.html: React no tiene donde montar.");
}

// `StrictMode` no llega al build de produccion. En desarrollo hace una cosa que
// sorprende la primera vez: monta cada componente, lo desmonta y lo vuelve a
// montar, de forma que un `useEffect` corre DOS veces. No es un fallo, es el
// detector: un efecto que no limpia lo que abre (una peticion, un temporizador,
// una suscripcion) se rompe visiblemente aqui en vez de gotear en produccion.
createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
