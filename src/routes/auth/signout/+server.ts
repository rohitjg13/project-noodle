import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	event.cookies.delete('better-auth.session_token', { path: '/' });
	event.cookies.delete('__Secure-better-auth.session_token', { path: '/' });
	throw redirect(302, '/login');
};
