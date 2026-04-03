export * from './auth.schema';
export * from './app.schema';

import { pgTable, text, integer, boolean, timestamp, index, serial } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './auth.schema';

// Student preferences (minor + 3 ranked UWEs)
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
}, (table) => [index('pref_userId_idx').on(table.userId)]);

// Schedule blocks (timetable positions, modifiable by CR)
export const scheduleBlock = pgTable('schedule_block', {
	id: serial('id').primaryKey(),
	courseCode: text('course_code').notNull(),
	courseName: text('course_name').notNull(),
	component: text('component'),
	faculty: text('faculty'),
	room: text('room'),
	originalDay: text('original_day'),
	day: text('day').notNull(),
	startTime: text('start_time').notNull(),
	endTime: text('end_time').notNull(),
	batch: text('batch'),
	createdBy: text('created_by').references(() => user.id),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

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
