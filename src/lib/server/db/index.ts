import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// In dev every hot reload re-evaluates this module; reuse the one pool instead of
// leaking a fresh set of connections each time until Postgres runs out.
const globalForDb = globalThis as { __noodleSql?: ReturnType<typeof postgres> };
const client = globalForDb.__noodleSql ?? postgres(env.DATABASE_URL);
if (dev) globalForDb.__noodleSql = client;

export const db = drizzle(client, { schema });
