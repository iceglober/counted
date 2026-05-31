import { requireProjectAccess } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";

export default async function EventsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const access = await requireProjectAccess(projectId);
  if (access.error) redirect("/login");

  const result = await pool.query(
    `SELECT event_name, session_id, os_name, locale, timestamp, props
     FROM events WHERE project_id = $1
     ORDER BY timestamp DESC LIMIT 100`,
    [projectId],
  );

  const events = result.rows;

  return (
    <div className="flex-1 min-w-0">
      <div className="mb-8">
        <h1 className="text-xl font-semibold">Events</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Last 100 events
        </p>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <p className="text-sm">No events yet. Install the SDK and send your first event.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-1 border-b border-border text-text-secondary text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Event</th>
                <th className="text-left px-4 py-3 font-medium">Session</th>
                <th className="text-left px-4 py-3 font-medium">OS</th>
                <th className="text-left px-4 py-3 font-medium">Locale</th>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Props</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-0 hover:bg-surface-1/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    {event.event_name}
                  </td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">
                    {event.session_id}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {event.os_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {event.locale ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-tertiary text-xs">
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-text-tertiary font-mono text-xs max-w-48 truncate">
                    {Object.keys(event.props).length > 0
                      ? JSON.stringify(event.props)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
