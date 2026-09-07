import { apiOrigin } from "./env";

export const emailAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${apiOrigin()}/api/auth/capabilities`, { cache: "no-store" });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return result !== null && typeof result === "object" && "email" in result && result.email === true;
  } catch { return false; }
};
