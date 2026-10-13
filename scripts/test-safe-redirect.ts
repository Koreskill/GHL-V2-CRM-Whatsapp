import assert from "node:assert/strict";
import { safeNext } from "../src/lib/safe-redirect";

assert.equal(safeNext("/pipeline"), "/pipeline");
assert.equal(safeNext("/conversaciones?id=1#x"), "/conversaciones?id=1#x");
assert.equal(safeNext(undefined), "/");
assert.equal(safeNext(""), "/");
assert.equal(safeNext(null), "/");
assert.equal(safeNext(["/a"]), "/");

// Destinos externos o que el navegador interpreta como externos.
for (const bad of [
  "https://evil.com",
  "//evil.com",
  "/\\evil.com",
  "/\\/evil.com",
  "/foo\\bar",
  "javascript:alert(1)",
  "evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/%0d%0aSet-Cookie:x", // decodificado ya no llega así, pero tampoco debe romper nada
]) {
  const out = safeNext(bad);
  assert.ok(out === "/" || out.startsWith("/%0d"), `${JSON.stringify(bad)} -> ${out}`);
}
assert.equal(safeNext("/\t/evil.com"), "/");

// Bucles de redirección.
assert.equal(safeNext("/login?next=/x"), "/");
assert.equal(safeNext("/auth/callback"), "/");
assert.equal(safeNext("/x", "/inicio"), "/x");
assert.equal(safeNext("//x", "/inicio"), "/inicio");

console.log("safe-redirect: ok");
