import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, serverApi } from "@/lib/api";
import { Tile, type Readout, type TileSpec } from "@/components/readout";

export const dynamic = "force-dynamic";

type Dashboard = { readonly id: string; readonly name: string; readonly tiles: readonly TileSpec[] };
type DashboardData = { readonly readouts: readonly Readout[]; readonly computedAt: string };

/**
 * One dashboard.
 *
 * Two calls, deliberately: the dashboard's shape and its data are different
 * things with different lifetimes, and the definition renders even when every
 * query fails. That is the point — a board whose store is down should show its
 * tiles with errors in them, not a blank page.
 *
 * The data call is **one request for the whole board**. v1 looped over its
 * insights and awaited each in turn: 24 serialised round trips for a 24-tile
 * dashboard, against a pool shared with ingestion.
 */
export default async function DashboardPage({ params }: { params: Promise<{ dashboardId: string }> }) {
  const { dashboardId } = await params;
  const api = serverApi((await cookies()).toString() || null);

  try {
    const { data: dashboard } = await api<Dashboard>("getDashboard", { params: { dashboardId } });

    if (dashboard.tiles.length === 0) {
      return (
        <main>
          <h1>{dashboard.name}</h1>
          <p className="tile-empty">This dashboard has no tiles yet.</p>
        </main>
      );
    }

    // A failure here is the *whole board* failing, which is different from a
    // tile failing and must not be rendered as twelve tile errors.
    let data: DashboardData | null = null;
    let boardFailure: string | null = null;
    try {
      data = (await api<DashboardData>("renderDashboard", { params: { dashboardId }, body: {} })).data;
    } catch (error) {
      boardFailure = error instanceof ApiError ? error.message : "The dashboard could not be rendered.";
    }

    const byId = new Map((data?.readouts ?? []).map((readout) => [readout.id, readout]));

    return (
      <main>
        <h1>{dashboard.name}</h1>
        {boardFailure !== null && (
          <p className="tile-error" role="alert">
            {boardFailure}
          </p>
        )}
        <div className="grid">
          {dashboard.tiles.map((tile) => (
            <Tile key={tile.id} tile={tile} readout={byId.get(tile.id)} />
          ))}
        </div>
        {data !== null && (
          <p className="tile-empty">Computed {new Date(data.computedAt).toISOString()}</p>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) redirect("/sign-in");
    throw error;
  }
}
