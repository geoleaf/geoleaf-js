/*!
 * @geoleaf-plugins/print — PT dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langPrintPt = {
    "print.toolbar.button": "Imprimir / Exportar",
    "print.emprise.hint": "Clique e arraste para definir a área de impressão",
    "print.emprise.hint.adjust": "Ajuste as alças e clique em OK",
    "print.modal.title": "Impressão / Exportação",
    "print.modal.field.title": "Título",
    "print.modal.field.description": "Descrição",
    "print.modal.check.legend": "Legenda",
    "print.modal.check.scale": "Barra de escala",
    "print.modal.check.northArrow": "Seta norte",
    "print.modal.check.annotations": "Anotações",
    "print.modal.format": "Formato de papel",
    "print.modal.scaleLocked": "Escala bloqueada",
    "print.modal.redefineExtent": "Redefinir extensão",
    "print.btn.pdf": "PDF",
    "print.btn.jpg": "JPG",
    "print.btn.export": "Exportar",
    "print.btn.cancel": "Cancelar",
    "print.btn.ok": "OK",
    "print.error.tainted":
        "Não é possível exportar: uma fonte de tiles não suporta CORS. Configure um endpoint de servidor ou utilize fontes compatíveis com CORS.",
    "print.error.render": "Erro ao renderizar o mapa.",
    "print.error.noMap": "Nenhum mapa disponível.",
    "print.error.serverEndpoint": "O URL do servidor de renderização é inválido.",
    "print.error.serverFailed": "O servidor de renderização retornou um erro.",
    "print.spinner.rendering": "A renderizar…",
    "print.orientation.portrait": "Retrato",
    "print.orientation.landscape": "Paisagem",
    "print.aria.scaleLocked": "Escala bloqueada em",
    "print.aria.toolbar.print": "Imprimir / Exportar o mapa",
} satisfies Record<string, string>;

export default langPrintPt;
