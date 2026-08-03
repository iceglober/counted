"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";

/**
 * Make a dashboard.
 *
 * `POST /v1/workspaces/{id}/dashboards` has existed since the API shipped and
 * had no caller, so the console could list dashboards and never create one —
 * the empty state said "Create one to start asking questions" next to nothing
 * that could.
 *
 * A name and a button, no modal. The dashboard is empty either way; anything
 * more asked at this point would be asking before there is anything to decide
 * about.
 */
export const CreateDashboard = ({ workspaceId }: { workspaceId: string }) => {
  const [state, setState] = useState<"idle" | "creating" | "failed">("idle");

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (name === "") return;

    setState("creating");
    try {
      const { data } = await browserApi()<{ id: string }>("createDashboard", {
        params: { workspaceId },
        body: { name },
      });
      // A full navigation rather than a router push: the new dashboard is a
      // server-rendered page and this is the one moment its data is certain to
      // be fresh.
      window.location.href = `/dashboards/${data.id}`;
    } catch {
      setState("failed");
    }
  };

  return (
    <form onSubmit={create} className="field">
      <label htmlFor="dashboard-name">New dashboard</label>
      <input id="dashboard-name" name="name" placeholder="Weekly review" maxLength={100} required />
      <button type="submit" disabled={state === "creating"}>
        {state === "creating" ? "Creating…" : "Create"}
      </button>
      {state === "failed" && (
        <p className="tile-error" role="alert">
          That dashboard could not be created. Try again.
        </p>
      )}
    </form>
  );
};
