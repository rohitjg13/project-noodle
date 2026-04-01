import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const prefs = await db
		.select()
		.from(studentPreference)
		.where(eq(studentPreference.userId, locals.user.id))
		.limit(1);

	return json({ preference: prefs[0] ?? null });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { minor, uwePref1, uwePref2, uwePref3 } = body;

	// Validate no duplicate UWE preferences
	const uweChoices = [uwePref1, uwePref2, uwePref3].filter(Boolean);
	if (new Set(uweChoices).size !== uweChoices.length) {
		return json({ error: 'Duplicate UWE preferences not allowed' }, { status: 400 });
	}

	// Check if already submitted and locked
	const existing = await db
		.select()
		.from(studentPreference)
		.where(eq(studentPreference.userId, locals.user.id))
		.limit(1);

	if (existing[0]?.locked) {
		return json({ error: 'Preferences are locked' }, { status: 403 });
	}

	if (existing[0]) {
		await db
			.update(studentPreference)
			.set({ minor, uwePref1, uwePref2, uwePref3 })
			.where(eq(studentPreference.userId, locals.user.id));
	} else {
		await db.insert(studentPreference).values({
			userId: locals.user.id,
			minor,
			uwePref1,
			uwePref2,
			uwePref3,
			locked: false
		});
	}

	return json({ success: true });
};
