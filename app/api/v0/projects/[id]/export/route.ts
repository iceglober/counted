import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth-guard";

const COLUMNS = [
  "event_name", "session_id", "timestamp", "os_name", "os_version",
  "locale", "app_version", "device_model", "sdk_version", "is_debug", "props",
];

const BATCH = 5000;

function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
  const str = String(val);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Read/scripting endpoint: session OR a server key (sk_) Bearer token.
  const access = await requireProjectAccess(id, { allowServerKey: true });
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") ?? "json";
  // Cursor bounds so exports can page to completion instead of hitting a fixed
  // 100K clamp. Rows stream newest-first (timestamp DESC). `before` = exclusive
  // upper bound; pass the last (oldest) timestamp from a page as `before` on the
  // next call to continue into older history. `after` = inclusive lower bound.
  const before = sp.get("before");
  const after = sp.get("after");
  const limitParam = sp.get("limit");
  const totalCap = limitParam ? Math.max(0, parseInt(limitParam, 10) || 0) : Infinity;

  async function* rowBatches() {
    let cursor: string | null = before;
    let emitted = 0;
    for (;;) {
      if (emitted >= totalCap) return;
      const conds = ["project_id = $1"];
      const args: unknown[] = [id];
      if (cursor) {
        args.push(cursor);
        conds.push(`timestamp < $${args.length}`);
      }
      if (after) {
        args.push(after);
        conds.push(`timestamp >= $${args.length}`);
      }
      const remaining = totalCap === Infinity ? BATCH : Math.min(BATCH, totalCap - emitted);
      args.push(remaining);
      const sql = `SELECT ${COLUMNS.join(", ")} FROM events
        WHERE ${conds.join(" AND ")}
        ORDER BY timestamp DESC LIMIT $${args.length}`;
      const res = await pool.query(sql, args);
      if (res.rows.length === 0) return;
      emitted += res.rows.length;
      yield res.rows;
      if (res.rows.length < remaining) return;
      const last = res.rows[res.rows.length - 1].timestamp;
      cursor = last instanceof Date ? last.toISOString() : String(last);
    }
  }

  const encoder = new TextEncoder();
  const isCsv = format === "csv";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (isCsv) {
          controller.enqueue(encoder.encode(COLUMNS.join(",") + "\n"));
          for await (const rows of rowBatches()) {
            const chunk = rows
              .map((row) => COLUMNS.map((h) => csvCell(row[h])).join(","))
              .join("\n") + "\n";
            controller.enqueue(encoder.encode(chunk));
          }
        } else {
          controller.enqueue(encoder.encode("["));
          let first = true;
          for await (const rows of rowBatches()) {
            for (const row of rows) {
              controller.enqueue(encoder.encode((first ? "" : ",") + JSON.stringify(row)));
              first = false;
            }
          }
          controller.enqueue(encoder.encode("]"));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": isCsv ? "text/csv" : "application/json",
      "Content-Disposition": `attachment; filename="events-export.${isCsv ? "csv" : "json"}"`,
    },
  });
}
