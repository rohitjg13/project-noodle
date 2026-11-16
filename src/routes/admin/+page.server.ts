import { redirect, fail } from '@sveltejs/kit';
import { and, eq, inArray, like, ne, notExists, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, batch, crAssignment, pendingCr } from '$lib/server/db/schema';
import { batchNames } from '$lib/server/timetable';
import type { PageServerLoad, Actions } from './$types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The batch table mirrors the batches named in the timetable sheet. The sheet is baked
// in at build time, so it can only differ from the table once per deploy — sync on the
// first admin page load of each server instance and never again.
let batchSync: Promise<void> | null = null;

function syncBatches(): Promise<void> {
	return (batchSync ??= runBatchSync().catch((err) => {
		batchSync = null; // let the next load retry
		throw err;
	}));
}

async function runBatchSync(): Promise<void> {
	if (batchNames.length === 0) return;

	// Remove stale "combined" batch rows (names containing a space) that nobody is CR of
	await db
		.delete(batch)
		.where(
			and(
				like(batch.name, '% %'),
				notExists(db.select({ id: crAssignment.id }).from(crAssignment).where(eq(crAssignment.batchId, batch.id)))
			)
		);

	const existing = await db.select({ name: batch.name }).from(batch);
	const have = new Set(existing.map((b) => b.name.toLowerCase()));
	const missing = batchNames.filter((name) => !have.has(name.toLowerCase()));
	if (missing.length > 0) {
		await db.insert(batch).values(missing.map((name) => ({ id: crypto.randomUUID(), name })));
	}
}

const isAdmin = (locals: App.Locals) => locals.user?.role === 'super_admin';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Form values for `name`, keeping only sane strings (a file upload is not a batch id) */
function ids(data: FormData, name: string): string[] {
	return [...new Set(data.getAll(name))].filter(
		(v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64
	);
}

// Holding a batch makes an account a CR and holding none makes it a student again — but
// never touch an admin's role: assigning an admin a batch must not demote them.
async function setRole(tx: Tx, userId: string, role: 'cr' | 'student') {
	await tx.update(user).set({ role }).where(and(eq(user.id, userId), ne(user.role, 'super_admin')));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'super_admin') throw redirect(302, '/');

	await syncBatches();

	const [batches, crs, invites] = await Promise.all([
		db.select({ id: batch.id, name: batch.name }).from(batch).orderBy(batch.name),
		db
			.select({
				assignmentId: crAssignment.id,
				user: { id: user.id, name: user.name, email: user.email },
				batch: { id: batch.id, name: batch.name }
			})
			.from(crAssignment)
			.innerJoin(user, eq(crAssignment.userId, user.id))
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.orderBy(user.name),
		db
			.select({ email: pendingCr.email, batchName: batch.name, batchId: pendingCr.batchId })
			.from(pendingCr)
			.innerJoin(batch, eq(pendingCr.batchId, batch.id))
			.orderBy(pendingCr.email)
	]);

	// Group invitations by email, same shape as the CR list
	const inviteMap = new Map<string, { email: string; batches: { id: string; name: string }[] }>();
	for (const row of invites) {
		if (!inviteMap.has(row.email)) inviteMap.set(row.email, { email: row.email, batches: [] });
		inviteMap.get(row.email)!.batches.push({ id: row.batchId, name: row.batchName });
	}

	// Group CRs by user
	const crMap = new Map<string, { user: { id: string; name: string; email: string }; batches: { id: string; name: string; assignmentId: string }[] }>();
	for (const row of crs) {
		if (!crMap.has(row.user.id)) crMap.set(row.user.id, { user: row.user, batches: [] });
		crMap.get(row.user.id)!.batches.push({ ...row.batch, assignmentId: row.assignmentId });
	}

	return { batches, crs: [...crMap.values()], invites: [...inviteMap.values()] };
};

