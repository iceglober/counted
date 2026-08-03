"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";

/**
 * The project's name, editable in place.
 *
 * Provision now suggests a name rather than calling everything "Untitled
 * project", which makes the first screen look finished — but a suggested name
 * is only tolerable if changing it is obvious and immediate. Otherwise it is
 * just a nicer placeholder somebody is stuck with.
 *
 * In place rather than on a settings page: the name is the page's heading, and
 * making someone navigate elsewhere to change the thing they are looking at is
 * the pattern this console is trying not to have.
 *
 * The heading stays an `h1` in both states — the document outline should not
 * change because a field opened.
 */
export const ProjectName = ({ projectId, name }: { projectId: string; name: string }) => {
  const [current, setCurrent] = useState(name);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get("name") ?? "").trim();

    // Nothing to do, and an empty name is not a rename. The contract requires
    // 1–100 characters; refusing here keeps a pointless round trip out of it.
    if (next === "" || next === current) {
      setEditing(false);
      return;
    }

    setState("saving");
    try {
      await browserApi()("updateProject", { params: { projectId }, body: { name: next } });
      setCurrent(next);
      setEditing(false);
      setState("idle");
    } catch {
      // Only a failure to save is reported. The old name is still on screen and
      // still correct, so there is nothing to roll back.
      setState("failed");
    }
  };

  if (!editing) {
    return (
      <h1>
        {current}{" "}
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setState("idle");
            setEditing(true);
          }}
        >
          Rename
        </button>
      </h1>
    );
  }

  return (
    <h1>
      <form onSubmit={save} style={{ display: "inline" }}>
        <label htmlFor="project-name">Project name</label>
        <input
          id="project-name"
          name="name"
          defaultValue={current}
          maxLength={100}
          required
          autoFocus
        />
        <button type="submit" disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn secondary" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
      {state === "failed" && (
        <p className="tile-error" role="alert">
          That name could not be saved. Try again.
        </p>
      )}
    </h1>
  );
};
