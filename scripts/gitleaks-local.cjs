#!/usr/bin/env node
"use strict";
/**
 * gitleaks-local.cjs — `ci.yml`'s `Secret scan (gitleaks)` gate, replayed BEFORE the push.
 *
 * ## Why it exists
 *
 * `gitleaks` is the only substantive `ci.yml` gate carried by a GitHub ACTION, hence the
 * only one `ci:local` structurally could not run. It bit twice in a row on 2026-07-29,
 * for two different causes, and each discovery cost a run of a scarce quota. A pushed
 * secret was only visible remotely — that is, too late.
 *
 * The action is not reproducible; its BINARY is. This script runs the EXACT version the
 * action installs (read off the run log: `gitleaks version: 8.24.3`) on the same commit
 * range, through Docker.
 *
 * ## What it scans, and why not "the repo"
 *
 * On a `push`, the action does not scan the tree: it scans the PUSHED RANGE. The local
 * pre-push equivalent is thus `origin/main..HEAD` — the commits about to be sent.
 * Scanning the working tree would answer a different question and would let through a
 * secret introduced then removed across two commits of the same push.
 *
 * ⚠️ THE TRAP THIS SCRIPT CLOSES BY CONSTRUCTION — the `f15b0575` defect taken from the
 * other end. On an empty range, gitleaks scans zero bytes and serenely prints
 * "no leaks found". That is exactly what the CI displayed right before failing:
 *
 *     WRN scanned ~0 bytes (0)
 *     WRN no leaks found in partial scan
 *
 * A reassuring verdict on an empty scan is worse than no verdict, because it gets
 * believed. This script therefore COUNTS the range's commits before launching anything,
 * and refuses to render a verdict when there are none — it does not come out "green", it
 * comes out "not applicable".
 *
 * ## What it does not cover
 *
 * The action's `pull_request` path, which queries the GitHub API to enumerate the PR's
 * commits and requires `GITHUB_TOKEN`. No local equivalent exists: there is no
 * `pull_request` event on a workstation. That half stays verifiable remotely only.
 *
 * Usage: node scripts/gitleaks-local.cjs [--all]
 *   (no argument)    scans `origin/main..HEAD` — what is about to be pushed
 *   --all            scans all history reachable from HEAD (slow, occasional)
 *
 * Exit: 0 if no leak (or if Docker is absent / the range is empty, with the reason
 * printed), 1 if a leak is found or the scan could not complete.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

/**
 * Scanned repo. Overridable so this gate is PROVABLE: without this hook, the only way to
 * see it go red would be committing a real fake secret into the working repo — so nobody
 * would, and a guard never seen red guards nothing. Same pattern as
 * `GEOLEAF_CI_WORKFLOW_DIR` and `GEOLEAF_NYC_OUTPUT`.
 */
const ROOT = process.env.GEOLEAF_GITLEAKS_REPO
    ? path.resolve(process.env.GEOLEAF_GITLEAKS_REPO)
    : path.resolve(__dirname, "..");

/**
 * Pinned to the version the action installs, BY DIGEST. A version gap is a RULES gap: two
 * different gitleaks do not render the same verdict, and a local green obtained with older
 * rules would say nothing about the run to come — the very promise being repaired here.
 *
 * The tag `v8.24.3` is MUTABLE on ghcr; the digest is not. Pinning by digest is what makes
 * the SAME scanner binary run on every machine and in CI — the same reason the workflow's
 * `uses:` are SHA-pinned, applied here to the one container image the pipeline pulls. To
 * bump: pull the new tag, read its digest (`docker images --digests
 * ghcr.io/gitleaks/gitleaks`), and update BOTH constants below.
 */
const IMAGE_VERSION = "v8.24.3";
const IMAGE =
    "ghcr.io/gitleaks/gitleaks@sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055";

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

function dockerAvailable() {
    const res = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return res.status === 0;
}

