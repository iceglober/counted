import { CenteredPage } from "../components/layout";
import { ActionLink } from "../components/action-link";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@counted/ui/components/empty";

export default function NotFound() {
  return (
    <CenteredPage>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={1}>
            Page not found
          </EmptyTitle>
          <EmptyDescription>
            This page may have moved, or the address may be incomplete.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <ActionLink href="/">Back to Counted</ActionLink>
        </EmptyContent>
      </Empty>
    </CenteredPage>
  );
}
