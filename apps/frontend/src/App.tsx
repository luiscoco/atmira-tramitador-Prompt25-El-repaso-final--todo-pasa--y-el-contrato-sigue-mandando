// El componente raiz: el unico sitio de la aplicacion donde vive el estado.
//
// A partir de aqui aparecen `<Bandeja>` y `<Detalle>`, pero ninguno de los dos
// va a guardar nada suyo: reciben lo que necesitan por props y avisan hacia
// arriba. Toda la verdad —las tres listas, que solicitud se esta mirando, si
// hay una peticion en vuelo, que ha fallado— esta en este fichero, y esa es la
// decision de diseno que explica todo lo demas.
//
// Nota sobre los acentos, misma regla que en el backend y en `api/cliente.ts`:
// los comentarios van acentuados; lo que acabe en pantalla, no.

import type { Accion, Operador, Solicitud, Tipo } from '@tramitador/contrato';
import { useCallback, useEffect, useState } from 'react';

import {
  ErrorDeApi,
  listarOperadores,
  listarSolicitudes,
  listarTipos,
  transicionarSolicitud,
} from './api/cliente';
import { Bandeja } from './componentes/Bandeja';
import { Detalle } from './componentes/Detalle';

/**
 * La cabecera de la pagina.
 *
 * Sale de `App` porque la pintan sus DOS salidas —la de carga y la normal—
 * y antes estaban escribiendo el `<h1>` cada una por su cuenta. El `<h1>` se
 * queda exactamente igual: es el nombre accesible de la pagina.
 *
 * El texto va en ASCII, como todo lo que acaba en pantalla, salvo el punto
 * medio de separacion, que es tipografia y no una letra acentuada.
 */
function Cabecera() {
  return (
    <header className="cabecera">
      <h1>Tramitador</h1>
      <p className="cabecera__descripcion">
        Bandeja de solicitudes · los datos viven en memoria y se restauran al
        reiniciar el backend
      </p>
    </header>
  );
}

