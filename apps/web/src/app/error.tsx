"use client";

import { CenteredPage } from "../components/layout";
import { Button } from "@counted/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@counted/ui/components/empty";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <CenteredPage>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={1}>
            This page couldn’t be loaded
          </EmptyTitle>
          <EmptyDescription>
            Try again to pick up where you left off.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={reset}>Try again</Button>
        </EmptyContent>
      </Empty>
    </CenteredPage>
  );
}
