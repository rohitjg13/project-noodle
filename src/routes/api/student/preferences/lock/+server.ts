import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference } from '$lib/server/db/schema';
import { user as userTable } from '$lib/server/db/auth.schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const { locked } = await request.json();

	// Lock/unlock ALL student preferences
	await db
		.update(studentPreference)
		.set({ locked: !!locked });

	return json({ success: true, locked: !!locked });
};
