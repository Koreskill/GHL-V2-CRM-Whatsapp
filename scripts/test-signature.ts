import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyZernioSignature } from "../src/lib/zernio/webhooks";

const secret = "test-secret";
const raw = '{ "id": "3f0c", "event": "webhook.test", "message": "hola  á" }';
const sig = createHmac("sha256", secret).update(raw).digest("hex");

assert.equal(verifyZernioSignature(raw, sig, secret), true, "firma válida");
assert.equal(verifyZernioSignature(raw, sig.toUpperCase(), secret), true, "hex en mayúsculas");
assert.equal(verifyZernioSignature(JSON.stringify(JSON.parse(raw)), sig, secret), false, "re-serializar rompe la firma");
assert.equal(verifyZernioSignature(raw, sig, "otro"), false, "secreto incorrecto");
assert.equal(verifyZernioSignature(raw, sig.slice(0, 10), secret), false, "longitud distinta");
assert.equal(verifyZernioSignature(raw, "zz", secret), false, "hex inválido");
assert.equal(verifyZernioSignature(raw, null, secret), false, "sin header");
assert.equal(verifyZernioSignature(raw, sig, ""), false, "fail-closed sin secreto");

console.log("verifyZernioSignature: 8/8 OK");
