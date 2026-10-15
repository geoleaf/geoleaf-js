/*!
 * @geoleaf-plugins/isochrone — Portuguese dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Portuguese dictionary for `@geoleaf-plugins/isochrone`.
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
const langTemplatePt = {
    "isochrone.toolbar.button": "Isócronas",
    "isochrone.panel.title": "Isócronas",
    "isochrone.panel.close": "Fechar a janela",
    "isochrone.panel.collapse": "Recolher a janela",
    "isochrone.panel.expand": "Expandir a janela",
    "isochrone.form.mode": "Modo",
    "isochrone.form.durations": "Duração",
    "isochrone.form.minutes": "{minutes} min",
    "isochrone.form.pick": "Colocar o ponto",
    "isochrone.form.myPosition": "A minha posição",
    "isochrone.form.cancel": "Cancelar",
    "isochrone.origin.label": "Ponto de partida",
    "isochrone.mode.car": "Carro",
    "isochrone.mode.foot": "A pé",
    "isochrone.mode.bike": "Bicicleta",
    "isochrone.status.computing": "Cálculo em curso…",
    "isochrone.status.locating": "A procurar a sua posição…",
    "isochrone.status.picking": "Clique no mapa para colocar o ponto — Escape para cancelar",
    "isochrone.status.done": "Zonas adicionadas: {count}",
    "isochrone.status.cancelled": "Cálculo cancelado",
    "isochrone.status.cleared": "Todas as zonas foram removidas",
    "isochrone.list.label": "Zonas apresentadas",
    "isochrone.list.empty": "Nenhuma zona apresentada",
    "isochrone.list.clear": "Remover tudo",
    "isochrone.list.row": "{minutes} min · {mode}",
    "isochrone.list.color": "Cor — {row}",
    "isochrone.list.opacity": "Transparência — {row}",
    "isochrone.list.hide": "Ocultar — {row}",
    "isochrone.list.up": "Subir — {row}",
    "isochrone.list.down": "Descer — {row}",
    "isochrone.list.remove": "Remover — {row}",
    "isochrone.list.moved": "{row}: posição {rank} de {count}",
    "isochrone.error.timeout": "O motor não respondeu a tempo",
    "isochrone.error.network": "O motor está inacessível — rede, endereço ou chave recusada",
    "isochrone.error.http": "O motor recusou o pedido (estado {status})",
    "isochrone.error.httpCode": "O motor recusou o pedido (estado {status}, código {code})",
    "isochrone.error.malformed": "A resposta do motor é ilegível",
    "isochrone.error.noEngine": "Nenhum motor de cálculo está configurado",
    "isochrone.error.noMap": "Nenhum mapa é apresentado",
    "isochrone.error.busy": "Já está um cálculo em curso",
    "isochrone.error.tooLong": "Duração limitada a {limit} minutos por este motor",
    "isochrone.error.capReached": "Limite de {limit} camadas atingido",
    "isochrone.error.invalid": "O pedido é ilegível: verifique o ponto, o modo e as durações",
    "isochrone.error.noDuration": "Marque pelo menos uma duração",
    "isochrone.error.noPosition": "Posição indisponível — GPS recusado, ausente ou demasiado lento",
} satisfies Record<string, string>;

export default langTemplatePt;
