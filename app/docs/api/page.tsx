/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import Link from "next/link";
import { spec } from "@/lib/openapi";
import { SiteNav, SiteFooter } from "../../(marketing)/site-chrome";

export const metadata: Metadata = {
  title: "API Reference — Counted",
  description:
    "The full Counted HTTP API — ingestion, projects, query, dashboards, and alerts. Generated from the OpenAPI spec.",
  alternates: { canonical: "/docs/api" },
};

const S = spec as any;

function resolveRef(node: any): any {
  if (node && typeof node === "object" && typeof node.$ref === "string") {
    const parts = node.$ref.replace(/^#\//, "").split("/");
    let cur: any = S;
    for (const p of parts) cur = cur?.[p];
    return resolveRef(cur ?? {});
  }
  return node ?? {};
}

function typeLabel(schemaIn: any): string {
  const s = resolveRef(schemaIn);
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).map(typeLabel).join(" | ");
  if (s.type === "array") return `${typeLabel(s.items ?? {})}[]`;
  if (s.enum) return `${s.type ?? "string"} · ${s.enum.map((e: any) => JSON.stringify(e)).join(" | ")}`;
  let t = s.type ?? (s.properties ? "object" : "any");
  if (s.format) t += ` (${s.format})`;
  if (s.nullable) t += " | null";
  return t;
}

function nestedOf(schema: any): any | null {
  const s = resolveRef(schema);
  if (s.type === "object" && s.properties) return s;
  if (s.type === "array") {
    const items = resolveRef(s.items ?? {});
    if (items.properties) return items;
  }
  return null;
}

