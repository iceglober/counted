import { cookies } from "next/headers";
import { ApiError, serverApi } from "@/lib/api";
import { ClaimForm } from "@/components/claim-form";

export const dynamic = "force-dynamic";

type Preview = { readonly project: { id: string; name: string }; readonly expiresAt: string | null };

/**
 * Adopting a provisioned project.
 *
 * Previewed server-side before anything is committed, so somebody arriving
 * from a link knows what they are about to take ownership of. A link that
 * lapsed and one that never existed read identically — the API refuses to tell
 * them apart, and re-deriving a reason here would undo that.
 */
export default async function Claim({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = serverApi((await cookies()).toString() || null);

  let preview: Preview | null = null;
  try {
    preview = (await api<Preview>("previewClaim", { params: { token } })).data;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  if (preview === null) {
    return (
      <main>
        <h1>This link is not valid</h1>
        <p className="tile-empty">
          It may have expired or already been used. Start a new project, or sign in if you already have one.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Claim {preview.project.name}</h1>
      {preview.expiresAt !== null && (
        <p className="tile-empty">This link expires {new Date(preview.expiresAt).toISOString().slice(0, 10)}.</p>
      )}
      <ClaimForm token={token} projectName={preview.project.name} />
    </main>
  );
}
