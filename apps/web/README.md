
## Public site and console hosts

This web service also serves the public site. `COUNTED_SITE_URL` defaults to
`https://counted.dev`; only its Host renders the public homepage at `/`.
With the default setting, `www.counted.dev` is also recognized. The console host
and ordinary localhost keep the signed-in workspace redirect. For local public
site review, explicitly set `COUNTED_SITE_URL=http://localhost:3000`.

`COUNTED_CONSOLE_URL` supplies sign-in links, and `COUNTED_DOCS_URL` defaults to
`https://docs.counted.dev`. `COUNTED_PUBLIC_API_URL` supplies the public API destination, separately from
the console’s potentially internal `COUNTED_API_URL`. These are deployment
destinations, not secrets.
The same service must retain both public and console domains. `/docs` and its
legacy HTML paths redirect to the docs service; the old docs `llms.txt` paths
remain readable. Public discovery includes `/llms.txt`, `/index.md`, `/auth.md`,
`/pricing.md`, `/.well-known/api-catalog`, `/robots.txt`, and `/sitemap.xml`.
Public pages do not call the account API or load an analytics tracker.
