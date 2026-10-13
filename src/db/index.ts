import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbExecutor = Db | Tx;

const globalForDb = globalThis as unknown as { db?: Db; dbScope?: AsyncLocalStorage<Db> };

// Contexto de ejecución del Laboratorio: SOLO el código que corre dentro de `runInSandbox` (y lo que
// éste espere) ve la transacción de pruebas. Otra request del mismo proceso, p. ej. un webhook real
// llegando en ese momento, sigue usando la conexión normal. No se reemplaza la conexión global.
const scope = (globalForDb.dbScope ??= new AsyncLocalStorage<Db>());

/** Conexión normal, ignorando cualquier sandbox. Para registrar resultados del propio Laboratorio. */
export function getRootDb(): Db {
  if (globalForDb.db) return globalForDb.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  // prepare: false es obligatorio con el pooler de Supabase en modo transacción.
  // Tope y tiempos explícitos: sin ellos una ráfaga (o una corrida del Laboratorio con la transacción abierta)
  // puede agotar las conexiones y demorar los webhooks reales.
  const max = Number(process.env.DB_POOL_MAX) > 0 ? Number(process.env.DB_POOL_MAX) : 10;
  globalForDb.db = drizzle({ client: postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 10 }), schema });
  return globalForDb.db;
}

export function getDb(): Db {
  return scope.getStore() ?? getRootDb();
}

const ROLLBACK = Symbol("sandbox_rollback");

/**
 * Corre `fn` dentro de una transacción que SIEMPRE se revierte, visible solo para este contexto
 * asíncrono. Devuelve lo que `fn` devolvió. Nada de lo que escriba queda en la base.
 */
export async function runInSandbox<T>(fn: () => Promise<T>): Promise<T> {
  let out!: T;
  try {
    await getRootDb().transaction(async (tx) => {
      out = await scope.run(tx as unknown as Db, fn);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return out;
}

export { schema };
