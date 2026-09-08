/** Read-only release gate for services that cannot use Railway config-as-code. */
import docs from "../deploy/docs.railway.json";
import mcp from "../deploy/mcp.railway.json";

// These files remain the release's expected settings. Railway does not read
// them for new services; operators apply the native settings before release.
export const nativeServiceSettings = { "counted-docs": docs, "counted-mcp": mcp } as const;

const endpoint = "https://backboard.railway.com/graphql/v2";
const query = `query CountedNativeServiceConfiguration {
  projectToken {
    project { id services { edges { node {
      id name serviceInstances { edges { node {
        serviceId environmentId builder dockerfilePath healthcheckPath
        healthcheckTimeout restartPolicyType restartPolicyMaxRetries
        numReplicas overlapSeconds drainingSeconds
      } } }
    } } } }
    environment { id name config(decryptVariables: false) }
  }
}`;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const empty = (value: unknown): boolean => value === null || value === undefined || value === "";

/** Only controlled field names leave this validator, never provider values. */
export function nativeSettingsProblems(response: unknown, expectedProject: string, expectedEnvironment: string): string[] {
  const body = record(response);
  if (!body || (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length > 0))) {
    return ["Railway configuration query failed."];
  }
  const token = record(record(body.data)?.projectToken);
  const project = record(token?.project);
  const environment = record(token?.environment);
  if (project?.id !== expectedProject) return ["Railway token does not target the configured project."];
  if (environment?.name !== "production" || environment.id !== expectedEnvironment) {
    return ["Railway token does not target the production environment."];
  }
  const edges = record(project.services)?.edges;
  const services = record(record(environment.config)?.services);
  if (!Array.isArray(edges) || !services) return ["Railway applied configuration is unavailable."];

  const problems: string[] = [];
  for (const [name, expected] of Object.entries(nativeServiceSettings)) {
    const matches = edges.map((edge) => record(record(edge)?.node)).filter((node) => node?.name === name);
    const id = matches[0]?.id;
    const service = typeof id === "string" && id ? record(services[id]) : undefined;
    if (matches.length !== 1 || !service || service.isDeleted === true) {
      problems.push(`${name}: applied service configuration is missing or ambiguous.`);
      continue;
    }
    const instances = record(matches[0]?.serviceInstances)?.edges;
    const effective = Array.isArray(instances)
      ? instances.map((edge) => record(record(edge)?.node)).filter((node) =>
        node?.serviceId === id && node?.environmentId === expectedEnvironment)
      : [];
    if (effective.length !== 1) {
      problems.push(`${name}: effective service settings are missing or ambiguous.`);
      continue;
    }
    if (!empty(service.configFile)) problems.push(`${name}: configFile must be unset; apply native settings.`);
    const source = record(service.source);
    if (!empty(source?.rootDirectory) && source?.rootDirectory !== "/") {
      problems.push(`${name}: source.rootDirectory must use the repository root.`);
    }
    if (!empty(source?.image)) problems.push(`${name}: source.image must be unset for source uploads.`);

    const build = record(service.build);
    // ServiceInstance.builder is the fallback buildpack enum, which does not
    // include DOCKERFILE. Railway uses the explicit Dockerfile configuration
    // before that fallback; a new Dockerfile service still reports RAILPACK.
    if (build?.builder !== expected.build.builder ||
        (expected.build.builder !== "DOCKERFILE" && effective[0]?.builder !== expected.build.builder)) {
      problems.push(`${name}: build.builder differs from this release.`);
    }
    if (build?.dockerfilePath !== expected.build.dockerfilePath ||
        effective[0]?.dockerfilePath !== expected.build.dockerfilePath) {
      problems.push(`${name}: build.dockerfilePath differs from this release.`);
    }
    if (!empty(build?.buildCommand)) problems.push(`${name}: build.buildCommand must be unset.`);
    if (build?.watchPatterns !== undefined && build.watchPatterns !== null &&
        (!Array.isArray(build.watchPatterns) || build.watchPatterns.length > 0)) {
      problems.push(`${name}: build.watchPatterns must be empty.`);
    }

    const deploy = record(service.deploy);
    for (const [field, value] of Object.entries(expected.deploy)) {
      if (field === "numReplicas") continue;
      // Railway omits native defaults from environment.config. The matching
      // ServiceInstance supplies effective values; an omission is never guessed.
      if (effective[0]?.[field] !== value || (deploy?.[field] !== undefined && deploy[field] !== value)) {
        problems.push(`${name}: deploy.${field} differs from this release.`);
      }
    }
    for (const field of ["startCommand", "preDeployCommand", "cronSchedule"] as const) {
      if (!empty(deploy?.[field])) problems.push(`${name}: deploy.${field} must be unset.`);
    }
    if (deploy?.sleepApplication !== undefined && deploy.sleepApplication !== null && deploy.sleepApplication !== false) {
      problems.push(`${name}: deploy.sleepApplication must be disabled.`);
    }
    // Railway's native scale API uses an explicit regional map. Its legacy
    // ServiceInstance.numReplicas can be null even when a region has replicas.
    // Null regional entries remove regions; absent/empty maps prove no count.
    // See railwayapp/cli v4.68.0 src/controllers/regions.rs.
    const flatCount = effective[0]?.numReplicas;
    if (deploy && Object.hasOwn(deploy, "multiRegionConfig")) {
      const regions = record(deploy.multiRegionConfig);
      const entries = Object.entries(regions ?? {});
      const counts = entries.map(([, region]) => region === null ? 0 : record(region)?.numReplicas);
      const valid = regions && entries.length > 0 && entries.every(([region]) => region.length > 0) &&
        counts.every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0);
      const total = valid ? counts.reduce<number>((sum, count) => sum + (count as number), 0) : undefined;
      if (total !== expected.deploy.numReplicas) {
        problems.push(`${name}: deploy.multiRegionConfig differs from this release's replica count.`);
      }
      if (flatCount !== null && flatCount !== total) {
        problems.push(`${name}: deploy.numReplicas conflicts with its regional configuration.`);
      }
    } else if (flatCount !== expected.deploy.numReplicas) {
      problems.push(`${name}: deploy.numReplicas differs from this release.`);
    }
    if (deploy?.numReplicas !== undefined && deploy.numReplicas !== expected.deploy.numReplicas) {
      problems.push(`${name}: deploy.numReplicas differs from this release.`);
    }
  }
  return problems;
}

/** The project token determines the environment; no local CLI link is trusted. */
export async function verifyRailwayConfig(
  env: Readonly<Record<string, string | undefined>>,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const token = env.RAILWAY_TOKEN;
  const project = env.RAILWAY_PROJECT_ID;
  const environment = env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !project || !environment) return ["A production project token, project ID and environment ID are required."];
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "project-access-token": token },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) return ["Railway configuration request failed."];
    // Config can contain encrypted variable metadata. Bound and discard the
    // response in memory; never log bodies, server errors, or caught exceptions.
    const reader = response.body?.getReader();
    if (!reader) return ["Railway configuration response is empty."];
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        return ["Railway configuration response exceeds the size limit."];
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return nativeSettingsProblems(JSON.parse(text) as unknown, project, environment);
  } catch {
    return ["Railway configuration could not be read or decoded."];
  }
}

if (import.meta.main) {
  const problems = await verifyRailwayConfig(process.env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exitCode = 1;
  } else {
    console.log("Applied docs and MCP settings match this release.");
  }
}
