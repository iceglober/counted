export const primitiveGroups = [
  {
    name: "Actions",
    items: [
      ["button", "Button", "A clear hierarchy for every action."],
      ["button-group", "Button group", "Related actions, held together."],
      ["toggle", "Toggle", "An action with a persistent state."],
      ["toggle-group", "Toggle group", "Choose a view or a set of options."],
    ],
  },
  {
    name: "Forms",
    items: [
      ["field", "Field", "Labels, help, validation, and control rhythm."],
      ["input", "Input", "Single-line text with clear interaction states."],
      [
        "input-group",
        "Input group",
        "Text inputs with useful context and actions.",
      ],
      ["textarea", "Textarea", "Space for a longer thought."],
      ["label", "Label", "A visible, connected name for a control."],
      ["select", "Select", "A compact, keyboard-friendly list of options."],
      ["combobox", "Combobox", "Find an option as you type."],
      ["checkbox", "Checkbox", "Independent choices and mixed selections."],
      ["radio-group", "Radio group", "One choice from a visible set."],
      ["switch", "Switch", "An immediate on or off setting."],
      ["slider", "Slider", "Adjust a value or a range."],
    ],
  },
  {
    name: "Structure",
    items: [
      ["card", "Card", "A consistent anatomy for contained content."],
      ["separator", "Separator", "A quiet boundary between related groups."],
      ["tabs", "Tabs", "Related content, one panel at a time."],
      ["accordion", "Accordion", "Reveal supporting information on demand."],
      [
        "collapsible",
        "Collapsible",
        "A compact disclosure for optional detail.",
      ],
      ["breadcrumb", "Breadcrumb", "A readable path through a hierarchy."],
      ["pagination", "Pagination", "Move through a bounded collection."],
    ],
  },
  {
    name: "Display",
    items: [
      ["badge", "Badge", "Compact status, metadata, and counts."],
      ["avatar", "Avatar", "An image or a reliable text fallback."],
      ["table", "Table", "Aligned columns with a deliberate reading rhythm."],
      ["chart", "Chart", "Responsive data with shared colors and tooltips."],
      ["kbd", "Keyboard key", "Readable hints for keyboard shortcuts."],
    ],
  },
  {
    name: "Feedback",
    items: [
      ["alert", "Alert", "Useful context at the point of attention."],
      ["empty", "Empty", "An absent result with a useful next action."],
      ["progress", "Progress", "A measured amount of work, without a spinner."],
      [
        "skeleton",
        "Skeleton",
        "Loading placeholders that preserve the layout.",
      ],
      ["toast", "Toast", "Brief, dismissible feedback after an action."],
    ],
  },
  {
    name: "Overlays",
    items: [
      ["dialog", "Dialog", "A focused task with a contained form."],
      [
        "alert-dialog",
        "Alert dialog",
        "A deliberate checkpoint before an action.",
      ],
      ["sheet", "Sheet", "Supporting content in a side panel."],
      ["popover", "Popover", "A small interaction beside its trigger."],
      [
        "dropdown-menu",
        "Dropdown menu",
        "Contextual commands with keyboard support.",
      ],
      ["tooltip", "Tooltip", "A little explanation, on hover or focus."],
    ],
  },
] as const;

export const primitives = primitiveGroups.flatMap((group) =>
  group.items.map(([id, title, description]) => ({
    id,
    title,
    description,
    group: group.name,
  })),
);

export const aggregates = [
  {
    id: "sidebar-shell",
    title: "Sidebar application",
    description:
      "Persistent navigation, a page header, and a flexible content frame. On smaller screens, navigation moves into a sheet and the content gets the full width.",
    components: ["button", "badge", "card", "sheet"],
    layout: true,
  },
  {
    id: "top-navigation-shell",
    title: "Top navigation application",
    description:
      "A workspace switcher and a compact navigation bar above a centered page. Collections form a two-column grid when there is room and a single column on phones.",
    components: ["button", "badge", "card", "empty", "select", "tabs"],
    layout: true,
  },
  {
    id: "editor-shell",
    title: "Editor & inspector",
    description:
      "A document canvas with a collapsible properties panel. On phones, properties open in a sheet so the document retains its reading width. Select a section and edit it live.",
    components: ["button", "badge", "field", "input", "textarea", "sheet"],
    layout: true,
  },
  {
    id: "master-detail",
    title: "Collection & detail",
    description:
      "Search a collection, inspect a record, and keep the surrounding context in view.",
    components: [
      "input-group",
      "badge",
      "button",
      "tabs",
      "empty",
      "separator",
    ],
  },
  {
    id: "data-workspace",
    title: "Data workspace",
    description:
      "Compare readings, change the interval, and inspect a responsive chart.",
    components: ["card", "chart", "toggle-group", "badge", "select"],
  },
  {
    id: "settings-form",
    title: "Settings form",
    description:
      "A complete form with grouped fields, validation, and a visible save result.",
    components: [
      "field",
      "input",
      "textarea",
      "select",
      "switch",
      "button",
      "alert",
    ],
  },
  {
    id: "collection-table",
    title: "Collection table",
    description:
      "Search, select, paginate, and act on a small collection of records.",
    components: [
      "table",
      "checkbox",
      "dropdown-menu",
      "input-group",
      "badge",
      "pagination",
    ],
  },
  {
    id: "record-tabs",
    title: "Record with tabs",
    description:
      "Overview, activity, and editable details within one consistent frame.",
    components: ["card", "tabs", "badge", "field", "input", "button"],
  },
  {
    id: "review-flow",
    title: "Review & confirm",
    description:
      "Edit in a dialog, review a summary, and confirm with clear feedback.",
    components: [
      "dialog",
      "alert-dialog",
      "field",
      "input",
      "select",
      "toast",
      "button",
    ],
  },
] as const;

export const foundations = [
  ["overview", "Overview"],
  ["color", "Color"],
  ["typography", "Typography"],
  ["space", "Space & shape"],
  ["icons", "Iconography"],
  ["interaction", "Interaction"],
  ["getting-started", "Using the library"],
] as const;
