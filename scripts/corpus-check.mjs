#!/usr/bin/env node
// Tokenize every .mind file under the given paths with the MIND grammar and
// fail if any file produces an `invalid.*` token or ends inside an unclosed
// string, comment or attribute.
//
// Usage: node scripts/corpus-check.mjs [path ...]
// Default paths: tests/snap samples
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vsctm from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function loadGrammar() {
  const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName !== "source.mind") return null;
      const text = readFileSync(join(root, "source.mind.json"), "utf8");
      return vsctm.parseRawGrammar(text, "source.mind.json");
    },
  });
  return registry.loadGrammar("source.mind");
}

function collectFiles(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name === "node_modules" || name === "target" || name.startsWith(".")) continue;
      collectFiles(join(path, name), out);
    }
  } else if (path.endsWith(".mind")) {
    out.push(path);
  }
  return out;
}

function checkFile(grammar, file, rootState) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const problems = [];
  let stack = vsctm.INITIAL;
  lines.forEach((line, i) => {
    const result = grammar.tokenizeLine(line, stack);
    for (const token of result.tokens) {
      if (token.scopes.some((s) => s.startsWith("invalid."))) {
        const text = line.slice(token.startIndex, token.endIndex);
        problems.push(`${i + 1}:${token.startIndex + 1} invalid token ${JSON.stringify(text)}`);
      }
    }
    stack = result.ruleStack;
  });
  if (!stack.equals(rootState)) {
    problems.push(`EOF: file ends inside an unclosed string, comment or attribute`);
  }
  return { lines: lines.length, problems };
}

const args = process.argv.slice(2);
const paths = (args.length ? args : ["tests/snap", "samples"]).map((p) => resolve(p));
const grammar = await loadGrammar();
// The state after an empty line is the grammar's top-level state.
const rootState = grammar.tokenizeLine("", vsctm.INITIAL).ruleStack;
const files = paths.flatMap((p) => collectFiles(p, []));
if (files.length === 0) {
  console.error("corpus-check: no .mind files found");
  process.exit(2);
}

let totalLines = 0;
let failed = 0;
for (const file of files) {
  const { lines, problems } = checkFile(grammar, file, rootState);
  totalLines += lines;
  if (problems.length) {
    failed += 1;
    console.log(`FAIL ${relative(process.cwd(), file)}`);
    for (const p of problems.slice(0, 10)) console.log(`  ${p}`);
    if (problems.length > 10) console.log(`  ... ${problems.length - 10} more`);
  }
}
console.log(`corpus-check: ${files.length} files, ${totalLines} lines, ${failed} failing`);
process.exit(failed ? 1 : 0);
