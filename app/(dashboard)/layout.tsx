export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <nav className="w-56 border-r bg-gray-50 p-4">
        <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Counted
        </div>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
