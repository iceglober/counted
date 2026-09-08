import { deploymentDocument } from "../../lib/deployment";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(deploymentDocument(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
