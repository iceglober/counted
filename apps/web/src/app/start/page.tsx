"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";
import { Onboarding, type Provisioned } from "@/components/onboarding";

/**
 * Starting from nothing.
 *
 * One path, and it is the same one `/v1/provision` gives an agent. The project
 * is **named here, before it exists** — v1 created "My Project" and asked
 * afterwards, so the rename was a second step most people never took and every
 * list read the same.
 *
 * No sign-in first. The key works immediately, so the snippet on the next
 * screen is one somebody can actually run; signing in is how you keep the
 * project, not how you start it.
 */
export default function Start() {
  const [provisioned, setProvisioned] = useState<Provisioned | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    setFailure(null);
    try {
      const { data } = await browserApi()<Provisioned>("provisionProject", { body: { name } });
      setProvisioned(data);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The project could not be created.");
    }
  };

  if (provisioned !== null) {
    return (
      <main>
        <h1>{provisioned.project.name}</h1>
        <Onboarding provisioned={provisioned} />
      </main>
    );
  }

  return (
    <main>
      <h1>Start a project</h1>
      <form onSubmit={submit}>
        <label htmlFor="name">What are you measuring?</label>{" "}
        <input id="name" name="name" required maxLength={120} placeholder="Acme web" />{" "}
        <button type="submit">Create</button>
      </form>
      {failure !== null && (
        <p className="tile-error" role="alert">
          {failure}
        </p>
      )}
    </main>
  );
}
