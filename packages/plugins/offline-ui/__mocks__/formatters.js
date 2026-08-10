/**
 * Mock formatters for plugin-storage tests (metrics.js dependency)
 */
function formatFileSize() {
    return "0 B";
}
function formatDateTime(date) {
    return date ? date.toISOString() : "";
}
export { formatFileSize, formatDateTime };
