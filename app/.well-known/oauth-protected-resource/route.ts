import { jsonld, SITE, API } from "@/lib/agent-meta";

// RFC 9728 protected-resource metadata. Counted authenticates the API with
// Bearer API keys (sk_ server keys), not a full OAuth authorization server, so
// we describe the real bearer flow and point at the human/agent auth docs
// rather than advertising an authorization_server endpoint that doesn't exist.
export function GET() {
  return jsonld({
    resource: `${API}/api/v0`,
    bearer_methods_supported: ["header"],
    scopes_supported: ["ingest", "read"],
    resource_documentation: `${SITE}/auth.md`,
    // Counted uses API keys; a client key (ck_) is mintable with no signup.
    agent_auth: {
      register_uri: `${API}/api/v0/provision`,
      identity_types_supported: ["anonymous"],
      anonymous: { credential_types_supported: ["api_key"] },
      skill: `${SITE}/auth.md`,
    },
  });
}
