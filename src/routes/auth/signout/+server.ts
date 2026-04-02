import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	await auth.api.signOut({ headers: event.request.headers });
	// Clear the session cookie explicitly
	event.cookies.delete('better-auth.session_token', { path: '/' });
	event.cookies.delete('__Secure-better-auth.session_token', { path: '/' });
	throw redirect(302, '/login');
};
