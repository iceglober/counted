/**
 * What a handler module is handed: the ports, and the implementer that
 * authorizes.
 *
 * One type rather than two parameters everywhere, so adding a dependency is a
 * change to this file and not to ten signatures.
 */

import type { ApiDependencies } from "../deps";
import type { Base } from "./base";

export type HandlerDeps = {
  readonly deps: ApiDependencies;
  readonly guarded: Base["guarded"];
};
