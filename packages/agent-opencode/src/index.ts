/**
 * The package root exports ONLY the plugin.
 *
 * OpenCode's loader calls every function this module exports as a plugin, so
 * anything else here would be invoked with the plugin input as its argument.
 */
export { CountedPlugin } from "./plugin";
export { default } from "./plugin";
