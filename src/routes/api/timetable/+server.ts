import type { RequestHandler } from './$types';
import { requireUser, revalidatedJson } from '$lib/server/api';
import { timetableEtag, timetableJson } from '$lib/server/timetable';

// GET /api/timetable — the full course catalogue. Parsed at build time and serialised
// once, so this is a memcpy; the ETag only changes when the sheet does, so repeat visits
// cost an empty 304.
export const GET: RequestHandler = ({ locals, request }) => {
	requireUser(locals);
	return revalidatedJson(request, timetableJson, timetableEtag);
};
