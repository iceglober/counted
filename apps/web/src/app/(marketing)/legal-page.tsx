import type { ReactNode } from "react";
import { PageIntro } from "../../components/site-chrome";
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) { return <article className="site-prose max-w-3xl"><PageIntro title={title}><p>Last updated {updated}</p></PageIntro>{children}</article>; }
export function H2({ children }: { children: ReactNode }) { return <h2>{children}</h2>; }
export function P({ children }: { children: ReactNode }) { return <p>{children}</p>; }
export function UL({ children }: { children: ReactNode }) { return <ul>{children}</ul>; }
