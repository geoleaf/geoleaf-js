#!/usr/bin/env node
/**
 * DOM injection audit script to detect potentially dangerous usages
 * Scanne: innerHTML, outerHTML, insertAdjacentHTML, document.write
 * Usage: node scripts/audit-innerhtml.js
 */

const fs = require("fs");
const path = require("path");

// Couleurs pour terminal
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m",
};

function scanDirectory(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // Ignorer node_modules, dist, etc.
            if (
                ![
                    "node_modules",
                    "dist",
                    "__tests__",
                    "__mocks__",
                    ".git",
                    "coverage",
                    "artifacts",
                    "deploy",
                    "docs",
                    "demo",
                    "_docs_communs",
                    "_docs_projet",
                ].includes(file)
            ) {
                scanDirectory(filePath, fileList);
            }
        } else if (file.endsWith(".js") && !file.endsWith(".test.js")) {
            fileList.push(filePath);
        } else if (file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts")) {
            fileList.push(filePath);
        } else if (file.endsWith(".html")) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

function analyzeFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const results = [];

    lines.forEach((line, index) => {
        // Chercher innerHTML, outerHTML, insertAdjacentHTML, document.write
        const patterns = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"];
        const matchedPattern = patterns.find((p) => line.includes(p));
        if (matchedPattern) {
            const lineNum = index + 1;
            const trimmedLine = line.trim();

            // Determine risk level
            let risk = "LOW";
            let reason = "Static HTML";

            if (trimmedLine.includes(matchedPattern) && !trimmedLine.includes("// SAFE:")) {
                if (
                    matchedPattern === "insertAdjacentHTML" ||
                    matchedPattern === "document.write"
                ) {
                    risk = "HIGH";
                    reason = `${matchedPattern} usage — potential XSS vector`;
                } else if (
                    line.match(/innerHTML\s*=\s*[^"']/) ||
                    line.match(/outerHTML\s*=\s*[^"']/) ||
                    line.match(/innerHTML\s*\+=/) ||
                    line.match(/outerHTML\s*\+=/) ||
                    line.match(/innerHTML\s*=.*\$\{/) ||
                    line.match(/outerHTML\s*=.*\$\{/) ||
                    line.match(/innerHTML\s*=.*\+/) ||
                    line.match(/outerHTML\s*=.*\+/)
                ) {
                    risk = "HIGH";
                    reason = "Dynamic content without sanitization";
                } else if (line.includes("escapeHtml") || line.includes("Security.")) {
                    risk = "LOW";
                    reason = "Sanitized with escapeHtml/Security";
                } else {
                    risk = "MEDIUM";
                    reason = "Needs verification";
                }
            }

            results.push({ lineNum, line: trimmedLine, risk, reason });
        }
    });

    return results;
}

function main() {
    console.log(`${colors.bold}${colors.cyan}=== AUDIT INNERHTML XSS ===${colors.reset}\n`);

    const rootDir = path.join(__dirname, "..");
    const files = scanDirectory(rootDir);

    let totalIssues = 0;
    let highRisk = 0;
    let mediumRisk = 0;
    let lowRisk = 0;

    files.forEach((filePath) => {
        const relativePath = path.relative(rootDir, filePath);
        const results = analyzeFile(filePath);

        if (results.length > 0) {
            console.log(`${colors.bold}📄 ${relativePath}${colors.reset}`);

            results.forEach(({ lineNum, line, risk, reason }) => {
                totalIssues++;

                let color = colors.green;
                let emoji = "✓";

                if (risk === "HIGH") {
                    color = colors.red;
                    emoji = "🔴";
                    highRisk++;
                } else if (risk === "MEDIUM") {
                    color = colors.yellow;
                    emoji = "🟡";
                    mediumRisk++;
                } else {
                    lowRisk++;
                }

                console.log(
                    `  ${emoji} ${color}[${risk}]${colors.reset} Ligne ${lineNum}: ${line.substring(0, 80)}...`
                );
                console.log(`     └─ ${reason}`);
            });

            console.log("");
        }
    });

    // Summary
    console.log(`${colors.bold}${colors.cyan}=== SUMMARY ===${colors.reset}`);
    console.log(`Total innerHTML found: ${totalIssues}`);
    console.log(`  ${colors.red}🔴 Haut risque: ${highRisk}${colors.reset}`);
    console.log(`  ${colors.yellow}🟡 Moyen risque: ${mediumRisk}${colors.reset}`);
    console.log(`  ${colors.green}✓ Bas risque: ${lowRisk}${colors.reset}`);

    if (highRisk > 0) {
        console.log(
            `\n${colors.red}${colors.bold}⚠️  WARNING: ${highRisk} high-risk usage(s) detected${colors.reset}`
        );
        process.exit(1);
    } else if (mediumRisk > 0) {
        console.log(
            `\n${colors.yellow}${colors.bold}⚠️  ${mediumRisk} usage(s) require review${colors.reset}`
        );
    } else {
        console.log(`\n${colors.green}${colors.bold}✓ No critical issues detected${colors.reset}`);
    }
}

main();
