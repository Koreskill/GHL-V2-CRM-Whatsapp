import assert from "node:assert/strict";
import { hostAllowed, normalizeHost, requestOrigin, trustedOriginFromHeaders } from "../src/lib/request-origin";

// El valor de ALLOWED_HOSTS se escribe a mano: todas estas formas deben quedar en el dominio.
for (const v of ["cowin.estudiantehibrido.com", "https://cowin.estudiantehibrido.com/", "https//cowin.estudiantehibrido.com/", "HTTP://Cowin.EstudianteHibrido.com", " cowin.estudiantehibrido.com/login "]) {
  assert.equal(normalizeHost(v), "cowin.estudiantehibrido.com", v);
}
assert.equal(normalizeHost("httpsfoo.com"), "httpsfoo.com"); // "https" dentro de un nombre no es esquema
assert.equal(normalizeHost("localhost:3000"), "localhost:3000");

process.env.ALLOWED_HOSTS = "https//cowin.estudiantehibrido.com/";
assert.equal(hostAllowed("cowin.estudiantehibrido.com"), true);
assert.equal(hostAllowed("otro.test"), false);

// Host del request correcto: no cambia nada.
const ok = new Request("http://0.0.0.0:3000/auth/callback", { headers: { "x-forwarded-host": "cowin.estudiantehibrido.com", "x-forwarded-proto": "https" } });
assert.equal(requestOrigin(ok), "https://cowin.estudiantehibrido.com");

// Host falsificado: se ignora y se usa el de la lista, bien armado (antes salía "https://https//...").
const fake = new Request("http://0.0.0.0:3000/auth/callback", { headers: { "x-forwarded-host": "atacante.test", "x-forwarded-proto": "https" } });
assert.equal(requestOrigin(fake), "https://cowin.estudiantehibrido.com");
assert.equal(trustedOriginFromHeaders(new Headers({ "x-forwarded-host": "atacante.test" })), "https://cowin.estudiantehibrido.com");

// Sin la variable, el host sale del request, como siempre.
delete process.env.ALLOWED_HOSTS;
assert.equal(requestOrigin(fake), "https://atacante.test");

console.log("request-origin: OK");
