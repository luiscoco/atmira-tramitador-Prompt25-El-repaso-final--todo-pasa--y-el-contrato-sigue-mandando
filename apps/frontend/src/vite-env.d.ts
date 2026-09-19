/// <reference types="vite/client" />

// Los tipos ambientales que aporta Vite al codigo del cliente: `import.meta.env`
// y las importaciones que no son JavaScript (`import logo from './logo.svg'`,
// `import estilos from './x.css?inline'`). Sin esta linea, TypeScript no conoce
// ninguna de las dos cosas y las marca como error.
//
// Es un .d.ts: no genera codigo, solo declara. No hay nada que importar de aqui.
