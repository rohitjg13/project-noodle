import { error, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
import { sequence } from '@sveltejs/kit/hooks';
import { and, eq, ne } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user as userTable, pendingCr, crAssignment } from '$lib/server/db/schema';
import { svelteKitHandler } from 'better-auth/svelte-kit';

// An admin can grant CR access to an email before that person has ever signed in. The
// invitation sits in pending_cr until their first request, which is here: the rows become
// real assignments and the account is promoted. Every student is a candidate, so this only
// runs on page requests (not the API polls) and looks before it opens a transaction — one
// indexed read per student page load, and nothing for CRs and admins.
//
// DELETE … RETURNING is the claim: when two first requests race, only one of them gets
// the rows back, so the grant is applied exactly once.
async function claimPendingCr(u: NonNullable<App.Locals['user']>): Promise<void> {
	// The invite is addressed to an email, so only a proven owner of that address may claim it
	if (!u.emailVerified) return;
	const email = u.email.toLowerCase();

	const [invited] = await db
		.select({ id: pendingCr.id })
		.from(pendingCr)
		.where(eq(pendingCr.email, email))
		.limit(1);
	if (!invited) return;

	const claimed = await db.transaction(async (tx) => {
		const invites = await tx
			.delete(pendingCr)
			.where(eq(pendingCr.email, email))
			.returning({ batchId: pendingCr.batchId });
		if (invites.length === 0) return false;

		await tx
			.insert(crAssignment)
			.values(invites.map((i) => ({ id: crypto.randomUUID(), userId: u.id, batchId: i.batchId })))
			.onConflictDoNothing();
		await tx
			.update(userTable)
			.set({ role: 'cr' })
			.where(and(eq(userTable.id, u.id), ne(userTable.role, 'super_admin')));
		return true;
	});

	// Reflect it on this same request, so the page they land on is already the CR view
	if (claimed) u.role = 'cr';
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		// Better Auth minimal build may not pass through extra columns like `role`.
		// Fall back to a direct DB lookup to ensure we always have the full user row.
		const role = (session.user as Record<string, unknown>).role;
		if (role !== undefined) {
			event.locals.user = session.user as App.Locals['user'];
		} else {
			const [fullUser] = await db
				.select()
				.from(userTable)
				.where(eq(userTable.id, session.user.id))
				.limit(1);
			event.locals.user = fullUser as App.Locals['user'];
		}
		event.locals.session = session.session;

		if (event.locals.user?.role === 'student' && !event.url.pathname.startsWith('/api/')) {
			await claimPendingCr(event.locals.user);
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

// SvelteKit's built-in CSRF check only looks at form-encoded bodies. The JSON API is
// written to with fetch, so make the rule explicit for everything: a state-changing
// request that names an Origin must name ours. (Browsers always send Origin on
// cross-site writes; SameSite=Lax session cookies are the first line, this is the second.)
const sameOriginWrites: Handle = ({ event, resolve }) => {
	const { method, headers } = event.request;
	if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
		const origin = headers.get('origin');
		if (origin && origin !== event.url.origin && origin !== env.ORIGIN) {
			error(403, 'Cross-site request blocked');
		}
	}
	return resolve(event);
};

// Baseline hardening for every response. The Content-Security-Policy itself is set in
// svelte.config.js, where SvelteKit can add the nonces for its own inline scripts.
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const h = response.headers;
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
	h.set('Cross-Origin-Opener-Policy', 'same-origin');
	if (event.url.protocol === 'https:') {
		h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	}
	// Everything outside the hashed build assets is per-user — keep it out of shared caches
	if (!h.has('Cache-Control')) h.set('Cache-Control', 'private, no-store');
	return response;
};

export const handle: Handle = sequence(securityHeaders, sameOriginWrites, handleBetterAuth);
