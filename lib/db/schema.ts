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
import { relations, sql } from "drizzle-orm";

// ─── better-auth managed tables ────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ─── Organizations ─────────────────────────────────────────────────────────────

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

// ─── Billing ───────────────────────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }).unique(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── App tables ────────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  clientKey: text("client_key").unique(),
  serverKey: text("server_key").unique(),
  // Set for an anonymous (agent-provisioned) project until a user claims it.
  // While set, the project has no members; claiming clears it and adds an owner.
  claimToken: text("claim_token").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settings: jsonb("settings").notNull().default({}),
});

export const events = pgTable(
  "events",
  {
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
    // ISO 3166-1 alpha-2 country code derived from Cloudflare's CF-IPCountry
    // request header at ingest, then the request IP is discarded. Country-only,
    // never an IP — same privacy posture as the rest of the pipeline. Null when
    // absent (e.g. self-host without Cloudflare in front).
    countryCode: text("country_code"),
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
    // Owner (workspace-level). A dashboard is a view layer over data and is NOT
    // owned by a single project.
    userId: text("user_id").references(() => user.id),
    // Optional associated project — only used to source a client key for the
    // agent/onboarding setup card. Nullable: deleting a project orphans this
    // (sets it null); it does not delete the dashboard.
    projectId: uuid("project_id").references(() => projects.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    layout: jsonb("layout").notNull().default([]),
    filters: jsonb("filters").notNull().default({}),
    isDefault: boolean("is_default").default(false),
    shareToken: text("share_token").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dashboards_user_idx").on(table.userId),
    // At most one default dashboard per user, enforced at the storage layer.
    uniqueIndex("dashboards_one_default_per_user")
      .on(table.userId)
      .where(sql`${table.isDefault}`),
  ],
);

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    metric: text("metric").notNull(), // "count", "unique_sessions", or a custom property sum
    eventFilter: text("event_filter"), // event name to filter on (null = all events)
    condition: text("condition").notNull(), // "above" | "below"
    threshold: text("threshold").notNull(), // stored as text for precision
    window: text("window").notNull().default("1h"), // "1h", "24h", "7d", "30d"
    channels: jsonb("channels").notNull().default([]), // ["email"] or ["email", "slack"]
    slackWebhookUrl: text("slack_webhook_url"),
    enabled: boolean("enabled").notNull().default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    lastValue: text("last_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_alerts_project").on(table.projectId),
    index("idx_alerts_enabled").on(table.enabled),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role").notNull().default("member"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })],
);

// ─── Relations ─────────────────────────────────────────────────────────────────

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(user, {
    fields: [subscriptions.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(projectMembers),
  orgMemberships: many(member),
  subscription: one(subscriptions),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  project: one(projects, {
    fields: [alerts.projectId],
    references: [projects.id],
  }),
  creator: one(user, {
    fields: [alerts.createdBy],
    references: [user.id],
  }),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  events: many(events),
  dashboards: many(dashboards),
  members: many(projectMembers),
  alerts: many(alerts),
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
  user: one(user, {
    fields: [dashboards.userId],
    references: [user.id],
  }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [projectMembers.userId],
    references: [user.id],
  }),
}));
