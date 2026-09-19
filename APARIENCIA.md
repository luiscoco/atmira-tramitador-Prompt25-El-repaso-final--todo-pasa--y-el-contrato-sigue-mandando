# Prompts para mejorar la apariencia del frontend

Dos encargos, en el orden en que conviene lanzarlos. El primero es solo
apariencia y no toca el contrato. El segundo añade un campo nuevo y atraviesa
las cuatro capas del proyecto.

Antes de lanzar cualquiera de los dos, medir la línea de partida:

```powershell
npm test    # debe decir: Test Files 8 passed (8) / Tests 180 passed (180)
```

Ese número es con el que hay que comparar al terminar. Si sale **63**, es el
problema de los enlaces del workspace: ver `EJECUTAR.md`.

---

## Prompt 1 — Apariencia (sin tocar el contrato)

Mejora el aspecto del frontend para que se parezca a una herramienta de
back-office real, sin tocar el contrato ni la lógica.

### Qué hay que conseguir

**Layout de dos columnas.** Hoy la bandeja y el detalle van apilados. Quiero la
tabla a la izquierda (~65%) y el detalle a la derecha, como una tarjeta que se
queda visible mientras se recorre la lista. Por debajo de ~900px, que vuelvan a
apilarse: detalle primero.

**Cabecera.** El `<h1>` actual está solo. Añade debajo una línea descriptiva en
gris pequeño ("Bandeja de solicitudes · los datos viven en memoria y se
restauran al reiniciar el backend") y una regla horizontal que la separe del
contenido.

**Contador de la tabla.** Encima de la tabla, "SOLICITUDES 12" en mayúsculas,
gris, con el número destacado. Hoy el `<caption>` dice solo "Solicitudes":
manténlo como nombre accesible pero dale esa forma visual.

**La tabla.**
- Cabeceras en mayúsculas, gris medio, tamaño pequeño, con `letter-spacing`.
- Filas separadas por una línea de 1px muy suave, sin bordes verticales ni
  zebra.
- La fila seleccionada, con un fondo tenue y una barra de acento de 3px a la
  izquierda. Debe seguir marcada con `aria-current`, que ya está puesto.
- `:hover` sobre la fila, algo más suave que la selección.
- La referencia es un `<button>` dentro de un `<th scope="row">`: déjalo como
  botón, pero que se vea como un enlace (azul, subrayado). No lo conviertas en
  `<a>`: no navega a ninguna parte.

**El detalle, como tarjeta.** Borde de 1px, esquinas redondeadas (~12px), fondo
blanco y padding generoso. El `<h2>` lleva la referencia y, a su derecha, el
chip de estado. Las etiquetas del `<dl>` (TIPO, SOLICITANTE, OPERADOR, CREADA,
ACTUALIZADA) en mayúsculas pequeñas y gris; los valores en negro. Alinéalas en
dos columnas: etiqueta a la izquierda con ancho fijo, valor a la derecha.

**Los botones de acción.** "Aprobar" sólido azul con texto blanco; "Rechazar"
con fondo blanco, borde y texto rojos. Ambos con el mismo alto, radio ~8px y
foco visible. Cuando `ocupado` los deshabilita, que se note (opacidad +
cursor).

### Qué no puedes romper

1. **`npm test` debe seguir en 180 tests verdes.** Los tests consultan por rol y
   nombre accesible. No añadas `data-testid`, no cambies textos visibles, no
   sustituyas el `<button>` de la referencia por otra cosa, y no toques la
   estructura `table > thead/tbody > tr > th[scope=row]`.
2. **`data-estado` se queda.** Es el gancho del CSS y el identificador del
   contrato. No lo cambies por clases con el nombre del estado.
3. **No toques la paleta de los chips.** Los contrastes de `:root` están medidos
   contra WCAG AA y justificados en `21. ESTILOS.md`. Si necesitas colores
   nuevos (grises, azul de acento, bordes), añade tokens nuevos y di qué ratio
   de contraste tiene cada uno contra su fondo.
4. **Sin librerías.** Nada de Tailwind, CSS-in-JS ni componentes de terceros.
   Todo en `apps/frontend/src/estilos.css`, que ya existe.
5. **Convención de acentos del proyecto:** los comentarios van acentuados; lo
   que acabe en una cadena visible o en una consola, en ASCII.
6. **Nada de `openapi.yaml`, `apps/backend` ni `data/`.** Esto es solo
   apariencia.

### Verificación

Antes de darlo por hecho:

```
npm run lint
npm test                               # Test Files 8 passed / Tests 180 passed
npm run build -w @tramitador/frontend
```

Y a ojo, con las dos terminales (`npm run dev` y `npm run dev:frontend`) en
http://localhost:5173: que la fila seleccionada se distinga, que el detalle no
salte de sitio al cambiar de solicitud, que al aprobar cambien fila y detalle a
la vez, y que el foco del teclado sea visible al tabular por las referencias.

Dime qué tokens nuevos has añadido y por qué, y si algo de lo que pido choca
con una decisión ya tomada en `21. ESTILOS.md`.

---

## Prompt 2 — La columna PRIORIDAD (cambio de contrato)

**No lanzar este a la vez que el primero.** Añadir un campo atraviesa las cuatro
capas, y si se empieza por el CSS, `tsc` para en cuanto se tocan los datos
simulados de los tests. El contrato va primero: es el punto del curso.

Añade una prioridad ("alta" | "media" | "baja") a las solicitudes, contrato
primero:

1. `packages/contrato/openapi.yaml`: añade `prioridad` al esquema `Solicitud`,
   como enum requerido. Decide y justifica si va también en la petición de
   creación.
2. `npm run gen` para regenerar `src/tipos.gen.ts`, y `npm run verifica:contrato`
   para confirmar que el fichero generado coincide.
3. `data/solicitudes.json`: rellena las 12 con un reparto que no sea uniforme.
4. Backend: el validador de `repositorio.ts` tiene que rechazar una solicitud
   sin prioridad o con un valor fuera del enum, igual que hace con `estado`.
5. Frontend: columna PRIORIDAD entre SOLICITANTE y ESTADO. "Alta" en negrita;
   "media" y "baja" en peso normal y gris. No uses un chip: competiría
   visualmente con el de estado, que es el que manda.
6. Tests: los datos simulados de `App.test.tsx` y `Bandeja.test.tsx` llevan
   `Solicitud` completas, así que dejarán de compilar. Actualízalos.

Ejecuta `npm run verifica:contrato`, `npm run lint`, `npm test` y
`npm run build -w @tramitador/frontend`, y dime si alguno falla.

### Por qué el orden importa

`Solicitud` declara sus ocho campos como `required` en `openapi.yaml`. En cuanto
`prioridad` entra en el esquema y se regeneran los tipos, **todo objeto literal
de tipo `Solicitud` que no la lleve deja de compilar** — y los tests tienen
varios. Ese error no es un estorbo: es el contrato avisando de todos los sitios
que hay que actualizar, que es justo lo que se pierde si se empieza por el CSS.
