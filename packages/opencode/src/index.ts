// Package root — exports ONLY the native OpenCode plugin. OpenCode's loader
// calls every function exported by this module as a plugin, so exposing the
// helper API here would make it call init(pluginInput) and wreck the singleton.
// The low-level helpers live at the "@counted/opencode/api" subpath instead.
export { CountedPlugin } from "./plugin";
export { default } from "./plugin";
