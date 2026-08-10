/**
 * `write.properties` ≡ les champs réellement CAPTURÉS — tâche 7.2.
 *
 * Deux listes de noms de champs cohabitent sur une couche éditable :
 *  - `write.properties`, la liste blanche d'EXPÉDITION — ce qui n'y figure pas n'est
 *    jamais envoyé au backend ;
 *  - les entrées de `attributes.fields[]` portant `edit`, la liste de SAISIE — ce que
 *    le formulaire présente.
 *
 * 🛑 Rien ne les réconciliait. Les deux modes d'échec sont silencieux, et opposés :
 *  - un champ saisi mais absent de `write.properties` est rempli par l'utilisateur puis
 *    JETÉ à l'expédition, sans erreur ni trace ;
 *  - une propriété expédiable que rien ne capture est une colonne morte, du genre que
 *    7.1b a retiré par 24.
 *
 * ⚠️ C'est exactement la classe de défaut que `formSchema` entretenait jusqu'à 7.2 : une
 * SECONDE liste de champs, parallèle et jamais confrontée à la première. La supprimer ne
 * suffit pas — encore faut-il que la liste survivante soit opposable à celle qui décide
 * ce qui part sur le réseau. C'est ce que fait cette garde.
 *
 * Les sujets sont LUS SUR LE DISQUE : une couche neuve entre dans le périmètre sans que
 * personne l'inscrive nulle part.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// guards → __tests__ → core → packages → <racine>
const REPO = resolve(__dirname, "../../../..");
const PROFILES = resolve(REPO, "profiles");

/** La forme minimale qu'une config de couche doit avoir pour cette garde. */
interface LayerConfig {
    write?: { properties?: string[] };
    attributes?: { fields?: Array<{ field: string; edit?: unknown }> };
}

/**
 * Toutes les configs de couche du dépôt, tous profils confondus.
 *
 * ⚠️ `schemas/` est écarté : ce n'est pas un profil. Un `readdirSync` non filtré le
 * prendrait pour un profil sans couche et sortirait vert en n'ayant rien lu de plus —
 * inoffensif ici, mais c'est le patron qui rend une gate aveugle ailleurs.
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

/** Le préfixe `properties.` de tête tombe — même règle que l'adaptateur de saisie. */
const strip = (path: string): string =>
    path.startsWith("properties.") ? path.slice("properties.".length) : path;

/** Les noms de champs qu'une couche déclare capturables. */
const capturedFields = (config: LayerConfig): string[] =>
    (config.attributes?.fields ?? []).filter((f) => f.edit).map((f) => strip(f.field));

const ALL = layerConfigs();
const WITH_WRITE = ALL.filter(({ config }) => config.write?.properties);
const WITH_CAPTURE = ALL.filter(({ config }) => capturedFields(config).length > 0);

describe("WRITE-CAPTURE — la liste d'expédition ≡ la liste de saisie", () => {
    it("garde anti-gate-vide : des couches sont bien lues, et certaines capturent", () => {
        // Sans ces trois bornes, un `profiles/` déplacé ou un filtre trop large ferait
        // sortir tout le balayage ci-dessous vert en n'ayant confronté aucune couche.
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
        // Ceinture et bretelles : A14 l'exprime en JSON Schema pur et `validate:profiles`
        // le fait rougir. On le reconstate ici pour que le lien entre les deux règles
        // soit écrit quelque part plutôt que su.
        const captureSansWrite = WITH_CAPTURE.filter(({ config }) => !config.write);
        expect(captureSansWrite.map(({ id }) => id)).toEqual([]);
    });
});
