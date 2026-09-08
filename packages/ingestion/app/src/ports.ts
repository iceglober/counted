/**
 * The ingestion ports, with their aggregate type closed.
 *
 * `EventSink` is generic in the admitted event because `AdmittedEvent` lives
 * in `@counted/ingestion-domain` and a ports package may not import another
 * context's domain — see V3-SPEC §5. This is the one place the parameter is
 * bound, so every use case and every adapter in this context means the same
 * thing by `EventSink`.
 */

import type { AdmittedEvent } from "@counted/ingestion-domain";
import type { EventSink as GenericEventSink } from "@counted/ingestion-ports";

export type EventSink = GenericEventSink<AdmittedEvent>;

export type { IngestQuota, QuotaVerdict, WriteFailure, WriteReceipt } from "@counted/ingestion-ports";
