import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { notification } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

// GET - fetch undismissed notifications for current user
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const notes = await db
		.select()
		.from(notification)
		.where(and(eq(notification.toUserId, locals.user.id), eq(notification.dismissed, false)))
		.orderBy(notification.createdAt);

	return json({ notifications: notes });
};

// DELETE - dismiss a notification
export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { id } = await request.json();
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	await db
		.update(notification)
		.set({ dismissed: true })
		.where(and(eq(notification.id, id), eq(notification.toUserId, locals.user.id)));

	return json({ success: true });
};