function main() {
    const all = process.argv.includes("--all");
    console.log(`${C.b}── SECRET SCAN (gitleaks ${IMAGE_VERSION}) ──${C.x}`);

    // 1. Docker. Its absence is a missing ENVIRONMENT dependency, not a failing gate:
    //    reddening `ci:local` for it would push people to bypass it, and a bypassed gate
    //    guards nothing. We announce it loudly, and exit 0.
    //
    // 🛑 EXCEPT IN CI — AND THE REASON FOR THE LENIENCY IS WHAT CHANGED. That tolerance
    // rested on one sentence — "the remote gate will run on the runner anyway" — which
    // was true while the remote side ran `gitleaks-action`. Since 2026-08-11, `ci.yml`
    // runs THIS script: the net invoked to justify the exit 0 became the script itself.
    // Without this guard, a Docker-less runner would render a silent green while leaning
    // on a backstop that no longer exists — exactly the defect class the range
    // escalation below just closed, reintroduced from the other end.
    if (!dockerAvailable()) {
        const inCI = process.env.CI === "true";
        console.log(`  ${C.y}⚠ Docker ne répond pas — CE SCAN N'A PAS EU LIEU.${C.x}`);
        if (inCI) {
            console.log(
                `  ${C.r}✗ En CI, c'est un ÉCHEC : ce script EST la gate distante depuis le\n` +
                    `  11/08/2026, donc rien ne le rattrape en aval. Un scan qui n'a pas eu lieu\n` +
                    `  ne peut pas sortir vert ici.${C.x}`
            );
            process.exit(1);
        }
        console.log(
            `  ${C.d}Sur un poste, ce n'est pas un échec : la gate distante rejouera le même\n` +
                `  scan sur le runner. Un secret présent dans les commits à pousser ne sera donc\n` +
                `  découvert qu'après avoir dépensé un run.${C.x}`
        );
        process.exit(0);
    }

    // 2. The range. Counted BEFORE the scan, precisely to not render a verdict on nothing.
    //
    // 🛑 AN EMPTY RANGE EXITS 0 WHILE ANNOUNCING IT SCANNED NOTHING — and that is NOT
    //    satisfying. The attempt to fix it was made on 2026-08-11 and REMOVED the same
    //    day, because its remedy was worse. The story is written here so it is not
    //    redone identically.
    //
    // **The defect, real**: a `ci:local` step that exits 0 reads GREEN in the table,
    // whatever it prints. Measured on the public repo's clone — one commit, no remote —
    // where this step was green while a full-history `--all` scan found **3 leaks**
    // there.
    //
    // **The remedy tried**: escalate to full history when the range is empty.
    // **Why it was removed**: on a long-history repo, it resurrects findings ALREADY
    // REMEDIATED. Measured at the first push — CI went red on
    // `geoleaf-windows-datas-path` in `5b8c6c8f`, a commit whose content a later cleanup
    // has removed since. A gate no fix can turn green without rewriting history is a
    // gate people end up bypassing.
    //
    // **Both alternative fallbacks are measured and discarded too**:
    //   • `--log-opts=-1` (the head commit) — wrong from the 2nd commit on: on the
    //     public repo it would no longer see the initial commit, hence not the 3 leaks
    //     motivating all of this;
    //   • `gitleaks dir` (the tree) — scans what git ignores: **108 findings**, almost
    //     all in `node_modules/`.
    //
    // **What it would take**: the EVENT's range (`github.event.before..sha`), which
    // `gitleaks-action` got from GitHub and a local script cannot guess. A piece to
    // design — an environment hook read here, set by `ci.yml` — not to improvise.
    // Meanwhile, `--all` on a fresh clone remains the background verdict.
    // ✅ `GEOLEAF_GITLEAKS_RANGE` — THE MISSING PIECE, laid on 2026-08-11.
    //
    // It is the answer to the problem described above, and it comes from where the
    // information EXISTS: the GitHub event. `ci.yml` computes `before..sha` on a push,
    // `base..head` on a PR, and passes it here. A local script cannot guess those
    // bounds — this is exactly what `gitleaks-action` received from the platform, and
    // the only thing lost when replacing it with the binary.
    //
    // 🛑 **When the range comes from the event, an EMPTY range is a FAILURE, not
    // silence.** The local fallback's tolerance is justified by "there is nothing to
    // compare, normal on a workstation". Here the plumbing ASSERTED a range: if it holds
    // nothing, the bound computation is wrong, and exiting 0 would mute the gate
    // precisely where it stands alone.
    //
    // 📌 When the variable is absent — `workflow_dispatch`, first push of a branch —
    // the local behaviour applies as-is, non-verdict included. Accepted: a manual run
    // has no natural range, and inventing a bound would be worse than saying there is
    // none.
    const envRange = (process.env.GEOLEAF_GITLEAKS_RANGE || "").trim();
    const fromEvent = envRange.length > 0;

    let range;
    if (all) {
        range = "HEAD";
    } else if (fromEvent) {
        range = envRange;
        console.log(`  ${C.d}plage fournie par l'événement CI : ${range}${C.x}`);
    } else {
        const upstream = git("rev-parse", "--verify", "--quiet", "origin/main");
        if (upstream.status !== 0) {
            console.log(
                `  ${C.y}⚠ \`origin/main\` introuvable — impossible de délimiter la plage.${C.x}`
            );
            console.log(`  ${C.d}Relancer avec --all pour scanner tout l'historique.${C.x}`);
            process.exit(0);
        }
        range = "origin/main..HEAD";
        // 📌 No `console.log` of the range HERE, and that is measured, not assumed
        // (2026-08-17). The COUNT line, a few lines below, already prints
        // `plage : <range> — N commit(s)` in **both** branches — the event's and this
        // one. Adding a second would say nothing more and say it worse: it would name
        // the range without its count, yet the count is what answers the question this
        // file exists to ask — *did it scan anything?*
    }

    /**
     * Number of lines ADDED by the range, or `-1` if the count is not safe.
     *
     * 🛑 Counted PER COMMIT (`git log --numstat`), never on the net diff (`git diff`).
     * A secret added then removed within the same range makes the net diff empty:
     * trusting it would let through exactly what this gate exists to catch.
     *
     * Returns `-1` — hence REFUSES to conclude — on a binary file (`-` in numstat,
     * uncountable content) or on unreadable git output. In doubt, the gate goes red.
     */
    function addedLinesIn(r) {
        const st = git("log", "--numstat", "--pretty=format:", r);
        if (st.status !== 0) return -1;
        let total = 0;
        for (const line of (st.stdout || "").split("\n")) {
            if (!line.trim()) continue;
            const add = line.split("\t")[0];
            if (add === "-") return -1;
            const v = Number(add);
            if (!Number.isFinite(v)) return -1;
            total += v;
        }
        return total;
    }

    const count = git("rev-list", "--count", range);
    const n = count.status === 0 ? Number(count.stdout.trim()) : -1;
    if (n === 0) {
        if (fromEvent) {
            console.log(
                `  ${C.r}✗ 0 commit dans \`${range}\`, une plage POURTANT fournie par` +
                    ` l'événement.${C.x}`
            );
            console.log(
                `  ${C.d}Ce n'est pas « rien à scanner » : c'est un calcul de bornes faux dans\n` +
                    `  ci.yml. Sortir 0 ici rendrait la gate muette là où elle est le seul œil.${C.x}`
            );
            process.exit(1);
        }
        console.log(
            `  ${C.y}⚠ 0 commit dans \`${range}\` — RIEN À SCANNER, DONC AUCUN VERDICT.${C.x}`
        );
        console.log(
            `  ${C.d}Ce n'est pas un vert. gitleaks aurait imprimé « no leaks found » sur zéro\n` +
                `  octet, ce qui est le mode d'échec que ce script existe pour ne pas répéter.${C.x}`
        );
        process.exit(0);
    }
    if (n < 0) {
        console.log(`  ${C.r}✗ plage \`${range}\` illisible — refus de conclure.${C.x}`);
        process.exit(1);
    }

    // 3. The scan. Same flags as the action: --redact (no secret in clear in the log),
    //    --exit-code=2 to distinguish "leak found" from an execution error.
    //
    //    ⚠️ This line said "no `.gitleaks.toml` in the repo" until 2026-08-10. The file
    //    now exists at the root and gitleaks finds it on its own, HERE as in CI, because
    //    both point at the same root: the repo is mounted on `/repo` and `--source=/repo`
    //    makes it the configuration search directory. There is thus still nothing to
    //    synchronize by hand — but for a different reason, and that is the kind of
    //    sentence that gets copied without being re-read.
    //
    //    🛑 Consequence to know: that file carries `[extend] useDefault = true`. Without
    //    that line, a `.gitleaks.toml` REPLACES the ~150 default rules, and this script
    //    would go green while guarding only four home-grown strings. A dedicated probe
    //    proves it by mutation, on a throwaway repo, with a real test key.
    console.log(`  plage : ${C.b}${range}${C.x} — ${n} commit(s)`);
    // ⚠️ FROM A GIT WORKTREE, `.git` is a FILE, not a directory — it contains
    // `gitdir: /absolute/path/to/.git/worktrees/<name>`. That path is OUTSIDE the
    // mounted volume, so git inside the container does not resolve it:
    //
    //     fatal: not a git repository: /…/.git/worktrees/geoleaf-cipush-XXXX
    //     WRN scanned ~0 bytes (0)
    //     WRN no leaks found in partial scan
    //
    // Measured on 2026-08-01 at the first `ci:push` run, which works precisely in a
    // worktree. This script's guard did refuse to conclude (the step exited in error,
    // not green), but the reason was a MOUNT defect and not a security one — exactly
    // the pair one must know how to tell apart.
    //
    // The real git directory is therefore mounted at ITS ABSOLUTE PATH, so the `.git`
    // file's `gitdir:` resolves identically inside the container.
    const gitCommonDir = git(
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir"
    ).stdout.trim();
    const extraMounts =
        gitCommonDir && !gitCommonDir.startsWith(`${ROOT}/.git`)
            ? ["-v", `${gitCommonDir}:${gitCommonDir}:ro`]
            : [];

    const res = spawnSync(
        "docker",
        [
            "run",
            "--rm",
            "-v",
            `${ROOT}:/repo:ro`,
            ...extraMounts,
            // The container runs as root over host-owned files: without this
            // declaration, git refuses the repo as "dubious ownership" and gitleaks
            // errors out — a red that is not a security verdict. Set through variables
            // rather than by writing a ~/.gitconfig into the image.
            //
            // The common git directory, when mounted (worktree case), must be declared
            // safe AS WELL: it belongs to the same host user.
            "-e",
            `GIT_CONFIG_COUNT=${extraMounts.length ? 2 : 1}`,
            "-e",
            "GIT_CONFIG_KEY_0=safe.directory",
            "-e",
            "GIT_CONFIG_VALUE_0=/repo",
            ...(extraMounts.length
                ? [
                      "-e",
                      "GIT_CONFIG_KEY_1=safe.directory",
                      "-e",
                      `GIT_CONFIG_VALUE_1=${gitCommonDir}`,
                  ]
                : []),
            IMAGE,
            "detect",
            "--source=/repo",
            "--redact",
            "-v",
            "--exit-code=2",
            `--log-opts=${range}`,
        ],
        { cwd: ROOT, encoding: "utf8" }
    );

    const out = `${res.stdout || ""}${res.stderr || ""}`;

    // 4. The emptiness check, as a second line of defence. The commit count above can be
    //    non-zero while gitleaks read nothing (commits with no additions, badly passed
    //    range) — and that is precisely the state in which CI announced "no leaks".
    //
    //    ⚠️ BUT THE TWO CITED CASES DO NOT HAVE THE SAME STATUS, and conflating them
    //    made CI go red on 2026-08-15 on a commit of 62 deletions and ZERO additions —
    //    the JOURNAL cap rotation, i.e. a move the repo MANDATES every month. "Badly
    //    passed range" is a defect; "the range adds nothing" is a safe, recurring
    //    state. gitleaks only reads ADDED content: on a range that has none, its
    //    silence is not blindness, it is the truth.
    const scanned = out.match(/scanned ~(\d+) bytes/);
    if (res.status === 0 && scanned && Number(scanned[1]) === 0) {
        const added = addedLinesIn(range);
        if (added === 0) {
            console.log(
                `  ${C.y}⚠ scan vide, et il est VRAI : la plage n'ajoute aucune ligne.${C.x}`
            );
            console.log(
                `  ${C.d}${n} commit(s), 0 ligne ajoutée — gitleaks ne scanne que les ajouts,\n` +
                    `  il n'avait donc rien à lire. Suppression pure (rotation, purge, retrait).${C.x}`
            );
            process.exit(0);
        }
        console.log(
            `  ${C.r}✗ gitleaks n'a lu AUCUN octet, et annonce pourtant « no leaks ».${C.x}`
        );
        console.log(
            `  ${C.d}Un scan vide n'est pas un verdict — et la plage ajoute pourtant ` +
                `${added < 0 ? "un contenu indénombrable (binaire ou illisible)" : `${added} ligne(s)`}` +
                `. Vérifier la plage.${C.x}`
        );
        process.exit(1);
    }

    for (const line of out.split("\n")) {
        if (/commits scanned|scanned ~|leaks found|Finding:|File:|Commit:|RuleID:/.test(line)) {
            console.log(`  ${C.d}${line.trim()}${C.x}`);
        }
    }

    if (res.status === 0) {
        console.log(
            `\n${C.g}✓ SECRET SCAN — aucune fuite dans ${n} commit(s) prêts à pousser.${C.x}`
        );
        process.exit(0);
    }
    if (res.status === 2) {
        console.log(`\n${C.r}✗ SECRET SCAN — FUITE DÉTECTÉE dans les commits à pousser.${C.x}`);
        console.log(
            `  ${C.d}Réécrire l'historique avant de pousser : une fois le commit distant, le\n` +
                `  secret est à considérer comme compromis, et le retirer ne suffit plus.${C.x}`
        );
        process.exit(1);
    }
    console.log(
        `\n${C.r}✗ SECRET SCAN — gitleaks a échoué (exit ${res.status}), pas de verdict.${C.x}`
    );
    console.log(out.split("\n").slice(-8).join("\n"));
    process.exit(1);
}

if (require.main === module) {
    main();
}
