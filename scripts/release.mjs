import { execSync } from "node:child_process";

function run(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    console.error(`\n❌ Falhou: ${cmd}`);
    process.exit(1);
  }
}

const type = process.argv[2] ?? "patch"; // patch | minor | major
if (!["patch", "minor", "major"].includes(type)) {
  console.error(`❌ Tipo inválido: "${type}". Use: patch | minor | major`);
  process.exit(1);
}

console.log("🔍 Verificando testes e build...");
run("npm run check");

console.log(`📦 Bumping versão (${type})...`);
run(`npm version ${type} --no-git-tag-version`);

const version = JSON.parse(
  (await import("node:fs")).default.readFileSync("package.json", "utf8")
).version;

console.log(`🏷  Criando tag v${version}...`);
run(`git add package.json`);
run(`git commit -m "chore: release v${version}"`);
run(`git tag v${version}`);

console.log("📤 Pushing...");
run("git push");
run(`git push origin v${version}`);

console.log(`\n✅ Release v${version} publicado!`);
console.log(`   Para gerar o pacote: npm pack`);
