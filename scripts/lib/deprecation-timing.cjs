/**
 * WHEN may an announced removal land? — the timing half of a deprecation announcement (CC-10).
 *
 * ## Why this lib exists
 *
 * `verify-consumer-contract.cjs` judges each entry of the deprecation register on four fields.
 * Two of them, `since` and `removeIn`, carry a rule about TIME: an announcement must be made in
 * a published version before the one that removes the symbol, or it announces nothing. That
 * rule is the part of the versioning policy most likely to move — it did, when the policy stated
 * that no new MAJOR line is planned — so it lives here, where its guard test can exercise it
 * without a consumption manifest, a register and a source tree to build around it.
 *
 * ## What it judges, and what it cannot
 *
 * It judges the SHAPE and ORDER of the two versions against the core version under preparation.
 * It cannot judge whether the announcing version was PUBLISHED, nor whether the pre-adoption
 * window of the policy is still open: both are facts about the registry and about downstream
 * consumers, which this repository reads nowhere. The policy page carries those two halves.
 */
"use strict";

/**
 * Parses an `x.y.z` version.
 *
 * @param {unknown} v - The candidate.
 * @returns {number[] | null} The three numbers, or `null` when the shape is not `x.y.z`.
 */
function parse(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ""));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Compares two parsed versions.
 *
 * @param {number[]} a - A parsed version.
 * @param {number[]} b - A parsed version.
 * @returns {number} `< 0`, `0` or `> 0`.
 */
function cmp(a, b) {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Judges the timing of one announcement.
 *
 * @param {{ since?: unknown, removeIn?: unknown }} announcement - The register entry.
 * @param {string} current - The core version under preparation, `x.y.z`.
 * @returns {string[]} One message per broken rule; empty when the timing holds.
 * @example
 * judgeTiming({ since: "3.4.0", removeIn: "3.5.0" }, "3.4.0"); // []
 * judgeTiming({ since: "3.4.0", removeIn: "4.0.0" }, "3.4.0"); // one message: no other line
 */
function judgeTiming(announcement, current) {
    const out = [];
    const cur = parse(current);
    if (!cur) return [`version courante illisible (\`${current}\`) — attendu \`x.y.z\`.`];

    // `removeIn` — a MINOR of the current line, strictly after the version under preparation.
    //
    // 🛑 NOT a major, and this is the policy's statement, not a relaxation: no new major line is
    // planned, so a `removeIn` of the form `x.0.0` names a version that will never exist — an
    // announcement that can never come due. The rule used to demand exactly that shape.
    //
    // ⚠️ A removal lands on a MINOR (`x.y.0`), never on a patch: a patch promises a fix, and a
    // consumer on `~x.y.z` must never lose a symbol. And an announcement dated in the PRESENT
    // is not an announcement: it is a removal warned about after the fact.
    const rm = /^(\d+)\.(\d+)\.0$/.test(String(announcement.removeIn))
        ? parse(announcement.removeIn)
        : null;
    let removeInHolds = false;
    if (!rm) {
        out.push(
            `porte \`removeIn: "${announcement.removeIn}"\` — attendu une MINEURE \`x.y.0\` : ` +
                "un retrait se publie sur une mineure, jamais sur un correctif."
        );
    } else if (rm[0] !== cur[0]) {
        out.push(
            `porte \`removeIn: "${announcement.removeIn}"\` hors de la ligne courante ` +
                `(${current}) — aucune autre ligne majeure n'est prévue : un retrait se publie ` +
                "sur une mineure ultérieure de celle-ci."
        );
    } else if (cmp(rm, cur) <= 0) {
        out.push(
            `porte \`removeIn: "${announcement.removeIn}"\`, qui n'est pas après la version en ` +
                `préparation (${current}). Une annonce datée du présent n'est pas une annonce.`
        );
    } else {
        removeInHolds = true;
    }

    // `since` — in the current line, and never at or after the removal.
    const since = parse(announcement.since);
    if (!since) {
        out.push(`porte \`since: "${announcement.since}"\`, illisible — attendu \`x.y.z\`.`);
    } else if (since[0] !== cur[0]) {
        out.push(
            `annonce \`since: "${announcement.since}"\` hors de la ligne majeure courante ` +
                `(${current}) — l'annonce se fait dans la ligne qui la publie.`
        );
    } else if (removeInHolds && cmp(since, rm) >= 0) {
        out.push(
            `annonce \`since\` (${announcement.since}) au niveau ou après \`removeIn\` ` +
                `(${announcement.removeIn}) — une version qui annonce ET retire n'annonce rien.`
        );
    }
    return out;
}

module.exports = { judgeTiming };
