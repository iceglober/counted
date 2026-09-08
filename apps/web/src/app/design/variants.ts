import type { exampleMap } from "./example-map";

export const exampleVariants = {
  button: [
    "default",
    "outline",
    "secondary",
    "ghost",
    "destructive",
    "link",
    "with-icon",
    "disabled",
    "xs",
    "sm",
    "lg",
    "icon",
    "icon-xs",
    "icon-sm",
    "icon-lg",
  ],
  "button-group": ["horizontal", "vertical", "with-text"],
  toggle: [
    "default",
    "outline",
    "with-label",
    "pressed",
    "disabled",
    "sm",
    "lg",
  ],
  "toggle-group": ["single", "multiple", "default", "vertical", "sm", "lg"],
  field: ["vertical", "horizontal", "responsive", "invalid", "disabled"],
  input: ["default", "invalid", "disabled", "read-only", "password", "number"],
  "input-group": ["search", "prefix", "password", "suffix"],
  textarea: ["default", "empty", "invalid", "disabled", "read-only"],
  label: ["input", "checkbox", "required", "disabled"],
  select: ["single", "multiple", "placeholder", "small", "invalid", "disabled"],
  combobox: ["single", "multiple", "clearable", "invalid", "disabled", "empty"],
  checkbox: [
    "unchecked",
    "checked",
    "indeterminate",
    "with-description",
    "invalid",
    "disabled",
  ],
  "radio-group": ["default", "horizontal", "with-description", "disabled"],
  switch: ["checked", "unchecked", "small", "with-description", "disabled"],
  slider: ["single", "range", "vertical", "disabled"],
  card: ["default", "small", "with-footer"],
  separator: ["horizontal", "vertical"],
  tabs: ["default", "line", "vertical", "disabled-tab"],
  accordion: ["single", "multiple", "disabled"],
  collapsible: ["closed", "open", "disabled"],
  breadcrumb: ["default", "custom-separator"],
  pagination: ["default", "middle-page", "last-page"],
  badge: [
    "default",
    "secondary",
    "outline",
    "success",
    "warning",
    "destructive",
    "ghost",
    "link",
    "with-icon",
  ],
  avatar: ["default", "small", "large", "group"],
  table: ["default", "selected-row", "empty"],
  chart: ["area", "line", "bar"],
  kbd: ["single", "combination"],
  alert: ["default", "destructive", "without-icon"],
  empty: ["with-action", "without-action", "without-icon"],
  progress: ["determinate", "complete", "empty", "indeterminate"],
  skeleton: ["card", "text", "row"],
  toast: ["success", "error", "info", "warning", "loading", "with-action"],
  dialog: ["form", "information", "without-close-button"],
  "alert-dialog": ["default", "small", "with-icon"],
  sheet: ["right", "left", "top", "bottom"],
  popover: ["bottom", "top", "left", "right"],
  "dropdown-menu": ["actions", "checkboxes", "radio", "submenu"],
  tooltip: ["top", "bottom", "left", "right"],
} as const satisfies Record<
  keyof typeof exampleMap,
  readonly [string, ...string[]]
>;

export function variantLabel(value: string, primitive?: string) {
  if (primitive === "accordion" && value === "multiple") return "Multiple open";
  if (primitive === "accordion" && value === "single") return "Single open";
  const names: Record<string, string> = {
    multiple: "Multi-select",
    single: "Single",
    xs: "Extra small",
    sm: "Small",
    lg: "Large",
    "icon-xs": "Icon · extra small",
    "icon-sm": "Icon · small",
    "icon-lg": "Icon · large",
  };
  return (
    names[value] ??
    value[0]!.toUpperCase() + value.slice(1).replaceAll("-", " ")
  );
}
