import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../src/lib/crypto/secrets";
import { parseHttpsUrl, verifyCalSignature } from "../src/lib/calendar/integration";
import { wallTimeToDate } from "../src/lib/tz";

// Cifrado de secretos: ida y vuelta, valores distintos cada vez, y lo alterado no descifra.
process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const enc = encryptSecret("cal_live_abc123");
assert.notEqual(enc, encryptSecret("cal_live_abc123"), "el IV es aleatorio");
assert.ok(!enc.includes("cal_live"), "el secreto no queda en claro");
assert.equal(decryptSecret(enc), "cal_live_abc123");
const parts = enc.split(":");
parts[3] = Buffer.from("otra cosa").toString("base64");
assert.equal(decryptSecret(parts.join(":")), null, "un valor alterado no descifra");
process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
assert.equal(decryptSecret(enc), null, "con otra clave no descifra");
delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
assert.equal(decryptSecret(enc), null, "sin clave no descifra");
assert.throws(() => encryptSecret("x"), /INTEGRATIONS_ENCRYPTION_KEY/);

// Firma del webhook de Cal.com: sobre el body crudo, sin secreto rechaza todo.
const body = JSON.stringify({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "abc" } });
const good = createHmac("sha256", "s3cret").update(body).digest("hex");
assert.equal(verifyCalSignature(body, good, "s3cret"), true);
assert.equal(verifyCalSignature(body + " ", good, "s3cret"), false, "re-serializar rompe la firma");
assert.equal(verifyCalSignature(body, good, "otro"), false);
assert.equal(verifyCalSignature(body, good, null), false, "sin secreto configurado, rechaza");
assert.equal(verifyCalSignature(body, "abc", "s3cret"), false, "largo distinto no revienta");
assert.equal(verifyCalSignature(body, null, "s3cret"), false);

// Horas de pared: 15:30 en Argentina (UTC-3) es 18:30Z, sin importar la zona del servidor.
assert.equal(wallTimeToDate("2026-09-30T15:30")?.toISOString(), "2026-09-30T18:30:00.000Z");
assert.equal(wallTimeToDate("2026-09-30T15:30", "UTC")?.toISOString(), "2026-09-30T15:30:00.000Z");
assert.equal(wallTimeToDate("2026-02-31T10:00"), null, "31 de febrero no existe");
assert.equal(wallTimeToDate("mañana"), null);
assert.equal(wallTimeToDate("2026-09-30T18:30:00Z")?.toISOString(), "2026-09-30T18:30:00.000Z", "un instante con zona se respeta");

// El enlace de la agenda termina en un iframe: solo https.
assert.equal(parseHttpsUrl("javascript:alert(1)"), null);
assert.equal(parseHttpsUrl("http://cal.com/x"), null);
assert.ok(parseHttpsUrl("https://cal.com/x"));

console.log("calendar: OK");
