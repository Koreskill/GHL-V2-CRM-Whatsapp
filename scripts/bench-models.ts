import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import OpenAI from "openai";
import { REPLY_SCHEMA, __parseReplyForTests as parseReply } from "../src/lib/agent/triage/generate";

/**
 * Compara modelos de redacción con el MISMO pedido que hace el bot: esquema estricto de
 * respuesta, prompt de tamaño real. Mide latencia, si el proveedor acepta el esquema y si la
 * respuesta se puede usar.
 *
 * Llama directo a OpenRouter (no pasa por la base): no deja rastros ni toca la cartera.
 *
 *   npx tsx scripts/bench-models.ts [modelo1 modelo2 ...]
 */

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ["openai/gpt-4.1-mini", "z-ai/glm-5.3-flash"];
const RUNS = 4;

const system = `Sos el asistente de una inmobiliaria y respondés por WhatsApp en español rioplatense (vos).
Las ÚNICAS propiedades que existen son las de "propiedades_ofrecidas". Para mostrar una, poné su clave en "mostrar".
No escribas precios ni metros en tu texto: van en la ficha. Breve: una a tres oraciones.`;

const user = JSON.stringify({
  lo_que_ya_sabemos: { operacion: "venta", zonas: ["Centro"], presupuesto_hasta: 80000, moneda: "USD" },
  propiedades_ofrecidas: [
    { clave: "P1", titulo: "Depto 2 dormitorios con balcón", operacion: "venta", precio: 65000, moneda: "USD", barrio: "Centro", dormitorios: 2 },
    { clave: "P2", titulo: "Departamento 2 Dormitorios", operacion: "venta", precio: 78000, moneda: "USD", barrio: "Centro", dormitorios: 2 },
    { clave: "P3", titulo: "Departamento 1 Dormitorio", operacion: "venta", precio: 54000, moneda: "USD", barrio: "Centro", dormitorios: 1 },
  ],
  conversacion_reciente: [{ de: "contacto", texto: "Busco un depto para comprar en el Centro, hasta 80 mil dólares" }],
}) + "\n\nÚLTIMO MENSAJE DEL CONTACTO:\nBusco un depto para comprar en el Centro, hasta 80 mil dólares";

async function main() {
  const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", timeout: 60_000, maxRetries: 0 });

  for (const model of MODELS) {
    const times: number[] = [];
    let ok = 0;
    const errors: string[] = [];

    for (let i = 0; i < RUNS; i++) {
      const t0 = Date.now();
      try {
        const res = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: { name: "respuesta_inmobiliaria", strict: true, schema: REPLY_SCHEMA } },
          temperature: 0.2,
        });
        times.push(Date.now() - t0);
        const parsed = parseReply(res.choices[0]?.message?.content ?? "");
        if (parsed && parsed.reply_text && parsed.mostrar.length) ok++;
        else errors.push(`respuesta no usable: ${(res.choices[0]?.message?.content ?? "").slice(0, 120)}`);
      } catch (err) {
        times.push(Date.now() - t0);
        errors.push(err instanceof Error ? err.message.slice(0, 160) : String(err));
      }
    }

    const sorted = [...times].sort((a, b) => a - b);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`\n${model}`);
    console.log(`  usables: ${ok}/${RUNS} · promedio ${avg} ms · min ${sorted[0]} ms · max ${sorted.at(-1)} ms`);
    for (const e of [...new Set(errors)]) console.log(`  ✗ ${e}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
