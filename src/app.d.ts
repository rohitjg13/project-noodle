import type { Session } from 'better-auth/minimal';

export type UserRole = 'student' | 'cr' | 'super_admin';

export interface AppUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image?: string | null;
	role: UserRole;
	createdAt: Date;
	updatedAt: Date;
}

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: AppUser;
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
