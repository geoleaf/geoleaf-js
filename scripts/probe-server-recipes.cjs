#!/usr/bin/env node
/**
 * @fileoverview Serves a deliverable behind EACH of its two server recipes, in a real nginx and
 * a real Apache, and reads on the wire what the recipe makes the server send.
 *
 * ## What this sees that the gate cannot
 *
 * `verify-deploy-server-contract.cjs` judges the header each server WOULD send, through a model
 * of its precedence (`effectiveCacheControl()`). A model covers what it models: on the day the
 * recipes were first measured on a real Apache, every precompressed twin left as
 * `Content-Type: application/x-gzip` — a browser refuses a module under that type — while the
 * gate was green, because it models the cache and nothing else. That measure was a gesture; this
 * script is the same measure, replayable.
 *
 * ## What it compares
 *
 * For every file of the deliverable, asked for with and without `Accept-Encoding: gzip`:
 *
 *   PSR-01  the answer is a 200 ;
 *   PSR-02  `Cache-Control` is the one the table declares (`declaredCacheControl()`) ;
 *   PSR-03  the `Content-Type` under `gzip` is the one the file has without it ;
 *   PSR-04  a file that has a `.gz` twin is answered with `Content-Encoding: gzip` when the
 *           client accepts it — a recipe that never serves the twin types nothing wrong and
 *           would pass PSR-03 for the wrong reason.
 *
 * ## Why it is NOT a gate
 *
 * It needs a Docker daemon and two images. `ci:local` must run on a workstation without them,
 * and a runner would pull both at every run. It is a probe: played when a recipe changes, and
 * before a deliverable leaves.
 *
 * 🛑 **Without Docker it FAILS, it does not skip.** A probe that exits 0 without having served
 * anything reads as a measure.
 *
 * ## No port, no network
 *
 * Each container runs with `--network none`, the deliverable mounted read-only, and is asked
 * from the inside over its own loopback. Nothing listens on the workstation, and nothing can
 * collide with the development server already running there.
 *
 * Usage :
 *   node scripts/probe-server-recipes.cjs                # deploy-full
 *   node scripts/probe-server-recipes.cjs deploy-core    # another carrying variant
 */

"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { carriesServerContract, declaredCacheControl } = require("./lib/server-contract.cjs");

const CODE = "PROBE-SERVER-RECIPES";
const ROOT = path.resolve(__dirname, "..");
const VARIANT = process.argv[2] ?? "deploy-full";
const SERVED = path.join(ROOT, "deploy", VARIANT);

/** What a recipe ships beside the application: served like any file, judged by no table. */
const RECIPE_FILES = new Set([".htaccess", "nginx.conf.example", "SERVEUR.md"]);
/** A precompressed twin is asked for through its original, never by its own name. */
const TWIN_RE = /\.(gz|br)$/;

/**
 * Runs Docker and returns its standard output.
 *
 * @param {string[]} args
 * @param {{ input?: string }} [options]
 * @returns {string}
 */
function docker(args, options = {}) {
    return execFileSync("docker", args, {
        encoding: "utf8",
        input: options.input,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
    });
}

/** Lists the files of the deliverable a client may ask for, with `/` separators. */
function servedFiles() {
    /** @type {string[]} */
    const out = [];
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const next = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
            else if (!TWIN_RE.test(entry.name) && !RECIPE_FILES.has(next)) out.push(next);
        }
    };
    walk(SERVED, "");
    return out.sort();
}

/**
 * The nginx recipe, made startable in a container: its TLS, host and folder are the three
 * things an integrator fills in. Everything else — every `location`, every header — is the
 * recipe's own text, untouched: that text is what is under test.
 */
function nginxConfig() {
    const recipe = fs.readFileSync(path.join(SERVED, "nginx.conf.example"), "utf8");
    const conf = recipe
        .replace(/^\s*listen\s+443\s+ssl;$/m, "    listen 8080;")
        .replace(/^\s*http2\s+on;$/m, "")
        .replace(/^\s*ssl_certificate(_key)?\s+.*;$/gm, "")
        .replace(/^\s*server_name\s+.*;$/m, "    server_name localhost;")
        .replace(/^\s*root\s+.*;$/m, "    root /srv;");
    for (const left of ["ssl_certificate", "listen 443", "/chemin/"]) {
        if (conf.includes(left)) {
            throw new Error(
                `the nginx recipe changed shape: \`${left}\` survived the substitution — ` +
                    "the probe would start a server that is not the recipe"
            );
        }
    }
    return conf;
}

