import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { notification } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { readJson, revalidatedJson, str } from '$lib/server/api';

// GET — undismissed notifications for the current user. Polled, so it revalidates.
export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const notifications = await db
		.select({
			id: notification.id,
			fromUserName: notification.fromUserName,
			courseCode: notification.courseCode,
			message: notification.message,
			createdAt: notification.createdAt
		})
		.from(notification)
		.where(and(eq(notification.toUserId, locals.user.id), eq(notification.dismissed, false)))
		.orderBy(notification.createdAt);

	return revalidatedJson(request, JSON.stringify({ notifications }));
};

// DELETE — dismiss one of the current user's notifications
export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const id = str((await readJson(request)).id, 64);
	if (!id) error(400, 'Missing id');

	await db
		.update(notification)
		.set({ dismissed: true })
		.where(and(eq(notification.id, id), eq(notification.toUserId, locals.user.id)));

	return json({ success: true });
};
