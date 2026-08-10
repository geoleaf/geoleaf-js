/**
 * Knip reporter — surfaces `configurationHints` on **stderr**.
 *
 * Why this file exists: the `json` reporter does not emit configuration hints at all
 * (`node_modules/knip/dist/reporters/json.js` writes only `{files, issues}`), and the
 * dead-code gate runs knip with `--reporter json`. Every hint knip produced was
 * therefore discarded before anyone could read it — the gate went green while
 * `knip.js` accumulated entries that match nothing.
 *
 * That is not hypothetical. Structure T2 declared `@geoleaf/app` with
 * `entry: ["init.js", ...]`, knip immediately answered "redundant entry pattern", and
 * the gate reported success without a word. Six hints had already piled up the same
 * way — three `ignore: ["**\/__tests__/**"]` matching nothing, a redundant `jscpd`
 * exemption, two redundant lib entries.
 *
 * Knip runs every `--reporter` passed to it, so this one rides along with `json`:
 * the JSON stays alone on stdout (the gate parses it verbatim), the hints go to
 * stderr, which `check-dead-code.cjs` echoes and counts.
 *
 * Output contract — one line per hint, prefixed `knip-hint`, consumed by
 * `check-dead-code.cjs`. Keep the prefix stable: the gate counts on it.
 */

/** @param {import("knip").ReporterOptions} data */
export default ({ configurationHints, isDisableConfigHints }) => {
    if (isDisableConfigHints) return;

    const hints = [...(configurationHints ?? [])];
    if (hints.length === 0) return;

    const lines = hints
        .map(({ type, identifier, workspaceName, filePath }) => {
            const where = workspaceName ? ` [${workspaceName}]` : "";
            const source = filePath ? ` (${filePath})` : "";
            return `knip-hint  ${type}  ${String(identifier)}${where}${source}`;
        })
        .sort();

    process.stderr.write(`${lines.join("\n")}\n`);
};
