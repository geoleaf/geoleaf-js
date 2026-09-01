/**
 * `write.properties` ≡ the fields really CAPTURED.
 *
 * Two field-name lists cohabit on an editable layer:
 *  - `write.properties`, the SHIPPING whitelist — what is not in it is never
 *    sent to the backend;
 *  - the `attributes.fields[]` entries carrying `edit`, the INPUT list —
 *    what the form presents.
 *
 * 🛑 Nothing reconciled them. Both failure modes are silent, and opposite:
 *  - a field captured but absent from `write.properties` is filled by the
 *    user then DISCARDED at shipping, with no error and no trace;
 *  - a shippable property nothing captures is a dead column, of the kind an
 *    earlier sweep removed two dozen of.
 *
 * ⚠️ Exactly the defect class `formSchema` maintained until then: a SECOND
 * field list, parallel and never confronted with the first. Deleting it is
 * not enough — the surviving list must still be enforceable against the one
 * deciding what goes on the network. That is what this guard does.
 *
 * The subjects are READ FROM DISK: a new layer enters the perimeter without
 * anyone enrolling it anywhere.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// guards → __tests__ → core → packages → <racine>
const REPO = resolve(__dirname, "../../../..");
const PROFILES = resolve(REPO, "profiles");

/** The minimal shape a layer config must have for this guard. */
interface LayerConfig {
    write?: { properties?: string[] };
    attributes?: { fields?: Array<{ field: string; edit?: unknown }> };
}

/**
 * Every layer config in the repo, all profiles together.
 *
 * ⚠️ `schemas/` is set aside: it is not a profile. An unfiltered
 * `readdirSync` would take it for a layerless profile and come out green
 * having read nothing more — harmless here, but the pattern that blinds a
 * gate elsewhere.
 */
function layerConfigs(): Array<{ id: string; config: LayerConfig }> {
    const out: Array<{ id: string; config: LayerConfig }> = [];
    for (const profile of readdirSync(PROFILES, { withFileTypes: true })) {
        if (!profile.isDirectory() || profile.name === "schemas") continue;
        const layersDir = join(PROFILES, profile.name, "layers");
        if (!existsSync(layersDir)) continue;
        for (const layer of readdirSync(layersDir, { withFileTypes: true })) {
            if (!layer.isDirectory()) continue;
            const file = join(layersDir, layer.name, `${layer.name}_config.json`);
            if (!existsSync(file)) continue;
            out.push({
                id: `${profile.name}/${layer.name}`,
                config: JSON.parse(readFileSync(file, "utf8")) as LayerConfig,
            });
        }
    }
    return out;
}

/** The leading `properties.` prefix drops — same rule as the input adapter. */
const strip = (path: string): string =>
    path.startsWith("properties.") ? path.slice("properties.".length) : path;

/** The field names a layer declares capturable. */
const capturedFields = (config: LayerConfig): string[] =>
    (config.attributes?.fields ?? []).filter((f) => f.edit).map((f) => strip(f.field));

const ALL = layerConfigs();
const WITH_WRITE = ALL.filter(({ config }) => config.write?.properties);
const WITH_CAPTURE = ALL.filter(({ config }) => capturedFields(config).length > 0);

describe("WRITE-CAPTURE — la liste d'expédition ≡ la liste de saisie", () => {
    it("garde anti-gate-vide : des couches sont bien lues, et certaines capturent", () => {
        // Without these three bounds, a moved `profiles/` or a too-wide
        // filter would let the whole sweep below come out green having
        // confronted no layer.
        expect(ALL.length, "aucune config de couche lue — le périmètre est cassé").toBeGreaterThan(
            10
        );
        expect(WITH_CAPTURE.length, "aucune couche capturable").toBeGreaterThan(0);
        expect(WITH_WRITE.length, "aucune couche avec write.properties").toBeGreaterThan(0);
    });

    it.each(WITH_WRITE.map(({ id, config }) => [id, config] as const))(
        "%s — aucun champ saisi n'est jeté à l'expédition",
        (_id: string, config: LayerConfig) => {
            const shipped = config.write?.properties ?? [];
            const orphans = capturedFields(config).filter((f) => !shipped.includes(f));
            expect(
                orphans,
                `Champ(s) capturé(s) par le formulaire et ABSENT(s) de write.properties : ` +
                    `l'utilisateur les remplit, puis ils sont jetés en silence à l'envoi.`
            ).toEqual([]);
        }
    );

    it.each(WITH_WRITE.map(({ id, config }) => [id, config] as const))(
        "%s — aucune propriété expédiable n'est orpheline de saisie",
        (_id: string, config: LayerConfig) => {
            const captured = capturedFields(config);
            const dead = (config.write?.properties ?? []).filter((p) => !captured.includes(p));
            expect(
                dead,
                `Propriété(s) déclarée(s) expédiable(s) que RIEN ne capture — une liste ` +
                    `blanche qui autorise ce que le formulaire ne produit pas.`
            ).toEqual([]);
        }
    );

    it("une couche qui capture sans déclarer où écrire est déjà refusée par A14", () => {
        // Belt and braces: the schema rule expresses it in pure JSON Schema
        // and `validate:profiles` turns it red. It is re-observed here so the
        // link between the two rules is written somewhere rather than known.
        const captureSansWrite = WITH_CAPTURE.filter(({ config }) => !config.write);
        expect(captureSansWrite.map(({ id }) => id)).toEqual([]);
    });
});
