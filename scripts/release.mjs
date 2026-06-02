import { execSync } from "node:child_process";
import fs from "node:fs";

function run(cmd) {
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    console.error(`\n❌ Falhou: ${cmd}`);
    process.exit(1);
  }
}

function capture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
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

const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

// Se a tag já existe (retry após falha no push), pula commit+tag
const tagExists = execSync(`git tag -l v${version}`, { encoding: "utf8" }).trim() !== "";

if (!tagExists) {
  console.log(`🏷  Criando tag v${version}...`);
  run(`git add package.json`);
  run(`git commit -m "chore: release v${version}"`);
  run(`git tag v${version}`);
} else {
  console.log(`🏷  Tag v${version} já existe, pulando commit...`);
}

console.log("📤 Pushing...");
run(`git push --set-upstream origin ${capture("git branch --show-current")}`);
run(`git push origin v${version}`);

console.log(`\n✅ Release v${version} publicado!`);
console.log(`   Para gerar o pacote: npm pack`);