/**
 * The shell that asks one server for every path, twice, and prints the raw header blocks.
 *
 * ⚠️ One process for the whole list: a `docker exec` per request costs a tenth of a second,
 * and a deliverable holds hundreds of files.
 *
 * @param {"nc" | "bash"} client `nc` under busybox, `/dev/tcp` under bash — the two images
 *   share no HTTP client.
 * @param {number} port
 * @param {string[]} files
 */
function askScript(client, port, files) {
    const send =
        client === "nc"
            ? `printf '%b' "$req" | nc 127.0.0.1 ${port} | sed '/^\\r$/q'`
            : `exec 3<>/dev/tcp/127.0.0.1/${port}; printf '%b' "$req" >&3; sed '/^\\r$/q' <&3; exec 3<&-`;
    const lines = ["set -u"];
    for (const file of files) {
        for (const gzip of [false, true]) {
            const head =
                // 🛑 HTTP/1.1: nginx serves a precompressed twin to 1.1 clients only
                // (`gzip_http_version`). Asked in 1.0, every twin read as "not served" — the
                // instrument's own defect, seen on its first run.
                `HEAD /${encodeURI(file)} HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n` +
                (gzip ? "Accept-Encoding: gzip\\r\\n" : "") +
                "\\r\\n";
            lines.push(`echo "@@ ${gzip ? "gzip" : "plain"} ${file}"`, `req='${head}'`, send);
        }
    }
    return lines.join("\n") + "\n";
}

/**
 * Parses what `askScript` printed.
 *
 * @param {string} raw
 * @returns {Map<string, { plain?: Record<string, string>, gzip?: Record<string, string> }>}
 */
function parseAnswers(raw) {
    const answers = new Map();
    for (const block of raw.split(/^@@ /m).slice(1)) {
        const [first, ...rest] = block.split(/\r?\n/);
        const space = first.indexOf(" ");
        const mode = first.slice(0, space);
        const file = first.slice(space + 1);
        /** @type {Record<string, string>} */
        const headers = { ":status": (rest[0] ?? "").split(" ")[1] ?? "" };
        for (const line of rest.slice(1)) {
            const colon = line.indexOf(":");
            if (colon > 0)
                headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
        }
        const entry = answers.get(file) ?? {};
        entry[mode] = headers;
        answers.set(file, entry);
    }
    return answers;
}

