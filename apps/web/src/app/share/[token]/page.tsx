import type { Metadata } from "next";
import { Tile, type Readout, type TileSpec } from "@/components/readout";
import { ShareControls } from "@/components/share-controls";
import { serverApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * A shared dashboard, read by whoever holds the link.
 *
 * **Zero database access, and zero token in the browser.** The token is a
 * credential: it is read from the path on the *server*, sent to the API as a
 * Bearer, and never written into the HTML, the props, or a client bundle. What
 * the browser holds is a URL — which it must, since that is the link — and
 * nothing that looks like a credential to any code running in it.
 *
 * Interactivity goes through `/bff/share/[token]/render`, a same-origin route
 * that re-reads the token from its own path. That is the one place a BFF is
 * genuinely required: without it, changing the time range would mean building
 * an `Authorization: Bearer st_…` header in page JavaScript.
 *
 * An expired, revoked or invented token renders as "not found" — never as
 * "forbidden", which would confirm that some token exists.
 */

export const metadata: Metadata = {
  // A shared link is not published. Belt and braces with the API's own
  // `X-Robots-Tag` and the `robots.txt` disallow: a crawler that ignores one
  // has to ignore three.
  robots: { index: false, follow: false, nocache: true },
  title: "Shared dashboard",
};

type SharedDashboard = { readonly name: string; readonly tiles: readonly TileSpec[] };
type SharedData = { readonly readouts: readonly Readout[]; readonly computedAt: string };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // No cookie forwarded. A signed-in visitor reading a shared link is still
  // only a share principal here — the link's scope is the link's, not theirs.
  const api = serverApi(null);

  let dashboard: SharedDashboard | null = null;
  let data: SharedData | null = null;
  let failure: string | null = null;

  try {
    dashboard = (await api<SharedDashboard>("getSharedDashboard", { bearer: token })).data;
    data = (await api<SharedData>("renderSharedDashboard", { bearer: token, body: {} })).data;
  } catch {
    // One outcome for expired, revoked and never-issued. Telling them apart
    // would let somebody test guessed tokens for existence.
    failure = "not_found";
  }

  if (dashboard === null || failure !== null) {
    return (
      <main>
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <h1>This link is not available</h1>
        <p className="tile-empty">
          It may have expired, or been revoked by whoever shared it. Ask them for a new one.
        </p>
      </main>
    );
  }

  const byId = new Map((data?.readouts ?? []).map((readout) => [readout.id, readout]));

  return (
    <main>
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <h1>{dashboard.name}</h1>
      <p className="tile-empty">Shared, read-only. Anyone with this link can see it.</p>

      <div className="grid">
        {dashboard.tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} readout={byId.get(tile.id)} />
        ))}
      </div>

      {/* Given no token. It reads its own path to reach the BFF. */}
      <ShareControls />
    </main>
  );
}