export const actions: Actions = {
	assignCr: async ({ request, locals }) => {
		if (!isAdmin(locals)) return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const raw = data.get('email');
		const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
		const batchIds = ids(data, 'batchIds');

		if (!EMAIL.test(email) || email.length > 254 || batchIds.length === 0) {
			return fail(400, { error: 'A valid email and at least one batch are required', action: 'assignCr' });
		}

		const [validBatches, [targetUser]] = await Promise.all([
			db.select({ id: batch.id, name: batch.name }).from(batch).where(inArray(batch.id, batchIds)),
			db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email)).limit(1)
		]);
		if (validBatches.length === 0) return fail(404, { error: 'No valid batches found', action: 'assignCr' });
		const batchList = validBatches.map((b) => b.name).join(', ');

		// No account yet — park the grant until their first sign-in claims it
		if (!targetUser) {
			await db
				.insert(pendingCr)
				.values(validBatches.map((b) => ({ email, batchId: b.id, invitedBy: locals.user!.id })))
				.onConflictDoNothing();
			return { success: true, action: 'invite', name: email, batch: batchList };
		}

		await db.transaction(async (tx) => {
			await tx
				.insert(crAssignment)
				.values(validBatches.map((b) => ({ id: crypto.randomUUID(), userId: targetUser.id, batchId: b.id })))
				.onConflictDoNothing();
			await setRole(tx, targetUser.id, 'cr');
		});

		return { success: true, action: 'assignCr', name: targetUser.name, batch: batchList };
	},

	removeInvite: async ({ request, locals }) => {
		if (!isAdmin(locals)) return fail(403, { error: 'Forbidden' });

		const raw = (await request.formData()).get('email');
		const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
		if (!email) return fail(400, { error: 'Invalid request', action: 'removeInvite' });

		await db.delete(pendingCr).where(eq(pendingCr.email, email));
		return { success: true, action: 'removeInvite' };
	},

	setCrBatches: async ({ request, locals }) => {
		if (!isAdmin(locals)) return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const userId = data.get('userId');
		const batchIds = ids(data, 'batchIds');
		if (typeof userId !== 'string' || !userId) {
			return fail(400, { error: 'Invalid request', action: 'setCrBatches' });
		}

		const [[targetUser], valid] = await Promise.all([
			db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, userId)).limit(1),
			batchIds.length
				? db.select({ id: batch.id, name: batch.name }).from(batch).where(inArray(batch.id, batchIds))
				: []
		]);
		if (!targetUser) return fail(404, { error: 'That account no longer exists', action: 'setCrBatches' });
		// Ids were sent but none exist: a stale form, not a request to strip all access
		if (batchIds.length > 0 && valid.length === 0) {
			return fail(404, { error: 'No valid batches found', action: 'setCrBatches' });
		}
		const wanted = valid.map((b) => b.id);

		// Replace the set atomically: drop what's no longer wanted, add what's missing
		await db.transaction(async (tx) => {
			const mine = eq(crAssignment.userId, userId);
			await tx
				.delete(crAssignment)
				.where(wanted.length ? and(mine, notInArray(crAssignment.batchId, wanted)) : mine);
			if (wanted.length) {
				await tx
					.insert(crAssignment)
					.values(wanted.map((batchId) => ({ id: crypto.randomUUID(), userId, batchId })))
					.onConflictDoNothing();
			}
			// No batches left means no CR duties left
			await setRole(tx, userId, wanted.length === 0 ? 'student' : 'cr');
		});

		return {
			success: true,
			action: 'setCrBatches',
			name: targetUser.name,
			batch: valid.map((b) => b.name).join(', ')
		};
	},

	removeCr: async ({ request, locals }) => {
		if (!isAdmin(locals)) return fail(403, { error: 'Forbidden' });

		const assignmentId = (await request.formData()).get('assignmentId');
		if (typeof assignmentId !== 'string' || !assignmentId) {
			return fail(400, { error: 'Invalid request', action: 'removeCr' });
		}

		// Whose role to revisit comes from the row that was actually deleted, never from
		// a second form field that could name somebody else
		await db.transaction(async (tx) => {
			const [removed] = await tx
				.delete(crAssignment)
				.where(eq(crAssignment.id, assignmentId))
				.returning({ userId: crAssignment.userId });
			if (!removed) return;

			const [remaining] = await tx
				.select({ id: crAssignment.id })
				.from(crAssignment)
				.where(eq(crAssignment.userId, removed.userId))
				.limit(1);
			if (!remaining) await setRole(tx, removed.userId, 'student');
		});

		return { success: true, action: 'removeCr' };
	}
};
