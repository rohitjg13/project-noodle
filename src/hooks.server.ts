import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { svelteKitHandler } from 'better-auth/svelte-kit';

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
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
