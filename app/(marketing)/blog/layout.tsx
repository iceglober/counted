// ISR for the blog segment (index + every post page). Scheduled posts have a
// future `date` and stay 404/hidden until then (see posts.ts `isLive`); this
// revalidate window makes the date gate re-evaluate without a redeploy, so a
// scheduled post surfaces within ~6h of its day. Applies to all blog routes.
export const revalidate = 21600; // 6 hours

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
