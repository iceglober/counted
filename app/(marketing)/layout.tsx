import "./retro.css";

// Every marketing surface renders inside the .retro scope — plain white,
// Verdana, blue links. The app dashboard and /docs keep the modern theme.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="retro">{children}</div>;
}
