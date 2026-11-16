// Shared guards for the JSON API routes.
import { error } from '@sveltejs/kit';
import { eq, sql, type SQL } from 'drizzle-orm';
type AppUser = NonNullable<App.Locals['user']>;
import { db } from '$lib/server/db';
import { batch, crAssignment, studentPreference } from '$lib/server/db/schema';

/** Any signed-in account, or a 401 response */
export function requireUser(locals: App.Locals): AppUser {
	if (!locals.user) error(401, 'Unauthorized');
	return locals.user;
}

/** The signed-in CR or admin, or a 401/403 response */
export function requireManager(locals: App.Locals): AppUser {
	const user = requireUser(locals);
	if (user.role !== 'cr' && user.role !== 'super_admin') error(403, 'Forbidden');
	return user;
}

/** Request body as a plain object — malformed or non-object JSON is a 400, not a 500 */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'Invalid JSON body');
	return body as Record<string, unknown>;
}

/** A trimmed string field, or '' when it's missing, not a string, or too long */
export function str(value: unknown, max = 200): string {
	if (typeof value !== 'string') return '';
	const s = value.trim();
	return s.length <= max ? s : '';
}

/** Upper-cased names of the batches this user is CR of */
export async function managedBatches(userId: string): Promise<Set<string>> {
	const rows = await db
		.select({ name: batch.name })
		.from(crAssignment)
		.innerJoin(batch, eq(crAssignment.batchId, batch.id))
		.where(eq(crAssignment.userId, userId));
	return new Set(rows.map((r) => r.name.toUpperCase()));
}

/**
 * Condition: the student's batch list ("ECE21,ECE2YR") names one of `batches` (upper-cased,
 * non-empty). Whole tokens only — a CR of CSD31 must not pick up CSD311's students.
 */
export function prefInBatches(batches: Set<string>): SQL {
	const names = sql.join([...batches].map((b) => sql`${b}`), sql`, `);
	return sql`string_to_array(upper(replace(${studentPreference.batch}, ' ', '')), ',') && ARRAY[${names}]::text[]`;
}

// cyrb53 — a fast 53-bit string hash. Only used to tell "unchanged" from "changed" for
// conditional GETs, never for anything security-relevant.
function hash(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * JSON response a poller can revalidate: the client echoes the ETag back as
 * If-None-Match and gets an empty 304 while nothing has changed.
 */
export function revalidatedJson(request: Request, body: string, etag = `"${hash(body)}"`): Response {
	const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(body, {
		headers: { ...headers, 'Content-Type': 'application/json' }
	});
}
