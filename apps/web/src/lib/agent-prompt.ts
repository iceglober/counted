// The canonical "give this to your agent" prompt. Written to be followed by a
// weak model: explicit, ordered steps, no skipped reasoning. Shared by the
// marketing card and /docs/llms.txt so they never drift.
export const AGENT_PROMPT = `You are adding privacy-first product analytics to this project using Counted (app.counted.dev). Counted uses no cookies, no fingerprinting, and no PII — keep it that way. Work step by step and don't skip steps.

1. Understand the project. Read the README and enough of the codebase to answer: What does this product do? Who are its users — end users, developers, or businesses? How do they interact with it — web app, mobile app, API, CLI, or a library/SDK that other code imports? If it's a library, API, or SDK, the "users" are the developers and services that consume it, so plan to track adoption and usage, not page views.

2. Decide what to measure. Given who the users are and how they get value, list the 5–15 highest-signal events worth capturing — the moments that show someone activated, succeeded, converted, or hit friction. Examples: signup, onboarding_completed, <core_feature>_used, purchase, invite_sent, a failed/erroring action. Prefer activation and business milestones over noisy low-level events. For each event note the name, where in the code it should fire, and 1–3 safe properties that describe it (e.g. plan, amount, source).

3. Read the integration guide at https://app.counted.dev/docs/llms.txt for the exact SDK install command, the init snippet, and the event/property format. SDKs exist for JS/TS and React; for any other language use the plain HTTP wire contract in that guide (one POST per event — do not install Counted packages for other languages, they are not released yet).

4. Get a project key — no signup required. Run:
     curl -X POST https://app.counted.dev/api/v0/provision
   It returns clientKey (starts with ck_), claimUrl, and dashboardUrl. Put clientKey in an env var named COUNTED_KEY. Never hard-code it.

5. Instrument the code. Install the Counted SDK, initialize it once near startup with COUNTED_KEY, and add a track("<event>", { ...props }) call at each event from step 2. Strict rules:
   - Property values must be non-PII: ids, categories, amounts, booleans, enums. Never names, emails, raw user input, tokens, or full URLs with query strings.
   - Never block, await in a hot path, or break a user flow. Analytics must fail silently if the network is down.
   - Add no cookies and no fingerprinting.

6. Verify it's safe. Run the app or its tests, trigger a couple of the events, and confirm the app behaves exactly as before with no new errors.

7. Hand back. Give me the claimUrl from step 4 so I can open my live dashboard, plus a short list of every event you added and the file/line where it fires so I can confirm them. Events appear within ~10 seconds of running the app.`;
