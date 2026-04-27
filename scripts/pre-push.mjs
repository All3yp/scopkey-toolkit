import { execSync } from "node:child_process";

function run(cmd) {
    try {
        execSync(cmd, { stdio: "inherit" });
    } catch (e) {
        console.error("\n❌ Command failed:", cmd);
        process.exit(1);
    }
}

console.log("Running tests...");
run("npm test");

console.log("Running coverage...");
run("npm run test:coverage");

console.log("✅ OK — pushing");