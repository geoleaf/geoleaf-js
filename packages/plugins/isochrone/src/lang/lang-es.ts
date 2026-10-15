/*!
 * @geoleaf-plugins/isochrone — Spanish dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Spanish dictionary for `@geoleaf-plugins/isochrone`.
 *
 * Flat, dotted keys merged into the host's i18n table at registration. It is a data module:
 * no logic lives here, and every key it declares must exist in the sibling dictionaries —
 * a key present in one language only falls back silently, which reads as a translation bug
 * long after the fact. `{name}` placeholders are filled by the window.
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French.
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateEs = {
    "isochrone.toolbar.button": "Isócronas",
    "isochrone.panel.title": "Isócronas",
    "isochrone.panel.close": "Cerrar la ventana",
    "isochrone.panel.collapse": "Plegar la ventana",
    "isochrone.panel.expand": "Desplegar la ventana",
    "isochrone.form.mode": "Modo",
    "isochrone.form.durations": "Duración",
    "isochrone.form.minutes": "{minutes} min",
    "isochrone.form.pick": "Colocar el punto",
    "isochrone.form.myPosition": "Mi posición",
    "isochrone.form.cancel": "Cancelar",
    "isochrone.origin.label": "Punto de partida",
    "isochrone.mode.car": "Coche",
    "isochrone.mode.foot": "A pie",
    "isochrone.mode.bike": "Bicicleta",
    "isochrone.status.computing": "Cálculo en curso…",
    "isochrone.status.locating": "Buscando su posición…",
    "isochrone.status.picking": "Haga clic en el mapa para colocar el punto — Escape para cancelar",
    "isochrone.status.done": "Zonas añadidas: {count}",
    "isochrone.status.cancelled": "Cálculo cancelado",
    "isochrone.status.cleared": "Todas las zonas se han eliminado",
    "isochrone.list.label": "Zonas mostradas",
    "isochrone.list.empty": "Ninguna zona mostrada",
    "isochrone.list.clear": "Eliminar todo",
    "isochrone.list.row": "{minutes} min · {mode}",
    "isochrone.list.color": "Color — {row}",
    "isochrone.list.opacity": "Transparencia — {row}",
    "isochrone.list.hide": "Ocultar — {row}",
    "isochrone.list.up": "Subir — {row}",
    "isochrone.list.down": "Bajar — {row}",
    "isochrone.list.remove": "Eliminar — {row}",
    "isochrone.list.moved": "{row}: posición {rank} de {count}",
    "isochrone.error.timeout": "El motor no respondió a tiempo",
    "isochrone.error.network": "No se puede acceder al motor — red, dirección o clave rechazada",
    "isochrone.error.http": "El motor rechazó la solicitud (estado {status})",
    "isochrone.error.httpCode": "El motor rechazó la solicitud (estado {status}, código {code})",
    "isochrone.error.malformed": "La respuesta del motor es ilegible",
    "isochrone.error.noEngine": "No hay ningún motor de cálculo configurado",
    "isochrone.error.noMap": "No se muestra ningún mapa",
    "isochrone.error.busy": "Ya hay un cálculo en curso",
    "isochrone.error.tooLong": "Duración limitada a {limit} minutos por este motor",
    "isochrone.error.capReached": "Límite de {limit} capas alcanzado",
    "isochrone.error.invalid":
        "La solicitud es ilegible: compruebe el punto, el modo y las duraciones",
    "isochrone.error.noDuration": "Marque al menos una duración",
    "isochrone.error.noPosition":
        "Posición no disponible — GPS denegado, ausente o demasiado lento",
} satisfies Record<string, string>;

export default langTemplateEs;
