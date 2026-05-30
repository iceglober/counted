import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settings: jsonb("settings").notNull().default({}),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    sessionId: text("session_id").notNull(),
    eventName: text("event_name").notNull(),
    osName: text("os_name"),
    osVersion: text("os_version"),
    locale: text("locale"),
    appVersion: text("app_version"),
    deviceModel: text("device_model"),
    isDebug: boolean("is_debug").default(false),
    sdkVersion: text("sdk_version"),
    props: jsonb("props").notNull().default({}),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_events_project_time").on(table.projectId, table.timestamp),
    index("idx_events_project_name").on(
      table.projectId,
      table.eventName,
      table.timestamp,
    ),
    index("idx_events_session").on(table.projectId, table.sessionId),
  ],
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    layout: jsonb("layout").notNull().default([]),
    filters: jsonb("filters").notNull().default({}),
    isDefault: boolean("is_default").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dashboards_project_slug").on(table.projectId, table.slug),
  ],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("member"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })],
);

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// Relations

export const projectsRelations = relations(projects, ({ many }) => ({
  events: many(events),
  dashboards: many(dashboards),
  members: many(projectMembers),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  project: one(projects, {
    fields: [events.projectId],
    references: [projects.id],
  }),
}));

export const dashboardsRelations = relations(dashboards, ({ one }) => ({
  project: one(projects, {
    fields: [dashboards.projectId],
    references: [projects.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(projectMembers),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));
