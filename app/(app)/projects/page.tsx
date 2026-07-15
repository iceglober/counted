"use client";

import { useState, useEffect } from "react";
import { useProjects } from "@/components/dashboard/dashboard-shell";
import { EditableText } from "@/components/editable-text";
import { Copy, RotateCw, Hash, Globe, Smartphone, Tag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";

type ProjectDetail = {
  id: string;
  name: string;
  apiKey: string;
  clientKey: string | null;
  serverKey: string | null;
  createdAt: string;
};

type ProjectSchema = {
  eventNames: { name: string; count: number }[];
  propKeys: string[];
  systemFields: {
    osNames: string[];
    locales: string[];
    appVersions: string[];
  };
};

export default function ProjectsPage() {
  const projects = useProjects();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? "");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [schema, setSchema] = useState<ProjectSchema | null>(null);
  const [rotating, setRotating] = useState(false);
  const [allProjects, setAllProjects] = useState<ProjectDetail[]>([]);

  useEffect(() => {
    fetch("/api/v0/projects")
      .then((r) => r.json())
      .then(setAllProjects);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const p = allProjects.find((p) => p.id === selectedId);
    if (p) setDetail(p);

    fetch(`/api/v0/projects/${selectedId}/schema`)
      .then((r) => r.json())
      .then(setSchema)
      .catch(() => setSchema(null));
  }, [selectedId, allProjects]);

  async function createProject() {
    const res = await fetch("/api/v0/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Untitled" }),
    });
    if (res.ok) {
      const project = await res.json();
      setAllProjects((prev) => [...prev, project]);
      setSelectedId(project.id);
    }
  }

  async function renameProject(name: string, id?: string) {
    const targetId = id ?? detail?.id;
    if (!targetId) return;
    if (detail && detail.id === targetId) setDetail({ ...detail, name });
    setAllProjects((prev) => prev.map((p) => p.id === targetId ? { ...p, name } : p));
    await fetch(`/api/v0/projects/${targetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async function copyKey() {
    if (!detail) return;
    await navigator.clipboard.writeText(detail.clientKey ?? detail.apiKey);
    toast.success("Client key copied");
  }

  async function rotateKey(type: "client" | "server" = "client") {
    if (!detail || rotating) return;
    setRotating(true);
    const res = await fetch(`/api/v0/projects/${detail.id}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (res.ok) {
      const { clientKey, serverKey } = await res.json();
      setDetail({ ...detail, clientKey, serverKey, apiKey: clientKey ?? detail.apiKey });
      setAllProjects((prev) => prev.map((p) => p.id === detail.id ? { ...p, clientKey, serverKey } : p));
    }
    setRotating(false);
  }

  async function deleteProject() {
    if (!detail) return;
    const res = await fetch(`/api/v0/projects/${detail.id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      const remaining = allProjects.filter((p) => p.id !== detail.id);
      setAllProjects(remaining);
      setDetail(null);
      setSelectedId(remaining[0]?.id ?? "");
      router.refresh();
    }
  }

  return (
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="mb-4">
        <h1 className="!mt-0 !mb-1">Projects</h1>
        <p className="small muted mb-2">
          {allProjects.length} project{allProjects.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => createProject()}>New project</Button>
      </div>

      <div className="flex gap-6 h-[calc(100vh-13rem)]">
      {/* Left — project list, classic listbox */}
      <div className="w-52 shrink-0 border border-border overflow-y-auto bg-surface-0">
        {(allProjects.length > 0 ? allProjects : projects.map((p) => ({ ...p, apiKey: "", createdAt: "" }))).map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`px-3 py-1.5 text-sm cursor-pointer ${
              p.id === selectedId
                ? "bg-accent text-white"
                : "text-text-primary hover:bg-surface-2"
            }`}
          >
            {p.name}
          </div>
        ))}
      </div>

      {/* Right — project details */}
      <div className="flex-1 overflow-y-auto pr-2">
        {detail ? (
          <div className="max-w-2xl space-y-6">
            <div>
              <EditableText
                value={detail.name}
                onCommit={(name) => renameProject(name)}
                className="text-lg font-bold"
              />
              <p className="text-xs text-text-tertiary mt-1">
                Created {new Date(detail.createdAt).toLocaleDateString()}
              </p>
            </div>

            {/* Client Key */}
            <div>
              <h2 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1">Client Key</h2>
              <p className="text-xs text-text-tertiary mb-2">Public. Goes in your SDK. Ingest only.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-text-primary border border-border select-all !px-2.5 !py-2">
                  {detail.clientKey ?? detail.apiKey}
                </code>
                <IconButton icon={<Copy />} label="Copy client key" onClick={copyKey} />
              </div>
              <button onClick={() => rotateKey("client")} disabled={rotating} className="text-xs text-error hover:text-error/80 mt-2 transition-colors disabled:opacity-50 flex items-center gap-1">
                <RotateCw className="w-3 h-3" />
                {rotating ? "Rotating..." : "Rotate"}
              </button>
            </div>

            {/* Server Key */}
            <div>
              <h2 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1">Server Key</h2>
              <p className="text-xs text-text-tertiary mb-2">Private. Server-side only. Full API access.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-text-primary border border-border select-all !px-2.5 !py-2">
                  {detail.serverKey ?? "Not generated yet"}
                </code>
              </div>
              <button onClick={() => rotateKey("server")} disabled={rotating} className="text-xs text-error hover:text-error/80 mt-2 transition-colors disabled:opacity-50 flex items-center gap-1">
                <RotateCw className="w-3 h-3" />
                {rotating ? "Rotating..." : "Rotate"}
              </button>
            </div>

            {/* Quick Start */}
            <div>
              <h2 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1">Quick Start</h2>
              <pre className="text-xs font-mono text-text-primary bg-surface-2 border border-border px-4 py-3 rounded-md overflow-x-auto">
{`import { Analytics } from "@counted/sdk";

const analytics = new Analytics({
  projectKey: "${detail.clientKey ?? detail.apiKey}",
});

analytics.track("page_view", { path: "/" });`}
              </pre>
            </div>

            {/* Collected Schema */}
            {schema && (
              <>
                {schema.eventNames.length > 0 && (
                  <div>
                    <h2 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1 flex items-center gap-1.5">
                      <Hash className="w-3 h-3" />
                      Events
                    </h2>
                    <div className="bg-surface-2 border border-border rounded-md divide-y divide-border">
                      {schema.eventNames.map((e) => (
                        <div key={e.name} className="flex items-center justify-between px-4 py-2 text-sm">
                          <span className="font-mono text-xs text-text-primary">{e.name}</span>
                          <span className="text-xs text-text-tertiary tabular-nums">{e.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {schema.propKeys.length > 0 && (
                  <div>
                    <h2 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1 flex items-center gap-1.5">
                      <Tag className="w-3 h-3" />
                      Custom Properties
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                      {schema.propKeys.map((k) => (
                        <Badge key={k} variant="outline" className="font-mono !rounded-none">{k}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  {schema.systemFields.osNames.length > 0 && (
                    <div>
                      <h3 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1 flex items-center gap-1.5">
                        <Smartphone className="w-3 h-3" />
                        Platforms
                      </h3>
                      <div className="space-y-1">
                        {schema.systemFields.osNames.map((os) => (
                          <div key={os} className="text-xs text-text-secondary">{os}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {schema.systemFields.locales.length > 0 && (
                    <div>
                      <h3 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1 flex items-center gap-1.5">
                        <Globe className="w-3 h-3" />
                        Locales
                      </h3>
                      <div className="space-y-1">
                        {schema.systemFields.locales.map((l) => (
                          <div key={l} className="text-xs text-text-secondary">{l}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {schema.systemFields.appVersions.length > 0 && (
                    <div>
                      <h3 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1">Versions</h3>
                      <div className="space-y-1">
                        {schema.systemFields.appVersions.map((v) => (
                          <div key={v} className="text-xs text-text-secondary font-mono">{v}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Data Export */}
            <div>
              <h2 className="!text-[13px] font-bold text-text-primary !my-0 !pb-1">Export Data</h2>
              <p className="text-xs text-text-tertiary mb-3">Download your event data. You own it.</p>
              <div className="flex gap-2">
                <Button asChild variant="secondary" size="sm">
                  <a href={`/api/v0/projects/${detail.id}/export?format=csv`}>Export CSV</a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href={`/api/v0/projects/${detail.id}/export?format=json`}>Export JSON</a>
                </Button>
              </div>
            </div>

            {/* Danger zone */}
            <div className="pt-4 border-t border-border">
              <button
                onClick={deleteProject}
                className="text-xs text-error hover:text-error/80 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                Delete project
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-16 text-text-tertiary">
            <p className="text-sm">Select a project</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
