/** Better Auth owns these routes and errors; the browser reaches our same-origin proxy. */
export const authRequest = async (path: string, body?: unknown): Promise<unknown> => {
  const response = await fetch(`/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload !== null && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : "That request could not be completed. Please try again.";
    throw new Error(message);
  }
  return payload;
};

export const authProblem = (error: unknown): string => error instanceof Error ? error.message : "The API could not be reached. Please try again.";
