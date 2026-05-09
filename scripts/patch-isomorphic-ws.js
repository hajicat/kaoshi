/**
 * Patch @libsql/isomorphic-ws to use node.mjs for workerd condition.
 * This fixes OpenNext Cloudflare build which can't resolve web.mjs
 * because it's not included in the file trace.
 * Uses node.mjs + ws package + nodejs_compat flag instead.
 */
const fs = require("fs");
const path = require("path");

const pkgPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@libsql",
  "isomorphic-ws",
  "package.json"
);

if (!fs.existsSync(pkgPath)) {
  console.log("@libsql/isomorphic-ws not found, skipping patch");
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const patched =
  pkg.exports["."].import.workerd === "./node.mjs";

if (patched) {
  console.log("@libsql/isomorphic-ws already patched");
  process.exit(0);
}

pkg.exports["."].import.workerd = "./node.mjs";
pkg.exports["."].require.workerd = "./node.cjs";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log("@libsql/isomorphic-ws patched: workerd -> node.mjs");
