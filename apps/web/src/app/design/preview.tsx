"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@counted/ui/components/tabs";

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>TSX</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Code copied" : "Copy code"}
          onClick={copy}
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </Button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      {error && (
        <p role="status" className="px-5 pb-4 text-sm">
          Copy is unavailable. Select the code to copy it.
        </p>
      )}
    </div>
  );
}

export function Preview({
  children,
  code,
  label,
  roomy = false,
  controls,
}: {
  children: React.ReactNode;
  code: string;
  label: string;
  roomy?: boolean;
  controls?: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="preview" className="specimen">
      <div className="specimen-toolbar">
        <TabsList variant="line" aria-label={`${label} example view`}>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
        </TabsList>
        {controls ?? <span className="specimen-caption">Live example</span>}
      </div>
      <TabsContent
        value="preview"
        className={roomy ? "specimen-canvas specimen-roomy" : "specimen-canvas"}
      >
        {children}
      </TabsContent>
      <TabsContent value="code">
        <CodeBlock code={code} />
      </TabsContent>
    </Tabs>
  );
}