function SchemaProps({ schema, depth = 0 }: { schema: any; depth?: number }) {
  const s = resolveRef(schema);

  if ((s.oneOf || s.anyOf) && !s.properties) {
    const opts = s.oneOf ?? s.anyOf;
    return (
      <div className="space-y-1.5">
        {opts.map((o: any, i: number) => {
          const ro = resolveRef(o);
          return ro.properties ? (
            <div key={i} className="rounded-md border border-border/60 p-2">
              <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1">Option {i + 1}</div>
              <SchemaProps schema={ro} depth={depth} />
            </div>
          ) : (
            <div key={i} className="font-mono text-xs text-accent">{typeLabel(o)}</div>
          );
        })}
      </div>
    );
  }

  if (s.type === "object" && s.properties) {
    const req = new Set<string>(s.required ?? []);
    return (
      <div className="space-y-0.5">
        {Object.entries(s.properties).map(([k, v]) => {
          const nested = nestedOf(v);
          return (
            <div key={k} style={{ paddingLeft: depth ? 14 : 0 }}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <code className="font-mono text-sm text-text-primary">{k}</code>
                <span className="font-mono text-xs text-accent">{typeLabel(v)}</span>
                {req.has(k) && (
                  <span className="text-[10px] uppercase tracking-wide text-text-tertiary">required</span>
                )}
              </div>
              {resolveRef(v).description && (
                <p className="text-xs text-text-tertiary mb-0.5">{resolveRef(v).description}</p>
              )}
              {nested && depth < 3 && (
                <div className="my-1 border-l border-border pl-3">
                  <SchemaProps schema={nested} depth={depth + 1} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return <div className="font-mono text-xs text-accent">{typeLabel(s)}</div>;
}

const METHOD_STYLE: Record<string, string> = {
  get: "text-emerald-400 border-emerald-400/30",
  post: "text-accent border-accent/40",
  put: "text-amber-400 border-amber-400/30",
  patch: "text-amber-400 border-amber-400/30",
  delete: "text-error border-error/40",
};
const METHODS = ["get", "post", "put", "patch", "delete"];

function SubHead({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary mt-4 mb-1.5">{children}</h4>;
}

function Endpoint({ path, method, op }: { path: string; method: string; op: any }) {
  const params = (op.parameters ?? []).map(resolveRef);
  const reqBody = op.requestBody ? resolveRef(op.requestBody) : null;
  const reqSchema = reqBody?.content?.["application/json"]?.schema;
  const security = op.security?.[0] ? Object.keys(op.security[0])[0] : null;

  return (
    <div id={op.operationId ?? `${method}_${path}`} className="scroll-mt-24 border-t border-border py-6">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-mono font-semibold uppercase border rounded px-1.5 py-0.5 ${METHOD_STYLE[method] ?? "text-text-secondary border-border"}`}>
          {method}
        </span>
        <code className="font-mono text-sm text-text-primary break-all">{path}</code>
        {security && (
          <span className="text-[10px] uppercase tracking-wide text-text-tertiary border border-border rounded px-1.5 py-0.5">
            {security === "projectKey" ? "Project key" : "Session"}
          </span>
        )}
      </div>
      {op.summary && <p className="mt-2 text-sm text-text-secondary">{op.summary}</p>}
      {op.description && <p className="mt-1 text-xs text-text-tertiary">{op.description}</p>}

      {params.length > 0 && (
        <section>
          <SubHead>Parameters</SubHead>
          <div className="space-y-1">
            {params.map((p: any) => (
              <div key={`${p.in}-${p.name}`} className="flex items-baseline gap-2 flex-wrap">
                <code className="font-mono text-sm text-text-primary">{p.name}</code>
                <span className="text-[10px] uppercase tracking-wide text-text-tertiary">{p.in}</span>
                <span className="font-mono text-xs text-accent">{typeLabel(p.schema)}</span>
                {p.required && <span className="text-[10px] uppercase tracking-wide text-text-tertiary">required</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {reqSchema && (
        <section>
          <SubHead>Request body</SubHead>
          <SchemaProps schema={reqSchema} />
        </section>
      )}

      <section>
        <SubHead>Responses</SubHead>
        <div className="space-y-2">
          {Object.entries(op.responses ?? {}).map(([code, r]) => {
            const rr = resolveRef(r);
            const sch = rr.content?.["application/json"]?.schema;
            return (
              <div key={code}>
                <div className="flex items-baseline gap-2">
                  <code className="font-mono text-xs text-text-primary">{code}</code>
                  <span className="text-xs text-text-secondary">{rr.description}</span>
                </div>
                {sch && (
                  <div className="mt-1 border-l border-border pl-3">
                    <SchemaProps schema={sch} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function ApiReferencePage() {
  const byTag: Record<string, { path: string; method: string; op: any }[]> = {};
  for (const [path, item] of Object.entries(S.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as any)[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "Other";
      (byTag[tag] ??= []).push({ path, method, op });
    }
  }
  const tagDefs: { name: string; description?: string }[] = S.tags ?? [];
  const orderedTags = [
    ...tagDefs.filter((t) => byTag[t.name]),
    ...Object.keys(byTag)
      .filter((t) => !tagDefs.some((td) => td.name === t))
      .map((name) => ({ name })),
  ];
  const baseUrl = S.servers?.[0]?.url ?? "";

  return (
    <div className="min-h-screen">
      <SiteNav />
      <article className="px-6 pt-16 pb-12 max-w-3xl mx-auto">
        <Link href="/docs" className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">← Docs</Link>
        <h1 className="mt-6 font-display text-3xl md:text-4xl tracking-tight">API Reference</h1>
        <p className="mt-3 text-text-secondary leading-relaxed">
          The complete Counted HTTP API. Base URL{" "}
          <code className="font-mono text-text-primary">{baseUrl}</code>. Ingestion uses a write-only
          project key (<code className="font-mono text-text-primary">ck_…</code>); management endpoints
          use your signed-in session. The machine-readable spec is at{" "}
          <a href="/api/v0/openapi.json" className="text-accent hover:text-accent-hover transition-colors">/api/v0/openapi.json</a>.
        </p>

        {/* Quick nav */}
        <nav className="mt-6 flex flex-wrap gap-2">
          {orderedTags.map((t) => (
            <a key={t.name} href={`#tag-${t.name}`} className="text-xs border border-border rounded-full px-2.5 py-1 text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors">
              {t.name}
            </a>
          ))}
        </nav>

        {orderedTags.map((t) => {
          const def = tagDefs.find((td) => td.name === t.name);
          return (
            <section key={t.name} id={`tag-${t.name}`} className="scroll-mt-24 mt-12">
              <h2 className="font-display text-2xl tracking-tight">{t.name}</h2>
              {def?.description && <p className="mt-1 text-sm text-text-tertiary">{def.description}</p>}
              {byTag[t.name].map(({ path, method, op }) => (
                <Endpoint key={`${method} ${path}`} path={path} method={method} op={op} />
              ))}
            </section>
          );
        })}
      </article>
      <SiteFooter />
    </div>
  );
}
