# Counted demo — "Migrate from Aptabase" terminal walkthrough.
#
# Starter artifact for the agentic video pipeline (see internal todos: video
# tutorials). VHS renders a .tape into a crisp gif/mp4 — deterministic, no flaky
# browser, ideal for CLI demos. Add a TTS voiceover track + captions in post
# (ffmpeg / Remotion) for a narrated version.
#
# Render:  brew install vhs ffmpeg && vhs demos/migrate.tape
# Output:  demos/migrate.gif

Output demos/migrate.gif
Set FontSize 20
Set Width 1280
Set Height 640
Set Padding 28
Set Theme "Catppuccin Mocha"

Type "# Move your Aptabase events to Counted — privacy-first, no cookies."
Enter
Sleep 1500ms

Type "npx @counted/migrate --help"
Enter
Sleep 3s

Type "# Point it at your Aptabase ClickHouse, scoped to your app id:"
Enter
Sleep 1200ms

Type 'npx @counted/migrate \'
Enter
Type '  --source-clickhouse "http://default:PASS@aptabase-host:8123" \'
Enter
Type '  --app-id "YOUR_APTABASE_APP_ID" \'
Enter
Type '  --target-key "ck_your_project_key"'
Enter
Sleep 3s

Type "# Same SDKs, composable dashboards — and not a single cookie."
Enter
Sleep 2s
