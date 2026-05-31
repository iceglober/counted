"use client";

import { useState, useEffect } from "react";
import { useProjects } from "@/components/dashboard/dashboard-shell";
import { EditableText } from "@/components/editable-text";
import { Plus, Copy, RotateCw, Hash, Globe, Smartphone, Tag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/action-button";

type ProjectDetail = {
  id: string;
  name: string;
  apiKey: string;
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
  const [copied, setCopied] = useState(false);
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
    await navigator.clipboard.writeText(detail.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function rotateKey() {
    if (!detail || rotating) return;
    setRotating(true);
    const res = await fetch(`/api/v0/projects/${detail.id}/keys`, { method: "POST" });
    if (res.ok) {
      const { apiKey } = await res.json();
      setDetail({ ...detail, apiKey });
      setAllProjects((prev) => prev.map((p) => p.id === detail.id ? { ...p, apiKey } : p));
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
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Projects</h1>
          <ActionButton
            label="New project"
            onClick={createProject}
            icon={<Plus className="w-4 h-4" />}
            className="p-1 text-text-tertiary hover:text-accent transition-colors"
          />
        </div>
        <p className="text-sm text-text-secondary mt-0.5">
          {allProjects.length} project{allProjects.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex h-[calc(100vh-12rem)]">
      {/* Left — project list */}
      <div className="w-60 shrink-0 border-r border-border overflow-y-auto">
        <div className="py-1">
          {(allProjects.length > 0 ? allProjects : projects.map((p) => ({ ...p, apiKey: "", createdAt: "" }))).map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`px-4 py-2.5 text-sm transition-colors ${
                p.id === selectedId
                  ? "text-accent bg-accent/8"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-2 cursor-pointer"
              }`}
            >
              {p.id === selectedId ? (
                <EditableText
                  value={p.name}
                  onCommit={(name) => renameProject(name, p.id)}
                  className="text-sm"
                />
              ) : (
                p.name
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right — project details */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {detail ? (
          <div className="max-w-2xl space-y-6">
            <div>
              <EditableText
                value={detail.name}
                onCommit={(name) => renameProject(name)}
                className="text-xl font-semibold"
              />
              <p className="text-xs text-text-tertiary mt-1">
                Created {new Date(detail.createdAt).toLocaleDateString()}
              </p>
            </div>

            {/* API Key */}
            <div>
              <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2">API Key</h2>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-text-primary bg-surface-2 px-3 py-2 rounded-md border border-border select-all">
                  {detail.apiKey}
                </code>
                <button onClick={copyKey} className="p-2 text-text-tertiary hover:text-text-primary bg-surface-2 border border-border rounded-md transition-colors">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {copied && <p className="text-xs text-accent mt-1">Copied</p>}
              <button onClick={rotateKey} disabled={rotating} className="text-xs text-error hover:text-error/80 mt-2 transition-colors disabled:opacity-50 flex items-center gap-1">
                <RotateCw className="w-3 h-3" />
                {rotating ? "Rotating..." : "Rotate key"}
              </button>
            </div>

            {/* Quick Start */}
            <div>
              <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2">Quick Start</h2>
              <pre className="text-xs font-mono text-text-primary bg-surface-2 border border-border px-4 py-3 rounded-md overflow-x-auto">
{`import { Analytics } from "@counted/sdk";

const analytics = new Analytics({
  appKey: "${detail.apiKey}",
});

analytics.track("page_view", { path: "/" });`}
              </pre>
            </div>

            {/* Collected Schema */}
            {schema && (
              <>
                {schema.eventNames.length > 0 && (
                  <div>
                    <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5">
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
                    <h2 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5">
                      <Tag className="w-3 h-3" />
                      Custom Properties
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                      {schema.propKeys.map((k) => (
                        <span key={k} className="px-2 py-0.5 text-xs font-mono bg-surface-2 border border-border rounded text-text-secondary">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  {schema.systemFields.osNames.length > 0 && (
                    <div>
                      <h3 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5">
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
                      <h3 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5">
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
                      <h3 className="text-xs text-text-tertiary uppercase tracking-wider font-medium mb-2">Versions</h3>
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
