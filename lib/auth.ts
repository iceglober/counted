import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import * as schema from "./db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      enabled: !!process.env.GITHUB_CLIENT_ID,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      enabled: !!process.env.GOOGLE_CLIENT_ID,
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Dev shortcut: no email round-trip locally — the link prints to the
        // server console; open it to sign in as any address. Never in prod.
        if (process.env.NODE_ENV !== "production") {
          console.log(`\n[auth] Magic link for ${email}:\n${url}\n`);
          return;
        }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM ?? "Counted <onboarding@resend.dev>",
            to: email,
            subject: "Your login link for Counted",
            text: `Click here to log in to Counted:\n\n${url}\n\nThis link expires in 5 minutes.`,
          }),
        });
        if (!res.ok) {
          console.error(`[auth] Failed to send magic link (${res.status})`);
        }
      },
    }),
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
    }),
    nextCookies(),
  ],
});
