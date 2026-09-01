/*!
 * @geoleaf/field-renderer — built-in labels (pt)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The library's `form.*` labels, in pt.
 *
 * ⚠️ **Derived from `editor`'s catalogues, not rewritten** — these
 * translations were already in production and at parity across the six
 * locales. Rewriting them would have introduced silent variants where the
 * work aims for the opposite.
 */
const lang_pt: Record<string, string> = {
    "form.aria.badgeColor": "Cor do emblema",
    "form.aria.coordsCapture": "Capturar a posição a partir do mapa",
    "form.aria.coordsCaptureUnavailable": "Capturar a posição a partir do mapa (indisponível)",
    "form.aria.coordsCopy": "Copiar as coordenadas",
    "form.aria.imageRemove": "Remover a imagem",
    "form.aria.latitude": "Latitude",
    "form.aria.listRemove": "Remover o elemento",
    "form.aria.longitude": "Longitude",
    "form.aria.reviewRemove": "Remover a avaliação",
    "form.aria.tableRowRemove": "Remover a linha",
    "form.error.date": "Data inválida (formato AAAA-MM-DD esperado).",
    "form.error.email": "Endereço de e-mail inválido.",
    "form.error.fetchFailed": "Não foi possível carregar as opções.",
    "form.error.imageCanvas": "Compressão indisponível neste dispositivo",
    "form.error.imageCompress": "A compressão da imagem falhou",
    "form.error.imageDecode": "Imagem ilegível ou danificada",
    "form.error.imageRead": "Não foi possível ler o ficheiro",
    "form.error.imageSize": "O ficheiro de imagem é demasiado grande.",
    "form.error.imageType": "Tipo de ficheiro de imagem não suportado.",
    "form.error.max": "Valor demasiado alto.",
    "form.error.maxLength": "Texto demasiado longo.",
    "form.error.min": "Valor demasiado baixo.",
    "form.error.minItems": "Número de elementos insuficiente.",
    "form.error.minLength": "Texto demasiado curto.",
    "form.error.pattern": "Formato inválido.",
    "form.error.phoneE164": "Número de telefone inválido.",
    "form.error.required": "Este campo é obrigatório.",
    "form.error.tel": "Número de telefone inválido.",
    "form.error.timeFormat": "Formato de hora inválido (esperado HH:MM).",
    "form.error.uploadFailed": "Falha ao enviar a imagem.",
    "form.error.url": "URL inválido. Protocolos aceites: http, https, mailto, tel.",
    "form.label.add": "Adicionar",
    "form.label.cancel": "Cancelar",
    "form.label.capture": "Capturar",
    "form.label.imageDropzone": "Clique ou arraste uma imagem aqui",
    "form.label.linkLabel": "Rótulo (opcional)",
    "form.label.reviewAdd": "Adicionar uma avaliação",
    "form.label.tableAddRow": "Adicionar uma linha",
    "form.placeholder.lat": "Lat",
    "form.placeholder.lng": "Lon",
    "form.placeholder.reviewAuthor": "Autor",
    "form.placeholder.reviewComment": "Comentário",
    "form.title.captureUnavailable":
        "A captura a partir do mapa não está disponível neste contexto",
};

export default lang_pt;
