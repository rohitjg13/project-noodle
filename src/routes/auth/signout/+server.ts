import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';

// POST only: a GET sign-out can be triggered by any page embedding the URL in an <img>.
// SvelteKit's origin check covers the form post. The session row is revoked server-side
// — clearing the cookie alone would leave a copied token valid until it expired.
export const POST: RequestHandler = async (event) => {
	try {
		await auth.api.signOut({ headers: event.request.headers });
	} catch {
		// No valid session to revoke — still clear whatever cookie the browser holds
	}
	for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token']) {
		event.cookies.delete(name, { path: '/' });
	}
	redirect(303, '/login');
};
