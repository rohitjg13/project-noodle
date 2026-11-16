import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { user } from "./auth.schema";

export const batch = pgTable("batch", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const crAssignment = pgTable(
  "cr_assignment",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => batch.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (table) => [
    index("cr_assignment_batchId_idx").on(table.batchId),
    // One row per (CR, batch) — lets grants be written as a single conflict-free insert
    uniqueIndex("cr_assignment_user_batch_uniq").on(table.userId, table.batchId),
  ]
);

export const notification = pgTable('notification', {
  id: text('id').primaryKey(),
  toUserId: text('to_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  fromUserName: text('from_user_name').notNull(),
  courseCode: text('course_code').notNull(),
  message: text('message').notNull(),
  dismissed: boolean('dismissed').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [index('notification_toUserId_idx').on(table.toUserId)]);

export const batchRelations = relations(batch, ({ many }) => ({
  crAssignments: many(crAssignment),
}));

export const crAssignmentRelations = relations(crAssignment, ({ one }) => ({
  user: one(user, {
    fields: [crAssignment.userId],
    references: [user.id],
  }),
  batch: one(batch, {
    fields: [crAssignment.batchId],
    references: [batch.id],
  }),
}));
