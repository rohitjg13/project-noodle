import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null };
	const { id, name, email, role } = locals.user;
	return { user: { id, name, email, role } };
};