export function App() {
  /* ---------------------------------------------------------------- *
   * Los datos que vienen de la API.
   * ---------------------------------------------------------------- */

  // Tres listas separadas y no un unico objeto `{ solicitudes, tipos,
  // operadores }`: solo una de las tres cambia cuando se crea o se transiciona
  // una solicitud, y teniendolas sueltas se reemplaza esa sin tocar las otras
  // dos. `readonly` porque lo que devuelve el cliente no se modifica en sitio;
  // cuando cambia, se sustituye entera.
  const [solicitudes, setSolicitudes] = useState<readonly Solicitud[]>([]);
  const [tipos, setTipos] = useState<readonly Tipo[]>([]);
  const [operadores, setOperadores] = useState<readonly Operador[]>([]);

  /* ---------------------------------------------------------------- *
   * La seleccion: un id, no una solicitud.
   * ---------------------------------------------------------------- */

  // `string | null` y NO `Solicitud | null`. La explicacion larga esta abajo,
  // donde se deriva `solicitudSeleccionada`; en una frase: guardar el objeto
  // seria guardar una FOTO de la solicitud, y esa foto envejece en cuanto la
  // API devuelve una version nueva.
  const [seleccionada, setSeleccionada] = useState<string | null>(null);

  /* ---------------------------------------------------------------- *
   * Los dos "estoy trabajando", que no son el mismo.
   * ---------------------------------------------------------------- */

  // `cargando` es la carga inicial: empieza en `true` porque en el primer
  // render todavia no se ha pedido nada, y pasa a `false` para no volver. Es lo
  // que decide si se pinta la aplicacion o el cartel de "Cargando".
  const [cargando, setCargando] = useState(true);

  // `ocupado` es una peticion que MODIFICA algo (crear, transicionar) mientras
  // la aplicacion ya esta pintada. Va y viene muchas veces, y sirve para otra
  // cosa: deshabilitar los botones para que no se envie dos veces la misma
  // accion. Mezclar los dos en un unico booleano obligaria a elegir entre
  // borrar la pantalla en cada clic o no poder bloquear nada.
  const [ocupado, setOcupado] = useState(false);

  // El ultimo error que se ha ensenado, ya en texto. Se guarda la cadena y no
  // el `ErrorDeApi` porque lo unico que hace la vista con el es escribirlo; el
  // dia que haga falta distinguir un 409 de un 404 para pintarlos distinto, se
  // cambia el tipo aqui.
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------------------------------------------- *
   * La carga.
   * ---------------------------------------------------------------- */

  /**
   * Pide las tres listas y las mete en el estado.
   *
   * `Promise.all` y no tres `await` seguidos: las tres peticiones son
   * independientes —ninguna necesita el resultado de otra— asi que salen a la
   * vez y la funcion tarda lo que tarde la mas lenta, no la suma de las tres.
   * En serie serian tres viajes de ida y vuelta encadenados.
   *
   * La contrapartida de `all` es que es todo o nada: si una falla, se rechaza
   * el conjunto y no se escribe ninguna lista. Es lo que se quiere aqui. Las
   * tres salen del mismo backend: si `tipos` no contesta, `solicitudes` tampoco
   * va a ser fiable, y media pantalla pintada con la otra media vacia se
   * entiende peor que un error claro.
   *
   * Es `useCallback` porque el `useEffect` de abajo la usa y la va a listar
   * entre sus dependencias; sin memorizar, la funcion seria nueva en cada
   * render y el efecto volveria a dispararse sin parar.
   */
  const cargar = useCallback(async () => {
    // Lo primero, limpiar el error anterior: si este intento sale bien, el
    // mensaje del intento fallido no puede quedarse en pantalla.
    setError(null);

    try {
      const [nuevasSolicitudes, nuevosTipos, nuevosOperadores] =
        await Promise.all([
          listarSolicitudes(),
          listarTipos(),
          listarOperadores(),
        ]);

      setSolicitudes(nuevasSolicitudes);
      setTipos(nuevosTipos);
      setOperadores(nuevosOperadores);
    } catch (fallo: unknown) {
      // `ErrorDeApi` hereda de `Error`, asi que este `instanceof` cubre tanto el
      // 404 del backend como el fallo de red que lanza `fetch`.
      setError(
        fallo instanceof Error
          ? fallo.message
          : 'No se ha podido contactar con la API.',
      );
    } finally {
      // En `finally` y no al final del `try`: si la carga falla, la pantalla
      // tiene que dejar de decir "Cargando" igualmente para poder ensenar el
      // error. Con el `setCargando(false)` dentro del `try`, un fallo dejaria
      // el cartel puesto para siempre.
      setCargando(false);
    }
  }, []);

  // Al montar, y solo al montar. `cargar` esta memorizada con `[]`, asi que la
  // lista de dependencias es estable y el efecto corre una vez.
  //
  // StrictMode lo ejecuta dos veces en desarrollo (ver main.tsx) y aqui no se
  // aborta nada: las tres peticiones son GET sin efectos, y la segunda tanda
  // escribe encima de la primera exactamente los mismos datos.
  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Vuelve a pedirlo todo a peticion del usuario.
   *
   * Marca `ocupado` en vez de `cargando` a proposito: recargar no debe vaciar
   * la pantalla, solo bloquear los botones mientras dura. Es exactamente la
   * forma que van a tener los manejadores de crear y de transicionar.
   */
  const recargar = useCallback(async () => {
    setOcupado(true);

    try {
      await cargar();
    } finally {
      setOcupado(false);
    }
  }, [cargar]);

  /* ---------------------------------------------------------------- *
   * La transicion.
   * ---------------------------------------------------------------- */

  /**
   * Manda una accion sobre la solicitud seleccionada y mete en el estado la
   * version que devuelve el backend.
   *
   * No recibe el id: lo lee de `seleccionada`. Es lo mismo que hace
   * `<Detalle>` al mandar solo la accion —quien sabe sobre que solicitud se
   * esta actuando es este componente, porque es el que la eligio—.
   *
   * La guarda del `null` es defensa en profundidad: sin seleccion no se pinta
   * ninguna ficha y por tanto no hay boton que pulsar, pero esta funcion es
   * publica hacia abajo y no puede dar por hecho quien la llama ni cuando. Sin
   * ella, TypeScript tampoco dejaria pasar el `string | null` a una API que
   * pide `string`.
   *
   * `ocupado` y no `cargando`, por lo mismo que en `recargar`: la ficha y la
   * bandeja se siguen viendo, solo que con los botones bloqueados mientras el
   * `POST` esta en vuelo. Y `setError(null)` ANTES de salir, no despues de
   * volver: si el intento anterior dejo un 409 en pantalla, ese mensaje no
   * puede seguir ahi mientras se reintenta.
   */
  const aplicarAccion = useCallback(
    async (accion: Accion) => {
      if (seleccionada === null) {
        return;
      }

      setOcupado(true);
      setError(null);

      try {
        const actualizada = await transicionarSolicitud(seleccionada, accion);

        // Se sustituye SOLO el elemento que ha cambiado; no se vuelve a pedir
        // la lista. El backend ya ha devuelto la solicitud entera y al dia, asi
        // que un `GET /solicitudes` detras solo serviria para volver a traer
        // exactamente eso mas otras cincuenta filas que no han cambiado.
        //
        // La forma funcional de `setSolicitudes` —`(anteriores) => ...`— y no
        // `solicitudes.map(...)` a secas: `solicitudes` es el valor capturado
        // en el render que creo este callback, y entre el clic y la respuesta
        // del servidor ha podido cambiar (otra transicion, una recarga). Con la
        // forma funcional se parte siempre de la lista vigente.
        //
        // `.map()` y no un `splice` sobre el array: el estado de React se
        // sustituye, no se modifica en sitio. `map` crea un array nuevo —lo que
        // hace que React vea el cambio y repinte— pero conserva por referencia
        // los objetos de las filas que no se han tocado, asi que un
        // `React.memo` sobre cada fila de la bandeja seguiria evitando su
        // repintado. Por eso las tres listas estan declaradas `readonly`.
        //
        // El filtro es `actualizada.id` y no `seleccionada`: son el mismo valor
        // —el backend devuelve la solicitud que se le pidio— y usar el de la
        // respuesta deja claro que lo que entra y lo que sale casan.
        setSolicitudes((anteriores) =>
          anteriores.map((solicitud) =>
            solicitud.id === actualizada.id ? actualizada : solicitud,
          ),
        );
      } catch (fallo: unknown) {
        if (fallo instanceof ErrorDeApi) {
          // `detalle` primero porque es el mensaje util: en el 409 de una
          // transicion ilegal, `message` dice algo generico y `detalle` dice
          // desde que estado se intentaba. `??` y no `||` para no descartar
          // una cadena vacia por ser falsy —que tampoco deberia llegar, pero
          // el operador correcto aqui es el que solo mira `undefined`—.
          setError(fallo.detalle ?? fallo.message);
        } else {
          // Cualquier otra cosa: un fallo de red, un `json()` roto, un error de
          // programacion. No se ensena `fallo.message` porque aqui no se sabe
          // que hay dentro —podria ser un texto interno sin sentido para quien
          // lo lee— y el `catch` recibe `unknown`, no `Error`.
          setError('No se ha podido completar la accion. Intentalo de nuevo.');
        }
      } finally {
        // En `finally`: los botones tienen que volver a habilitarse tanto si la
        // transicion ha ido bien como si ha fallado. Dentro del `try` dejaria
        // la ficha bloqueada para siempre en cuanto hubiese un 409, que es
        // justo el caso en el que el usuario quiere probar otra accion.
        setOcupado(false);
      }
    },
    // `seleccionada` es un `string | null`, asi que el callback solo se recrea
    // cuando de verdad cambia la solicitud elegida.
    [seleccionada],
  );

  /* ---------------------------------------------------------------- *
   * Estado DERIVADO: la solicitud seleccionada.
   * ---------------------------------------------------------------- */

  // Esto NO es un `useState`, y es la decision mas importante del fichero.
  //
  // La alternativa —`const [solicitudSeleccionada, setSolicitudSeleccionada] =
  // useState<Solicitud | null>(null)`— parece mas comoda y crea un problema que
  // no se ve hasta la primera transicion:
  //
  //   1. El usuario pulsa "aprobar". `transicionarSolicitud` devuelve la
  //      solicitud ya actualizada y se refresca la lista.
  //   2. `solicitudes` pasa a tener la version nueva (estado `aprobada`).
  //   3. `solicitudSeleccionada` sigue guardando el objeto de antes, con
  //      `estado: 'enviada'`, porque nadie lo ha vuelto a asignar.
  //
  // Y ahi esta el fallo: la lista de la izquierda dice "aprobada" y el detalle
  // de la derecha dice "enviada". Dos copias del mismo dato que pueden
  // discrepar. La cura no es acordarse de llamar tambien a
  // `setSolicitudSeleccionada` en cada sitio que modifique algo —eso es una
  // obligacion que hay que recordar en cada linea nueva, y se olvida—, sino
  // que la segunda copia no exista.
  //
  // Guardando solo el `id`, `solicitudes` es la unica fuente de verdad y el
  // objeto se vuelve a buscar en cada render. Lo que eso simplifica, en
  // concreto:
  //
  //   - Despues de una transicion basta con actualizar `solicitudes`. El
  //     detalle se repinta solo, porque lee de ahi. Cero sincronizacion.
  //   - Si la solicitud desaparece de la lista (un filtro por estado, una
  //     recarga que ya no la trae), `find` devuelve `undefined` y el detalle se
  //     vacia solo, en vez de quedarse ensenando algo que ya no esta.
  //   - El `id` es justo lo que hace falta para llamar a la API
  //     (`transicionarSolicitud(id, ...)`), asi que no se pierde nada.
  //   - Es serializable tal cual: cabe en la URL, en `sessionStorage` o en un
  //     `key` sin tener que decidir que parte del objeto se guarda.
  //
  // El coste es un `find` lineal por render sobre una lista de decenas de
  // elementos. No es un problema; y si algun dia lo fuese, se envuelve en un
  // `useMemo` sin cambiar nada de lo de arriba.
  const solicitudSeleccionada =
    solicitudes.find((solicitud) => solicitud.id === seleccionada) ?? null;

  /* ---------------------------------------------------------------- *
   * La vista.
   * ---------------------------------------------------------------- */

  // La carga inicial es una salida temprana: mientras no haya datos no hay nada
  // que ensenar, y asi el resto del componente puede dar por hecho que las tres
  // listas ya se han pedido.
  if (cargando) {
    return (
      <main className="pagina">
        <Cabecera />
        <p>Cargando…</p>
      </main>
    );
  }

  return (
    <main className="pagina">
      <Cabecera />

      {/*
        `role="alert"` para que un lector de pantalla lo anuncie en cuanto
        aparece: el error suele ser la respuesta a algo que acaba de pulsar el
        usuario, y sale lejos de donde tiene el foco.

        Va fuera del `if (cargando)` y no sustituye al contenido: un fallo al
        recargar no tiene por que borrar los datos que ya estaban.
      */}
      {error !== null && (
        <p role="alert" className="aviso">
          {error}
        </p>
      )}

      <p className="barra-acciones">
        <button
          type="button"
          className="boton"
          onClick={() => void recargar()}
          disabled={ocupado}
        >
          Recargar
        </button>
      </p>

      {/*
        Recibe la lista y el id seleccionado, y devuelve por `onSeleccionar` el
        id pulsado. No guarda nada: quien decide que hay seleccionado es este
        componente, y por eso `setSeleccionada` se pasa tal cual —el setter de
        `useState` ya tiene exactamente la firma `(id: string) => void` que
        pide la prop, y envolverlo en una lambda solo anadiria una funcion
        nueva en cada render—.

        Sus filas NO se deshabilitan con `ocupado`, a diferencia de los botones
        de `<Detalle>`: cambiar de solicitud mientras una transicion esta en
        vuelo no manda nada al servidor, solo mira otra ficha. Lo que `ocupado`
        evita es el doble `POST`, y eso pasa en el detalle.
      */}
      {/*
        Las dos columnas. Es un `<div>` de presentacion y nada mas: no lleva
        `role` ni nombre accesible, porque no es una region —lo que ya tiene
        nombre es la tabla, por su `<caption>`, y el detalle, por su
        `aria-labelledby`—. Anadirle uno solo meteria un nivel de mas en el
        arbol que lee el lector de pantalla.

        El orden del DOM es bandeja y luego detalle. En movil se invierte solo
        el visual, con `order` en CSS, para que la ficha de lo que acabas de
        pulsar no quede debajo de doce filas.
      */}
      <div className="disposicion">
        <Bandeja
          solicitudes={solicitudes}
          tipos={tipos}
          seleccionada={seleccionada}
          onSeleccionar={setSeleccionada}
        />

      {/*
        `solicitud` es el estado derivado: se recalcula en cada render a partir
        de `solicitudes`, asi que cuando `aplicarAccion` sustituye el elemento
        de la lista, la ficha se repinta sola. No hay nada que sincronizar.

        `onAccion` recibe una funcion `async` donde la prop pide `void`. Es
        deliberado y lo unico que significa es que `<Detalle>` no espera a la
        promesa; de esperar, del error y del `ocupado` se encarga aqui
        `aplicarAccion`. La `void` de la llamada dentro de `<Detalle>` es
        exactamente eso, puesto por escrito.
      */}
        <Detalle
          solicitud={solicitudSeleccionada}
          tipos={tipos}
          operadores={operadores}
          ocupado={ocupado}
          onAccion={(accion) => void aplicarAccion(accion)}
        />
      </div>
    </main>
  );
}
