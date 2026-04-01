import { redirect, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, batch, crAssignment } from '$lib/server/db/schema';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	if (locals.user.role !== 'super_admin') {
		throw redirect(302, '/');
	}

	const [batches, crs] = await Promise.all([
		db.select().from(batch).orderBy(batch.createdAt),
		db
			.select({
				assignmentId: crAssignment.id,
				assignedAt: crAssignment.assignedAt,
				user: {
					id: user.id,
					name: user.name,
					email: user.email
				},
				batch: {
					id: batch.id,
					name: batch.name
				}
			})
			.from(crAssignment)
			.innerJoin(user, eq(crAssignment.userId, user.id))
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.orderBy(crAssignment.assignedAt)
	]);

	return { batches, crs };
};

export const actions: Actions = {
	createBatch: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'super_admin') {
			return fail(403, { error: 'Forbidden' });
		}

		const data = await request.formData();
		const name = (data.get('name') as string)?.trim();
		const description = (data.get('description') as string)?.trim() || null;

		if (!name) {
			return fail(400, { error: 'Batch name is required', action: 'createBatch' });
		}

		await db.insert(batch).values({
			id: crypto.randomUUID(),
			name,
			description
		});

		return { success: true, action: 'createBatch' };
	},

	assignCr: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'super_admin') {
			return fail(403, { error: 'Forbidden' });
		}

		const data = await request.formData();
		const email = (data.get('email') as string)?.trim().toLowerCase();
		const batchId = data.get('batchId') as string;

		if (!email || !batchId) {
			return fail(400, { error: 'Email and batch are required', action: 'assignCr' });
		}

		const [targetUser] = await db
			.select()
			.from(user)
			.where(eq(user.email, email))
			.limit(1);

		if (!targetUser) {
			return fail(404, {
				error: `No account found for ${email}. The user must log in at least once before being assigned as CR.`,
				action: 'assignCr'
			});
		}

		const [targetBatch] = await db
			.select()
			.from(batch)
			.where(eq(batch.id, batchId))
			.limit(1);

		if (!targetBatch) {
			return fail(404, { error: 'Batch not found', action: 'assignCr' });
		}

		// Update role to CR
		await db.update(user).set({ role: 'cr' }).where(eq(user.id, targetUser.id));

		// Create CR assignment
		await db.insert(crAssignment).values({
			id: crypto.randomUUID(),
			userId: targetUser.id,
			batchId
		});

		return { success: true, action: 'assignCr', name: targetUser.name, batch: targetBatch.name };
	},

	removeCr: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'super_admin') {
			return fail(403, { error: 'Forbidden' });
		}

		const data = await request.formData();
		const assignmentId = data.get('assignmentId') as string;
		const userId = data.get('userId') as string;

		if (!assignmentId || !userId) {
			return fail(400, { error: 'Invalid request', action: 'removeCr' });
		}

		// Remove the assignment
		await db.delete(crAssignment).where(eq(crAssignment.id, assignmentId));

		// Check if user has any remaining CR assignments; if not, revert to student
		const remaining = await db
			.select()
			.from(crAssignment)
			.where(eq(crAssignment.userId, userId))
			.limit(1);

		if (remaining.length === 0) {
			await db.update(user).set({ role: 'student' }).where(eq(user.id, userId));
		}

		return { success: true, action: 'removeCr' };
	}
};
