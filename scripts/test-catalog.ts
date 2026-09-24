import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { parseCsv, parseSpreadsheetRef } from "../src/lib/sheets/client";
import {
  buildTemplateComponents,
  renderTemplatePreview,
  templateButtons,
  templateFooter,
  templateHeader,
  validateTemplateParams,
} from "../src/lib/zernio/templates";

// Pruebas sin base: parseo de la hoja y composición de plantillas.

// ─── CSV ────────────────────────────────────────────────────────────────────
// Una descripción con comas y saltos de línea entre comillas es lo normal en una hoja de
// propiedades: si el parseo se hace con split(","), la fila se corre y los datos se mezclan.
{
  const csv = 'property_id,titulo,descripcion\nP1,"Depto, 2 amb","Luminoso.\nCon balcón"\nP2,Casa,Simple';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3, "encabezado + 2 filas");
  assert.deepEqual(rows[0], ["property_id", "titulo", "descripcion"]);
  assert.equal(rows[1][1], "Depto, 2 amb", "la coma dentro de comillas no parte la celda");
  assert.equal(rows[1][2], "Luminoso.\nCon balcón", "el salto de línea dentro de comillas se conserva");
  assert.equal(rows[2][1], "Casa");
}
{
  // Comilla escapada ("") dentro de una celda entrecomillada.
  const rows = parseCsv('a,b\n"El ""Palacio""",x');
  assert.equal(rows[1][0], 'El "Palacio"');
}

// ─── Referencia a la hoja ───────────────────────────────────────────────────
{
  const full = parseSpreadsheetRef("https://docs.google.com/spreadsheets/d/1AbC-dEf_GhIjKlMnOpQrStUvWxYz/edit#gid=123");
  assert.equal(full?.spreadsheetId, "1AbC-dEf_GhIjKlMnOpQrStUvWxYz");
  assert.equal(full?.gid, "123");

  const bare = parseSpreadsheetRef("1AbC-dEf_GhIjKlMnOpQrStUvWxYz");
  assert.equal(bare?.spreadsheetId, "1AbC-dEf_GhIjKlMnOpQrStUvWxYz");
  assert.equal(bare?.gid, null);

  assert.equal(parseSpreadsheetRef("no es una hoja"), null);
  assert.equal(parseSpreadsheetRef(""), null);
}

// ─── Composición de plantillas ──────────────────────────────────────────────
{
  const components = buildTemplateComponents({
    body: "Hola {{1}}, ¿seguís interesado en {{2}}?",
    bodyExamples: ["Juan", "el depto de Palermo"],
    header: { format: "text", text: "Novedades de {{1}}", example: "Palermo" },
    footer: "Respondé BAJA para no recibir más mensajes",
    buttons: [
      { type: "quick_reply", text: "Sí, contame" },
      { type: "url", text: "Ver ficha", url: "https://ejemplo.com/p/1" },
      { type: "phone_number", text: "Llamar", phoneNumber: "+5491100000000" },
    ],
  });

  // El orden importa: Meta muestra los componentes en el orden en que se mandan.
  assert.deepEqual(
    components.map((c) => c.type),
    ["header", "body", "footer", "buttons"],
  );

  const header = components[0] as Record<string, unknown>;
  assert.equal(header.format, "text");
  assert.deepEqual(header.example, { header_text: ["Palermo"] });

  const body = components[1] as Record<string, unknown>;
  // body_text es un array de arrays: es lo que espera la API, no un array plano.
  assert.deepEqual(body.example, { body_text: [["Juan", "el depto de Palermo"]] });

  const buttons = (components[3] as { buttons: Record<string, unknown>[] }).buttons;
  assert.equal(buttons.length, 3);
  assert.equal(buttons[1].url, "https://ejemplo.com/p/1");
  assert.equal(buttons[2].phone_number, "+5491100000000");
  assert.equal(buttons[0].url, undefined, "una respuesta rápida no lleva url");
}
{
  // Sin variables no se manda `example`: mandarlo vacío hace que Meta rechace la plantilla.
  const components = buildTemplateComponents({ body: "Gracias por escribirnos.", bodyExamples: [] });
  assert.equal(components.length, 1);
  assert.equal((components[0] as Record<string, unknown>).example, undefined);
}
{
  // Header de media: el ejemplo va como header_handle, no como header_text.
  const [header] = buildTemplateComponents({
    body: "x",
    bodyExamples: [],
    header: { format: "image", example: "https://ejemplo.com/foto.jpg" },
  });
  assert.deepEqual((header as Record<string, unknown>).example, {
    header_handle: ["https://ejemplo.com/foto.jpg"],
  });
}

// ─── Lectura de una plantilla aprobada ──────────────────────────────────────
{
  // Meta devuelve los tipos en MAYÚSCULAS: la lectura no puede asumir minúsculas.
  const approved = {
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "Hola {{1}}, tu visita es el {{2}}." },
      { type: "FOOTER", text: "Equipo Kore" },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://ejemplo.com" }] },
    ],
  };

  assert.equal(templateHeader(approved)?.format, "image");
  assert.equal(templateFooter(approved), "Equipo Kore");
  assert.equal(templateButtons(approved)[0].url, "https://ejemplo.com");

  const preview = renderTemplatePreview(approved, ["Ana", "martes a las 15"]);
  assert.equal(preview.body, "Hola Ana, tu visita es el martes a las 15.");
  assert.equal(preview.footer, "Equipo Kore");
  assert.equal(preview.buttons.length, 1);

  // Variables sin resolver: hay que avisar, no mandar el mensaje con un hueco.
  assert.equal(validateTemplateParams(approved, ["Ana", "martes"]), null);
  assert.match(validateTemplateParams(approved, ["Ana", ""]) ?? "", /\{\{2\}\}/);
  assert.match(validateTemplateParams(approved, ["Ana", "   "]) ?? "", /\{\{2\}\}/, "un espacio no es un dato");
  assert.match(validateTemplateParams(approved, []) ?? "", /\{\{1\}\}/);
}

console.log("catalog+templates: OK");
