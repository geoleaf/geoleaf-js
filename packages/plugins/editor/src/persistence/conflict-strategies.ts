/*!
 * @geoleaf-plugins/editor — Conflict strategy vocabulary (single source)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The conflict-handling strategies this plugin understands.
 *
 * ## Why this module exists at all
 *
 * The vocabulary lived in **three** places, in three different syntactic forms: a union type
 * where the resolution runs, the same union re-spelled by hand in the configuration surface,
 * and an array literal in the validator. They agreed — and that agreement was an accident of
 * three people having written the same three strings.
 *
 * 🛑 **The defect was ORIENTED, and in the direction that does not announce itself.** Adding a
 * fourth strategy to the union made nothing red: the validator kept rejecting the new value and
 * resetting it to `"prompt"` with a warning, while the resolution code was perfectly able to
 * handle it. The integrator would see their profile value silently reset, with no visible link
 * to the cause. **The copy that VALIDATES is the most dangerous of the three — it decides, and
 * it is the one nobody remembers to update.**
 *
 * ## Why the ARRAY is the source and the type the derivative
 *
 * The type is erased at compile time; the array is the only one of the two that exists when the
 * validator runs. Deriving the type from the array therefore makes the runtime the authority and
 * the compiler its follower — a fourth entry added here is accepted by the validator AND known
 * to the type in the same edit, which is exactly the coupling that was missing.
 *
 * ## Why a leaf module rather than a home in one of the three
 *
 * The vocabulary belongs to none of them: it is not the resolution UI, not the configuration
 * surface, not the validator. Hanging it on any one would make the other two import that one —
 * and `types.ts` is a **pure type surface** with no imports at all, which importing the
 * resolution module (DOM code, several dependencies) would end.
 *
 * 📌 **And a leaf that imports nothing cannot take part in an import cycle, by construction.**
 * There is no cycle here today; there is one edge of distance to one, and this shape removes the
 * question instead of answering it for the current arrangement.
 *
 * ⚠️ **Order is part of the contract for humans, not for the code**: it is the order in which the
 * strategies appear in the configuration guide and in the warning message. Nothing depends on it
 * at runtime, but a reader comparing the two should not have to sort.
 */
export const CONFLICT_STRATEGIES = ["client-wins", "server-wins", "prompt"] as const;

/**
 * Conflict-handling strategy — derived from {@link CONFLICT_STRATEGIES}, never re-spelled.
 *
 * Kept as a named export here AND re-exported from `conflict-resolution.ts`, where it has always
 * lived: moving the declaration must not move the import path its consumers already use.
 */
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

/**
 * Default applied when a profile says nothing, or says something this plugin does not know.
 *
 * Declared beside the vocabulary rather than in the validator: it is the one member of the list
 * that carries a role, and a default living apart from the list it belongs to is the next copy
 * waiting to diverge.
 */
export const DEFAULT_CONFLICT_STRATEGY: ConflictStrategy = "prompt";
