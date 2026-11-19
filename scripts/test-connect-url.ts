import assert from "node:assert/strict";
import { isAllowedConnectUrl } from "../src/lib/zernio/connect-url";

// Lo que Zernio devuelve de verdad (verificado contra la API).
assert.equal(isAllowedConnectUrl("https://www.instagram.com/oauth/authorize?client_id=1&state=x", "instagram"), true);
assert.equal(isAllowedConnectUrl("https://www.facebook.com/v24.0/dialog/oauth?client_id=1", "facebook"), true);
assert.equal(isAllowedConnectUrl("https://zernio.com/connect/whatsapp/embedded-signup?x=1", "whatsapp"), true);
assert.equal(isAllowedConnectUrl("https://business.facebook.com/messaging/whatsapp/onboard/", "whatsapp"), true);

// Lo que nunca se acepta.
for (const bad of [
  "http://www.instagram.com/oauth/authorize", // no https
  "javascript:alert(1)",
  "https://evil.test/oauth/authorize",
  "https://instagram.com.evil.test/oauth/authorize", // dominio que solo empieza igual
  "https://evilinstagram.com/oauth/authorize", // termina igual pero no es subdominio
  "https://www.instagram.com@evil.test/oauth", // usuario en la URL
  "https://www.instagram.com:8443/oauth", // puerto
  "//www.instagram.com/oauth",
  "",
  "no es una url",
]) {
  assert.equal(isAllowedConnectUrl(bad, "instagram"), false, bad);
}
assert.equal(isAllowedConnectUrl(null, "instagram"), false);
assert.equal(isAllowedConnectUrl(undefined, "facebook"), false);

console.log("connect-url: OK");
