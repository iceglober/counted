import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@counted/ui/components/alert";
import {
  Empty as UIEmpty,
  EmptyDescription,
  EmptyHeader,
} from "@counted/ui/components/empty";
import { sentenceFor, type Failure } from "../lib/failure";
export const FailureNotice = ({ failure }: { failure: Failure | null }) =>
  failure === null ? null : (
    <Alert variant="destructive" className="my-5">
      <AlertTitle>{sentenceFor(failure)}</AlertTitle>
      <AlertDescription>
        {failure.code}
        {failure.reason === null ? "" : ` · ${failure.reason}`}
      </AlertDescription>
    </Alert>
  );
export const Empty = ({ children }: { children: React.ReactNode }) => (
  <UIEmpty className="min-h-40 border bg-muted/30">
    <EmptyHeader>
      <EmptyDescription>{children}</EmptyDescription>
    </EmptyHeader>
  </UIEmpty>
);
