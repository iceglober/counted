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
        // No email round-trip when running locally OR when no Resend key is
        // configured (e.g. a keyless self-host): the link prints to the server
        // console — open it to sign in. Cloud sets RESEND_API_KEY, so it always
        // emails. Without this, keyless prod builds send "Bearer undefined" to
        // Resend and 401, while the UI falsely reports "Check your email".
        if (process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY) {
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
          // Throw so better-auth surfaces the failure to the caller — the
          // /login and claim pages then show a real error instead of a false
          // "Check your email" success.
          console.error(`[auth] Failed to send magic link (${res.status})`);
          throw new Error(`Failed to send magic link (${res.status})`);
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
