/**
 * One `McpServer` per HTTP request, with every projected tool bound to the
 * caller's token.
 *
 * The token is captured in the closure rather than carried in the SDK's
 * `AuthInfo`, for a reason worth stating: `AuthInfo` asks for a `clientId` and
 * a `scopes` list. This server learns neither — it does not verify the token's
 * signature and it does not read scopes, on purpose (see `authentication.ts`).
 * Filling those fields would mean inventing them, and an invented scope list is
 * exactly the kind of second, quieter answer that turns into a second
 * authorization path.
 *
 * Every handler does the same four things: hand the arguments to the invoker
 * with the caller's token, and turn one of three outcomes into a tool result.
 * There is no branch on which tool it is, and no branch on what the caller may
 * do.
 */

import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ContractInvoker, InvocationOutcome } from "./invoke";
import { TOOLS, type ToolSchema, type Tool } from "./projection";

export const SERVER_NAME = "counted";
export const SERVER_VERSION = "3.0.0";

export const INSTRUCTIONS = [
  "Counted is privacy-focused product analytics. The shape of the data is: a workspace holds",
  "projects, a project receives events, a dashboard holds tiles, and a tile holds one analysis.",
  "",
  "Start with `account_me` or `credentials_self` to find out who you are, then `workspaces_list`",
  "and `projects_list`. Before writing an analysis, call `queries_schema` for the project — an",
  "analysis naming an event or dimension the project has never seen is refused as unanswerable,",
  "and the schema is the only way to know which names exist.",
  "",
  "Every tool runs as you. A tool that answers `FORBIDDEN` is telling you your credential does",
  "not carry that permission; retrying will not help, and no other tool here will do it either.",
].join("\n");

/**
 * The answer a tool gives, in the two forms MCP wants it: text for a model to
 * read, and `structuredContent` matching the declared output schema for a
 * client to parse.
 *
 * The output schema comes from the contract, so an agent can see the reply's
 * shape in `tools/list` before it calls. The SDK validates `structuredContent`
 * against it — but skips validation on an error result, which is what lets the
 * mismatch case below stay legible instead of becoming a protocol error the
 * agent cannot read.
 */
const answered = async (
  tool: Tool,
  body: unknown,
  outputSchema: ToolSchema | undefined,
): Promise<CallToolResult> => {
  const text = JSON.stringify(body, null, 2);

  if (outputSchema === undefined) {
    return { content: [{ type: "text", text }] };
  }

  const validated = await outputSchema["~standard"].validate(body);
  if (typeof validated === "object" && validated !== null && "issues" in validated) {
    const issues: unknown = (validated as { issues: unknown }).issues;
    if (issues !== undefined) {
      // The API answered, but not in the shape its own contract declares. Say
      // so and still hand over what came back — an agent can usually use it,
      // and hiding it would make a server bug look like an empty answer.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `The API's reply did not match the shape \`${tool.id}\` declares. This is a defect in the API, not in your request. What came back:\n\n${text}`,
          },
        ],
      };
    }
  }

  return { content: [{ type: "text", text }], structuredContent: body as Record<string, unknown> };
};

/** A refusal, phrased so an agent knows whether retrying could ever work. */
const refused = (outcome: Extract<InvocationOutcome, { kind: "refused" }>): CallToolResult => {
  const detail = outcome.data === undefined ? "" : `\n\n${JSON.stringify(outcome.data, null, 2)}`;
  const advice =
    outcome.status === 401
      ? " Your credential is not usable — re-authenticate."
      : outcome.status === 403
        ? " Your credential does not carry the permission this needs. Retrying will not help."
        : outcome.status === 429
          ? " You are being rate limited; wait for the interval in `retryAfterMs`."
          : "";
  return {
    isError: true,
    content: [
      { type: "text", text: `${outcome.code} (${outcome.status}): ${outcome.message}${advice}${detail}` },
    ],
  };
};

const unreachable = (because: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: `Counted could not be reached: ${because}` }],
});

/**
 * Builds the server for one request.
 *
 * `token` is whatever the caller presented. It is forwarded and never
 * inspected: this function behaves identically for a token that can do
 * everything and one that can do nothing, and the difference shows up only in
 * what `apps/api` answers. `server.test.ts` asserts exactly that.
 */
export const buildServer = (options: {
  readonly invoker: ContractInvoker;
  readonly token: string | undefined;
  readonly tools?: readonly Tool[];
}): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: "Counted" },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of options.tools ?? TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
        annotations: {
          title: tool.title,
          readOnlyHint: tool.annotations.readOnlyHint,
          destructiveHint: tool.annotations.destructiveHint,
          idempotentHint: tool.annotations.idempotentHint,
          openWorldHint: false,
        },
        // The requirement the API will enforce, in the artifact rather than
        // only in the prose. A client that wants to explain a refusal before
        // making it has the same value `apps/api` decides with.
        _meta: { "counted/operation": tool.id, "counted/authorization": tool.requirement },
      },
      async (args: unknown): Promise<CallToolResult> => {
        const outcome = await options.invoker.invoke({
          tool,
          args: (args ?? {}) as Record<string, unknown>,
          token: options.token,
        });
        switch (outcome.kind) {
          case "answered":
            return answered(tool, outcome.body, tool.outputSchema);
          case "refused":
            return refused(outcome);
          case "unreachable":
            return unreachable(outcome.because);
        }
      },
    );
  }

  return server;
};
