import { redirect, fail } from '@sveltejs/kit';
import { eq, inArray, like, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, batch, crAssignment } from '$lib/server/db/schema';
import type { PageServerLoad, Actions } from './$types';
import * as XLSX from 'xlsx';

const dataFiles = import.meta.glob('$lib/data/*.{xlsx,xls,csv}', {
	query: '?url',
	import: 'default',
	eager: true
});

async function syncBatchesFromXLSX(fetchFn: typeof fetch): Promise<void> {
	const filePaths = Object.keys(dataFiles);
	const targetFile =
		filePaths.find((f) => f.endsWith('.xlsx') || f.endsWith('.xls')) ||
		filePaths.find((f) => f.endsWith('.csv'));
	if (!targetFile) return;

	const url = dataFiles[targetFile] as string;
	const response = await fetchFn(url);
	if (!response.ok) return;

	const buffer = await response.arrayBuffer();
	const workbook = targetFile.endsWith('.csv')
		? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
		: XLSX.read(buffer, { type: 'array' });

	const worksheet = workbook.Sheets[workbook.SheetNames[0]];
	const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

	const batchSet = new Set<string>();
	for (const row of jsonData) {
		const keys = ['Batch', 'Major', 'Batches', 'Program'];
		for (const key of keys) {
			const val = row[key];
			if (val && String(val).trim() && String(val).trim() !== '-') {
				// Split by whitespace and/or commas — handles "ELC21 ELC22 ELC23 ELC24" and "CSE-A, CSE-B"
				String(val)
					.split(/[\s,]+/)
					.map((s) => s.trim())
					.filter((s) => s && s !== '-')
					.forEach((b) => batchSet.add(b));
				break;
			}
		}
	}

	if (batchSet.size === 0) return;

	// Remove stale "combined" batch rows (names containing a space) that have no CR assignments
	const combined = await db.select({ id: batch.id }).from(batch).where(like(batch.name, '% %'));
	if (combined.length > 0) {
		const combinedIds = combined.map((b) => b.id);
		const assignedCombined = await db
			.select({ batchId: crAssignment.batchId })
			.from(crAssignment)
			.where(inArray(crAssignment.batchId, combinedIds));
		const assignedIds = new Set(assignedCombined.map((r) => r.batchId));
		const safeToDelete = combinedIds.filter((id) => !assignedIds.has(id));
		if (safeToDelete.length > 0) {
			await db.delete(batch).where(inArray(batch.id, safeToDelete));
		}
	}

	const existing = await db.select({ name: batch.name }).from(batch);
	const existingNames = new Set(existing.map((b) => b.name.toLowerCase()));
	const toInsert = [...batchSet].filter((name) => !existingNames.has(name.toLowerCase()));

	if (toInsert.length > 0) {
		await db.insert(batch).values(toInsert.map((name) => ({ id: crypto.randomUUID(), name })));
	}
}

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.user) throw redirect(302, '/login');
	if (locals.user.role !== 'super_admin') throw redirect(302, '/');

	// Auto-sync batches from XLSX on every load
	await syncBatchesFromXLSX(fetch);

	const [batches, crs] = await Promise.all([
		db.select().from(batch).orderBy(batch.name),
		db
			.select({
				assignmentId: crAssignment.id,
				user: { id: user.id, name: user.name, email: user.email },
				batch: { id: batch.id, name: batch.name }
			})
			.from(crAssignment)
			.innerJoin(user, eq(crAssignment.userId, user.id))
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.orderBy(user.name)
	]);

	// Group CRs by user
	const crMap = new Map<string, { user: { id: string; name: string; email: string }; batches: { id: string; name: string; assignmentId: string }[] }>();
	for (const row of crs) {
		if (!crMap.has(row.user.id)) crMap.set(row.user.id, { user: row.user, batches: [] });
		crMap.get(row.user.id)!.batches.push({ ...row.batch, assignmentId: row.assignmentId });
	}

	return { batches, crs: [...crMap.values()] };
};

export const actions: Actions = {
	assignCr: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'super_admin') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const email = (data.get('email') as string)?.trim().toLowerCase();
		const batchIds = data.getAll('batchIds') as string[];

		if (!email || batchIds.length === 0) {
			return fail(400, { error: 'Email and at least one batch are required', action: 'assignCr' });
		}

		const [targetUser] = await db.select().from(user).where(eq(user.email, email)).limit(1);
		if (!targetUser) {
			return fail(404, {
				error: `No account found for ${email}. The user must log in at least once.`,
				action: 'assignCr'
			});
		}

		const validBatches = await db.select().from(batch).where(inArray(batch.id, batchIds));
		if (validBatches.length === 0) return fail(404, { error: 'No valid batches found', action: 'assignCr' });

		const existing = await db.select({ batchId: crAssignment.batchId }).from(crAssignment).where(eq(crAssignment.userId, targetUser.id));
		const existingBatchIds = new Set(existing.map((r) => r.batchId));
		const toInsert = validBatches.filter((b) => !existingBatchIds.has(b.id));

		if (toInsert.length > 0) {
			await db.insert(crAssignment).values(toInsert.map((b) => ({ id: crypto.randomUUID(), userId: targetUser.id, batchId: b.id })));
		}
		await db.update(user).set({ role: 'cr' }).where(eq(user.id, targetUser.id));

		return { success: true, action: 'assignCr', name: targetUser.name, batch: validBatches.map((b) => b.name).join(', ') };
	},

	removeCr: async ({ request, locals }) => {
		if (!locals.user || locals.user.role !== 'super_admin') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const assignmentId = data.get('assignmentId') as string;
		const userId = data.get('userId') as string;

		if (!assignmentId || !userId) return fail(400, { error: 'Invalid request', action: 'removeCr' });

		await db.delete(crAssignment).where(eq(crAssignment.id, assignmentId));

		const remaining = await db.select().from(crAssignment).where(eq(crAssignment.userId, userId)).limit(1);
		if (remaining.length === 0) {
			await db.update(user).set({ role: 'student' }).where(eq(user.id, userId));
		}

		return { success: true, action: 'removeCr' };
	}
};
