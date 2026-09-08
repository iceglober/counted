import type { Metadata } from "next";
import { PageIntro } from "../../../components/site-chrome";
import { Card, CardHeader, CardTitle, CardDescription } from "@counted/ui/components/card";
export const metadata: Metadata = { title: "Blog", alternates: { canonical: "/blog" }, description: "Guides on privacy-first analytics, agent analytics, and self-hosting." };
export default function Blog() { return <><PageIntro title="Blog">Guides on privacy-first analytics, agent analytics, and self-hosting.</PageIntro><Card className="max-w-2xl"><CardHeader><CardTitle>No posts yet.</CardTitle><CardDescription>For setup instructions and examples, visit the <a href="/docs" className="text-primary-ink underline underline-offset-4">documentation</a>.</CardDescription></CardHeader></Card></>; }