/** The media type of a `Content-Type`, without its parameters. */
function mediaType(value) {
    return (value ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Judges one server's answers against the table and against themselves.
 *
 * @param {string} server
 * @param {string[]} files
 * @param {ReturnType<typeof parseAnswers>} answers
 * @returns {{ defects: string[], judgedCache: number, twinsServed: number }}
 */
function judge(server, files, answers) {
    /** @type {string[]} */
    const defects = [];
    let judgedCache = 0;
    let twinsServed = 0;
    for (const file of files) {
        const { plain, gzip } = answers.get(file) ?? {};
        if (!plain || !gzip) {
            defects.push(`[PSR-01] ${server}  ${file} — no answer read`);
            continue;
        }
        for (const [mode, headers] of [
            ["plain", plain],
            ["gzip", gzip],
        ]) {
            if (headers[":status"] !== "200") {
                defects.push(`[PSR-01] ${server}  ${file} (${mode}) — ${headers[":status"]}`);
            }
            const declared = declaredCacheControl(file);
            if (declared !== null) {
                judgedCache++;
                if (headers["cache-control"] !== declared) {
                    defects.push(
                        `[PSR-02] ${server}  ${file} (${mode}) — Cache-Control ` +
                            `\`${headers["cache-control"] ?? "(none)"}\`, declared \`${declared}\``
                    );
                }
            }
        }
        if (mediaType(plain["content-type"]) !== mediaType(gzip["content-type"])) {
            defects.push(
                `[PSR-03] ${server}  ${file} — \`${mediaType(gzip["content-type"])}\` under gzip, ` +
                    `\`${mediaType(plain["content-type"])}\` without`
            );
        }
        if (fs.existsSync(path.join(SERVED, `${file}.gz`))) {
            if (gzip["content-encoding"] === "gzip") twinsServed++;
            else {
                defects.push(
                    `[PSR-04] ${server}  ${file} — has a \`.gz\` twin, answered without ` +
                        "`Content-Encoding: gzip` to a client that accepts it"
                );
            }
        }
    }
    return { defects, judgedCache, twinsServed };
}

/**
 * Starts one server on the deliverable, asks it, stops it.
 *
 * @param {{ name: string, image: string, client: "nc" | "bash", port: number,
 *           run: string[], ready: string[] }} server
 * @param {string[]} files
 */
function probe(server, files) {
    const id = docker(["run", "-d", "--rm", "--network", "none", ...server.run]).trim();
    try {
        let up = false;
        for (let attempt = 0; attempt < 50 && !up; attempt++) {
            try {
                docker(["exec", id, ...server.ready]);
                up = true;
            } catch {
                execFileSync("sleep", ["0.2"]);
            }
        }
        if (!up) {
            let logs = "";
            try {
                logs = execFileSync("docker", ["logs", id], { encoding: "utf8", stdio: "pipe" });
            } catch (cause) {
                logs = cause instanceof Error ? cause.message : String(cause);
            }
            throw new Error(`${server.name} did not start behind its recipe:\n${logs}`);
        }
        const shell = server.client === "nc" ? "sh" : "bash";
        const raw = docker(["exec", "-i", id, shell], {
            input: askScript(server.client, server.port, files),
        });
        return judge(server.name, files, parseAnswers(raw));
    } finally {
        try {
            docker(["stop", "-t", "1", id]);
        } catch {
            // Already gone: `--rm` removed it when the server exited on its own.
        }
    }
}

function main() {
    const line = "─".repeat(72);
    console.log(line);
    if (!carriesServerContract(VARIANT)) {
        console.error(`❌ [${CODE}] \`${VARIANT}\` does not carry a server contract.`);
        process.exit(1);
    }
    if (!fs.existsSync(path.join(SERVED, "nginx.conf.example"))) {
        console.error(
            `❌ [${CODE}] deploy/${VARIANT}/ holds no recipe — build the deliverable first ` +
                "(`npm run build:deploy`)."
        );
        process.exit(1);
    }
    try {
        docker(["version", "--format", "{{.Server.Version}}"]);
    } catch {
        console.error(
            `❌ [${CODE}] no Docker daemon answers. This probe SERVES the deliverable: ` +
                "without a server it has measured nothing, and says so by failing."
        );
        process.exit(1);
    }

    const files = servedFiles();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-recipes-"));
    const nginxConf = path.join(work, "default.conf");
    fs.writeFileSync(nginxConf, nginxConfig(), "utf8");

    const servers = [
        {
            name: "nginx",
            image: "nginx:alpine",
            client: /** @type {const} */ ("nc"),
            port: 8080,
            run: [
                "-v",
                `${SERVED}:/srv:ro`,
                "-v",
                `${nginxConf}:/etc/nginx/conf.d/default.conf:ro`,
                "nginx:alpine",
            ],
            ready: [
                "sh",
                "-c",
                "printf 'HEAD / HTTP/1.0\\r\\n\\r\\n' | nc 127.0.0.1 8080 | grep -q HTTP",
            ],
        },
        {
            name: "apache",
            image: "httpd:2.4",
            client: /** @type {const} */ ("bash"),
            port: 80,
            // The stock configuration ignores `.htaccess` and leaves `mod_rewrite` unloaded:
            // the two things SERVEUR.md asks an integrator to turn on, and nothing more.
            run: [
                "-v",
                `${SERVED}:/usr/local/apache2/htdocs:ro`,
                "httpd:2.4",
                "sh",
                "-c",
                "sed -i -e 's/^#\\(LoadModule rewrite_module\\)/\\1/' " +
                    "-e 's/AllowOverride None/AllowOverride All/' conf/httpd.conf && httpd-foreground",
            ],
            ready: ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/80"],
        },
    ];

    /** @type {string[]} */
    const defects = [];
    /** @type {string[]} */
    const scope = [];
    try {
        for (const server of servers) {
            const result = probe(server, files);
            defects.push(...result.defects);
            scope.push(
                `${server.name} (${server.image}) : ${files.length} file(s) asked twice, ` +
                    `${result.judgedCache} Cache-Control compared, ${result.twinsServed} twin(s) served`
            );
        }
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }

    if (defects.length > 0) {
        console.error(`❌ [${CODE}] ${defects.length} defect(s) on deploy/${VARIANT}/ :`);
        for (const defect of defects.slice(0, 40)) console.error(`  ❌ ${defect}`);
        if (defects.length > 40) console.error(`  … and ${defects.length - 40} more`);
    } else {
        console.log(
            `✅ [${CODE}] deploy/${VARIANT}/ — both recipes send what the table declares, and ` +
                "type a precompressed file as its original"
        );
    }
    for (const entry of scope) console.log(`    ${entry}`);
    console.log(line);
    process.exit(defects.length > 0 ? 1 : 0);
}

main();
