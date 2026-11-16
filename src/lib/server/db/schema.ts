export * from './auth.schema';
export * from './app.schema';

import { pgTable, text, boolean, timestamp, index, uniqueIndex, serial, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './auth.schema';
import { batch } from './app.schema';

// Student preferences (minor + 3 ranked UWEs). One row per student — the unique index is
// what lets a save be a single upsert.
export const studentPreference = pgTable('student_preference', {
	id: serial('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	batch: text('batch'),
	minor: text('minor'),
	uwePref1: text('uwe_pref_1'),
	uwePref2: text('uwe_pref_2'),
	uwePref3: text('uwe_pref_3'),
	locked: boolean('locked').default(false).notNull(),
	submittedAt: timestamp('submitted_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
}, (table) => [uniqueIndex('student_preference_user_uniq').on(table.userId)]);

// CR access granted to an email that hasn't signed in yet. Claimed on that account's
// first request (see hooks.server.ts), which turns these into real cr_assignment rows.
export const pendingCr = pgTable('pending_cr', {
	id: serial('id').primaryKey(),
	email: text('email').notNull(),
	batchId: text('batch_id')
		.notNull()
		.references(() => batch.id, { onDelete: 'cascade' }),
	invitedBy: text('invited_by').references(() => user.id),
	createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
	index('pending_cr_email_idx').on(table.email),
	unique('pending_cr_email_batch_uniq').on(table.email, table.batchId)
]);

// Courses a CR has manually added to watch (searched from the timetable file).
// courseCode is the base code, e.g. "ECE204" — components are matched by prefix.
export const crCourse = pgTable('cr_course', {
	id: serial('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	courseCode: text('course_code').notNull(),
	courseName: text('course_name'),
	addedAt: timestamp('added_at').defaultNow().notNull()
}, (table) => [
	// "who else watches this course" — asked on every page load and every move
	index('cr_course_courseCode_idx').on(table.courseCode),
	unique('cr_course_user_code_uniq').on(table.userId, table.courseCode)
]);

// Schedule blocks: where a CR moved a weekly slot to. A slot is identified by
// courseCode + component + originalDay, and holds at most one saved position — the unique
// index is what makes a move a single atomic upsert.
export const scheduleBlock = pgTable('schedule_block', {
	id: serial('id').primaryKey(),
	courseCode: text('course_code').notNull(),
	courseName: text('course_name').notNull(),
	component: text('component').default('').notNull(),
	faculty: text('faculty'),
	room: text('room'),
	originalDay: text('original_day').notNull(),
	day: text('day').notNull(),
	startTime: text('start_time').notNull(),
	endTime: text('end_time').notNull(),
	batch: text('batch'),
	createdBy: text('created_by').references(() => user.id),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
}, (table) => [
	uniqueIndex('schedule_block_slot_uniq').on(table.courseCode, table.component, table.originalDay)
]);

// Professor constraints (unavailability windows)
export const professorConstraint = pgTable('professor_constraint', {
	id: serial('id').primaryKey(),
	professorName: text('professor_name').notNull(),
	day: text('day').notNull(),
	startTime: text('start_time'),
	endTime: text('end_time'),
	allDay: boolean('all_day').default(false).notNull(),
	reason: text('reason'),
	createdBy: text('created_by').references(() => user.id),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

// Relations
export const studentPreferenceRelations = relations(studentPreference, ({ one }) => ({
	user: one(user, { fields: [studentPreference.userId], references: [user.id] })
}));
export const crCourseRelations = relations(crCourse, ({ one }) => ({
	user: one(user, { fields: [crCourse.userId], references: [user.id] })
}));
