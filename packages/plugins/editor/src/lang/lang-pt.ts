/*!
 * @geoleaf-plugins/editor — Portuguese dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_pt: Record<string, string> = {
    // Toolbar
    "editor.toolbar.button": "Edição",

    // Sub-menu group labels
    "editor.menu.tools": "Ferramentas de desenho",
    "editor.menu.history": "Histórico",
    "editor.menu.actions": "Ações",

    // Tool labels & hints
    "editor.tool.point.label": "Ponto",
    "editor.tool.point.hint": "Clique no mapa para colocar um ponto.",
    "editor.tool.line.label": "Linha",
    "editor.tool.line.hint": "Clique para colocar 2 pontos. Enter ou duplo clique para terminar.",
    "editor.tool.polyline.label": "Polilinha",
    "editor.tool.polyline.hint":
        "Clique para colocar vértices. Duplo clique ou Enter para terminar.",
    "editor.tool.polygon.label": "Polígono",
    "editor.tool.polygon.hint":
        "Clique para colocar vértices. Encaixe no primeiro vértice, duplo clique ou Enter para fechar.",
    "editor.tool.select.label": "Seleção",
    "editor.tool.select.hint":
        "Clique numa entidade editável para a selecionar e editar os seus vértices.",
    "editor.tool.undo.label": "Anular",
    "editor.tool.undo.hint": "Anular a última ação (Ctrl+Z)",
    "editor.tool.redo.label": "Refazer",
    "editor.tool.redo.hint": "Refazer a última ação anulada (Ctrl+Shift+Z)",
    "editor.tool.delete.label": "Eliminar",
    "editor.tool.delete.hint": "Eliminar a entidade selecionada (Del)",

    // History — dynamic undo/redo tooltips ({op} = operation label below)
    "editor.history.undoOf": "Anular: {op}",
    "editor.history.redoOf": "Refazer: {op}",
    "editor.history.op.create": "criação",
    "editor.history.op.move": "deslocação",
    "editor.history.op.vertex-add": "adição de vértice",
    "editor.history.op.vertex-del": "eliminação de vértice",
    "editor.history.op.delete": "eliminação",

    // Modal
    "editor.modal.title.create": "Criar uma entidade",
    "editor.modal.title.edit": "Editar a entidade",
    "editor.modal.layer.dropdown": "Camada de destino",
    "editor.modal.layer.placeholder": "Selecionar uma camada…",
    "editor.modal.layer.noLayer": "(Nenhuma camada disponível)",
    "editor.modal.btn.save": "Guardar",
    "editor.modal.btn.cancel": "Cancelar",
    "editor.modal.btn.delete": "Eliminar",
    "editor.modal.btn.deleteConfirm": "Eliminar definitivamente",
    "editor.modal.delete.title": "Confirmação de eliminação",
    "editor.modal.delete.body": "Esta ação é irreversível. Deseja eliminar esta entidade?",
    "editor.modal.cancel.confirmDirty":
        "Tem a certeza de que deseja descartar os dados introduzidos?",
    "editor.modal.cancel.discardBtn": "Descartar",

    // Form validation
    "editor.form.required": "Este campo é obrigatório.",
    "editor.form.invalidUrl": "URL inválido. Protocolos aceites: http, https, mailto, tel.",
    "editor.form.invalidPhone": "Número de telefone inválido.",
    "editor.form.outOfRange": "O valor deve estar compreendido entre {min} e {max}.",
    "editor.form.maxLengthExceeded": "Máximo de {max} caracteres permitidos.",

    // Persistence toasts
    "editor.toast.saved": "Entidade guardada.",
    "editor.toast.deleted": "Entidade eliminada.",

    // Sync / offline
    "editor.sync.queued": "Alteração colocada em fila de espera offline.",
    "editor.sync.flushed": "Alterações sincronizadas com sucesso.",
    "editor.sync.conflict.title": "Conflito de dados",
    "editor.sync.conflict.body":
        "Esta entidade foi modificada noutro local desde a sua última leitura. O que deseja manter?",
    "editor.sync.conflict.btn.keepLocal": "Manter as minhas alterações",
    "editor.sync.conflict.btn.keepServer": "Manter a versão do servidor",
    "editor.sync.conflict.btn.merge": "Combinar manualmente",
    "editor.sync.conflict.merge.title": "Combinação manual dos campos",
    "editor.sync.conflict.merge.useLocal": "Local",
    "editor.sync.conflict.merge.useServer": "Servidor",
    "editor.sync.conflict.merge.apply": "Aplicar a combinação",
    "editor.sync.pending": "{n} alteração(ões) pendente(s) de sincronização",
    "editor.sync.kind.save": "Criação",
    "editor.sync.kind.update": "Modificação",
    "editor.sync.kind.delete": "Eliminação",
    "editor.sync.detail.title": "Operações pendentes",
    "editor.sync.detail.empty": "Nenhuma operação pendente.",
    "editor.sync.detail.retry": "Tentar novamente agora",
    "editor.sync.detail.close": "Fechar",

    // Errors
    "editor.error.networkTimeout": "Tempo limite de rede excedido.",
    "editor.error.editionNotPermitted": "Esta camada não permite esta operação.",
    "editor.error.operationNotSupported":
        "O servidor não suporta esta operação. Contacte o administrador.",
    "editor.error.server": "Erro do servidor. Tente novamente.",
    "editor.error.storageUnavailable":
        "Armazenamento offline indisponível. Alteração não guardada.",
    "editor.error.permissionDenied": "Permissão recusada.",
    "editor.error.conflict": "Conflito de versão detetado.",
    "editor.error.minVertices": "Número mínimo de vértices atingido.",

    // Aria / accessibility
    "editor.aria.closeMenu": "Fechar o menu de edição",
    "editor.aria.closeModal": "Fechar o formulário",
    "editor.aria.dragMenu": "Mover o menu de edição",

    // Form validator errors (keys returned by field-renderer/validators.ts)
    // Field-renderer runtime errors (image upload, hours, dropdown fetch)

    // Field-renderer secondary labels

    // Accessibility
    "editor.placement.prompt": "Toque no mapa para colocar o ponto",
    "editor.placement.existingDetected": "Entidade existente detetada:",
    "editor.placement.markerNew": "Novo ponto (arraste para ajustar)",
    "editor.placement.markerExisting": "Ponto existente (arraste para ajustar)",
    "editor.toolbar.poi_add": "Adicionar POI",
    "editor.addform.unavailable": "O editor não está pronto — tente novamente daqui a pouco.",
    "editor.export.session": "Exportar esta sessão",
    "editor.export.empty": "Nenhuma entidade criada nesta sessão.",
    "editor.export.done": "{count} entidade(s) exportada(s).",
};

export default lang_pt;
