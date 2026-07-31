/**
 * A DOM, so the effect tests actually run.
 *
 * Without one, `test.skipIf(typeof document === "undefined")` skipped silently
 * and the only test that could have caught the dependency bug never executed
 * once. A skipped test reads as a passing suite.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// React's `act` refuses to run without it, and warns on every state update.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
