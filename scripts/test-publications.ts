import assert from "node:assert/strict";
import { isSlug, newSlug, normalizePhone, publicImages, publicLocation, publishBlockers, resolveBranding } from "../src/lib/publications/logic";

const branding = resolveBranding({ branding: { phone: "+54 9 341 785-7073", logoUrl: "javascript:alert(1)", colorId: "no-existe", email: "x" } });
assert.equal(branding.phone, "5493417857073");
assert.equal(branding.logoUrl, null, "un logo que no es https se descarta");
assert.equal(branding.colorId, null, "un color fuera de la paleta se descarta");
assert.equal(branding.email, null);
assert.equal(normalizePhone("123"), null);

const ok = { title: "Depto", price: 100000, status: "disponible", coverUrl: "https://x.com/a.jpg", galleryUrls: [], photos: [] };
assert.deepEqual(publishBlockers(ok, branding), []);
assert.ok(publishBlockers({ ...ok, price: null }, branding).length === 1, "sin precio no se publica");
assert.ok(publishBlockers({ ...ok, coverUrl: "http://x.com/a.jpg" }, branding).length === 1, "foto http no sirve");
assert.ok(publishBlockers({ ...ok, status: "vendida" }, branding).length === 1, "vendida no se publica");
assert.ok(publishBlockers(ok, resolveBranding({})).length === 1, "sin teléfono no se publica");

assert.deepEqual(publicImages({ coverUrl: "https://x.com/a.jpg", galleryUrls: ["https://x.com/a.jpg", "https://x.com/b.jpg"], photos: ["ftp://x/c"] }), ["https://x.com/a.jpg", "https://x.com/b.jpg"]);

const place = { zone: "Centro", city: "Rosario", addressPublic: "Córdoba 1200" };
assert.equal(publicLocation(place, false), "Centro, Rosario", "sin autorización no sale la dirección");
assert.equal(publicLocation(place, true), "Córdoba 1200 · Centro, Rosario");
assert.equal(publicLocation({ ...place, addressPublic: null }, true), "Centro, Rosario");

const a = newSlug();
assert.ok(isSlug(a) && a !== newSlug());
assert.ok(!isSlug("../etc"));

console.log("publications: OK");
