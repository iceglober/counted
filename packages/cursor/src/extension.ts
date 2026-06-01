import * as vscode from "vscode";
import { Analytics } from "@counted/sdk";

let analytics: Analytics | null = null;
let statusBar: vscode.StatusBarItem;
let eventCount = 0;
const sessionStart = Date.now();

function getConfig() {
  const config = vscode.workspace.getConfiguration("counted");
  return {
    projectKey: config.get<string>("projectKey", ""),
    host: config.get<string>("host", "https://app.counted.dev"),
    trackFileSaves: config.get<boolean>("trackFileSaves", true),
    trackTerminal: config.get<boolean>("trackTerminal", true),
    trackSessions: config.get<boolean>("trackSessions", true),
  };
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    cs: "csharp",
    php: "php",
    sql: "sql",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "shell",
    zsh: "shell",
    bash: "shell",
    toml: "toml",
    xml: "xml",
    vue: "vue",
    svelte: "svelte",
  };
  return map[ext] ?? ext;
}

function relativePath(uri: vscode.Uri): string {
  const workspace = vscode.workspace.getWorkspaceFolder(uri);
  if (workspace) {
    return uri.fsPath.replace(workspace.uri.fsPath, "").replace(/^\//, "");
  }
  return uri.fsPath.split("/").slice(-2).join("/");
}

function initAnalytics() {
  const config = getConfig();
  if (!config.projectKey) return;

  analytics?.destroy();
  analytics = new Analytics({
    projectKey: config.projectKey,
    host: config.host,
    sessionTimeout: 0,
    flushInterval: 30_000,
  });

  eventCount = 0;
  updateStatusBar();

  if (config.trackSessions) {
    analytics.track("session_start", {
      editor: vscode.env.appName,
      editorVersion: vscode.version,
    });
  }
}

function updateStatusBar() {
  if (analytics) {
    statusBar.text = `$(pulse) ${eventCount}`;
    statusBar.tooltip = `Counted: ${eventCount} events tracked this session`;
    statusBar.color = undefined;
  } else {
    statusBar.text = "$(pulse) Counted";
    statusBar.tooltip = "Counted: No project key configured";
    statusBar.color = new vscode.ThemeColor("statusBarItem.warningForeground");
  }
}

export function activate(context: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    10,
  );
  statusBar.command = "counted.showStatus";
  statusBar.show();
  context.subscriptions.push(statusBar);

  initAnalytics();

  // Re-init when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("counted")) {
        initAnalytics();
      }
    }),
  );

  // Track file saves
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!analytics || !getConfig().trackFileSaves) return;
      analytics.track("file_save", {
        path: relativePath(doc.uri),
        language: languageFromPath(doc.uri.fsPath),
      });
      eventCount++;
      updateStatusBar();
    }),
  );

  // Track file creates
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles((e) => {
      if (!analytics || !getConfig().trackFileSaves) return;
      for (const file of e.files) {
        analytics.track("file_create", {
          path: relativePath(file),
          language: languageFromPath(file.fsPath),
        });
        eventCount++;
      }
      updateStatusBar();
    }),
  );

  // Track file deletes
  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles((e) => {
      if (!analytics || !getConfig().trackFileSaves) return;
      for (const file of e.files) {
        analytics.track("file_delete", {
          path: relativePath(file),
        });
        eventCount++;
      }
      updateStatusBar();
    }),
  );

  // Track terminal open/close
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => {
      if (!analytics || !getConfig().trackTerminal) return;
      analytics.track("terminal_open", {});
      eventCount++;
      updateStatusBar();
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => {
      if (!analytics || !getConfig().trackTerminal) return;
      analytics.track("terminal_close", {});
      eventCount++;
      updateStatusBar();
    }),
  );

  // Set project key command
  context.subscriptions.push(
    vscode.commands.registerCommand("counted.setProjectKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Counted project key",
        placeHolder: "ck_...",
        password: false,
      });
      if (key) {
        await vscode.workspace
          .getConfiguration("counted")
          .update("projectKey", key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          "Counted: Project key saved. Analytics active.",
        );
      }
    }),
  );

  // Show status command
  context.subscriptions.push(
    vscode.commands.registerCommand("counted.showStatus", () => {
      const config = getConfig();
      const durationMin = Math.round((Date.now() - sessionStart) / 60_000);
      const message = config.projectKey
        ? `Counted is active.\n\nEvents this session: ${eventCount}\nSession duration: ${durationMin}m\nFile tracking: ${config.trackFileSaves ? "on" : "off"}\nTerminal tracking: ${config.trackTerminal ? "on" : "off"}`
        : "Counted is not configured. Run 'Counted: Set Project Key' to get started.";
      vscode.window.showInformationMessage(message);
    }),
  );
}

export function deactivate() {
  if (analytics && getConfig().trackSessions) {
    analytics.track("session_end", {
      durationMs: Date.now() - sessionStart,
      eventCount,
    });
  }
  analytics?.destroy();
  analytics = null;
}
