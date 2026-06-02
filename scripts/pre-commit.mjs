import { execSync } from "node:child_process";

function run(cmd, label) {
    try {
        console.log(`→ ${label}`);
        execSync(cmd, { stdio: "inherit" });
    } catch (e) {
        console.error(`\n❌ ${label} failed`);
        process.exit(1);
    }
}

const changed = execSync(
    "git diff --cached --name-only --diff-filter=ACM",
    { encoding: "utf-8" }
)
    .split("\n")
    .filter(Boolean);

const mjsFiles = changed.filter(f => f.endsWith(".mjs"));

if (mjsFiles.length === 0) {
    console.log("→ no .mjs changes, skipping checks");
    process.exit(0);
}

run(`node --check ${mjsFiles.join(" ")}`, "syntax check");
run("npm run test", "test");

console.log("\n✅ pre-commit ok");