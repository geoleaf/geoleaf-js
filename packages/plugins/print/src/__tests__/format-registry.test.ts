/**
 * @geoleaf-plugins/print — what an exporter declares besides its function.
 *
 * A third-party format was saved as `.jpg` and its button read `print.btn.<format>`: the
 * extension and the label are now declared with the exporter.
 */
import { describe, expect, it } from "vitest";
import { getExporterMeta, registerExporter } from "../format-registry.js";

describe("registerExporter — extension and label", () => {
    it("keeps what a third-party exporter declares", () => {
        registerExporter("png", async () => new Blob(), { extension: "png", label: "PNG" });
        expect(getExporterMeta("PNG")).toEqual({ extension: "png", label: "PNG" });
    });

    it("the built-in formats declare their own extension", () => {
        expect(getExporterMeta("pdf")?.extension).toBe("pdf");
        expect(getExporterMeta("jpg")?.extension).toBe("jpg");
    });
});
