# apps/web

The Counted console. A pure client of the public API.

There is no database driver here, no `DATABASE_URL`, and no import from
`@counted/domain`. If the UI can do it, the public API can do it — which is
only true for as long as the UI has no private path, so `src/lib/purity.test.ts`
checks it rather than trusting it.

## How it reaches the API

One client, in `src/lib/api.ts`, addressed by the `operationId` from the
committed OpenAPI contract. Paths, cache tags and invalidation all come from
`@counted/contracts`; nothing here maintains a second description of the API.

- **Browser** — `fetch(api.counted.dev, {credentials: "include"})`. The session
  cookie is set on the registrable domain, so `app.` reaching `api.` is
  same-site and `SameSite=Lax` permits it. No proxy hop.
- **Server components** — forward the incoming `Cookie` header verbatim.

## The one server-side exception

`/auth/callback` redeems a magic link and re-emits the API's own `Set-Cookie`.
It exists because arriving from a mail client is a top-level navigation, not a
script — nothing is running yet to make a `fetch`, and `Set-Cookie` on a
cross-origin redirect chain is fragile. It does not mint, parse or understand
the session; that would be a second implementation of auth.

## Environment

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_COUNTED_API_URL` | Where the browser calls the API. |
| `COUNTED_API_URL` | Where server components call it. Defaults to the public one. |
