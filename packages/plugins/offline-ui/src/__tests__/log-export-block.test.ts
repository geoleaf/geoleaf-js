/**
 * « EXPORT THE LOG », FROM THE CACHE MODAL.
 *
 * 🛑 Once the application had started, its journal was reachable through a console only: the
 * one control that offered it was the boot failure screen. The person who sees a defect in
 * the field has no console.
 *
 * ⚠️ What is held here: the file is WHAT THE CORE EXPORTS, untouched, and the button says so
 * when the core has nothing to export instead of doing nothing.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import { buildLogExportBlock } from "../cache/log-export-block.js";

let notif: any;
let body: HTMLElement;
let downloads: Array<{ name: string; blob: Blob }>;

function installGeoLeaf(log: unknown) {
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    (globalThis as any).GeoLeaf = { Log: log, _UINotifications: notif };
}

function build(): HTMLButtonElement {
    body = document.createElement("div");
    document.body.appendChild(body);
    buildLogExportBlock(body);
    return body.querySelector(".gl-cache-log-export__btn") as HTMLButtonElement;
}

beforeEach(() => {
    downloads = [];
    let pending: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
        pending = blob as Blob;
        return "blob:log";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // The click on the temporary link is the download: it is read where it happens.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement
    ) {
        if (pending) downloads.push({ name: this.download, blob: pending });
    });
});

afterEach(() => {
    body?.remove();
    delete (globalThis as any).GeoLeaf;
    vi.restoreAllMocks();
});

describe("exporter le journal", () => {
    test("🛑 le fichier est ce que le core exporte, tel quel", async () => {
        const report = JSON.stringify({ format: "geoleaf-log", formatVersion: 1, entries: [1] });
        const exportDiagnostic = vi.fn(() => report);
        installGeoLeaf({ exportDiagnostic });

        build().click();

        expect(exportDiagnostic).toHaveBeenCalledTimes(1);
        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.name).toMatch(/^geoleaf-log-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/);
        expect(downloads[0]?.blob.type).toBe("application/json");
        expect(await downloads[0]?.blob.text()).toBe(report);
        expect(notif.success).toHaveBeenCalledTimes(1);
    });

    test("le journal est lu AU CLIC : un core monté après la fenêtre est servi", () => {
        installGeoLeaf(undefined);
        const button = build();
        const exportDiagnostic = vi.fn(() => "{}");
        (globalThis as any).GeoLeaf.Log = { exportDiagnostic };

        button.click();

        expect(exportDiagnostic).toHaveBeenCalledTimes(1);
        expect(downloads).toHaveLength(1);
    });

    test("🛑 un core sans journal exportable → c'est dit, rien n'est téléchargé", () => {
        installGeoLeaf({ info: () => {} });

        build().click();

        expect(downloads).toHaveLength(0);
        expect(notif.warning).toHaveBeenCalledTimes(1);
        expect(notif.success).not.toHaveBeenCalled();
    });

    test("un export qui jette est une erreur dite, pas un succès", () => {
        installGeoLeaf({
            exportDiagnostic: () => {
                throw new Error("circular");
            },
        });

        build().click();

        expect(downloads).toHaveLength(0);
        expect(notif.error).toHaveBeenCalledTimes(1);
        expect(notif.success).not.toHaveBeenCalled();
    });

    test("l'URL d'objet est rendue après le clic", async () => {
        installGeoLeaf({ exportDiagnostic: () => "{}" });
        build().click();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:log");
    });
});
