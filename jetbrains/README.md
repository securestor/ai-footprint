# AI Footprint — JetBrains Plugin

IntelliJ IDEA / WebStorm / PyCharm plugin for in-editor AI code provenance tracking.

## Features

- **Inline annotations** — gutter icons and background highlights on AI-attributed lines
- **Tool window** — full scan report with model, confidence, and similarity details
- **Inspections** — Problems panel entries for unattributed AI code (with quick-fix to register)
- **Status bar widget** — live match count, click to open report
- **Actions** — Scan Project, Scan Current File, Register Selection, Toggle Overlay
- **Settings** — configurable CLI path, thresholds, severity, display options

## Requirements

- IntelliJ IDEA 2024.1+ (or any JetBrains IDE based on the IntelliJ Platform)
- `ai-footprint` CLI installed globally: `npm install -g ai-footprint`

## Building

```bash
cd jetbrains
./gradlew buildPlugin
```

The plugin ZIP will be in `jetbrains/build/distributions/`.

## Installing

1. Build the plugin (above)
2. In your JetBrains IDE: **Settings → Plugins → ⚙️ → Install Plugin from Disk...**
3. Select the ZIP file from `build/distributions/`
4. Restart the IDE

## Development

```bash
# Run a sandboxed IDE instance with the plugin loaded
./gradlew runIde

# Run tests
./gradlew test
```

## Architecture

```
jetbrains/
├── build.gradle.kts          # Gradle build config (IntelliJ Platform Plugin)
├── settings.gradle.kts
├── src/main/
│   ├── kotlin/com/aifootprint/jetbrains/
│   │   ├── FootprintStartupActivity.kt   # Initial scan on IDE startup
│   │   ├── actions/Actions.kt            # All IDE actions
│   │   ├── annotator/
│   │   │   ├── FootprintExternalAnnotator.kt  # Editor annotations
│   │   │   └── FootprintLineMarkerProvider.kt # Gutter icons
│   │   ├── inspection/UnattributedAiInspection.kt  # Problems panel
│   │   ├── model/Models.kt               # Data classes (ScanMatch, ScanReport)
│   │   ├── service/FootprintService.kt   # Core service (CLI integration)
│   │   ├── settings/
│   │   │   ├── FootprintSettings.kt      # Persistent settings
│   │   │   └── FootprintSettingsConfigurable.kt  # Settings UI
│   │   ├── statusbar/FootprintStatusBar.kt  # Status bar widget
│   │   └── toolwindow/FootprintToolWindowFactory.kt  # Bottom panel
│   └── resources/
│       ├── META-INF/plugin.xml
│       └── icons/ai-footprint-13.svg
└── README.md
```

## How it works

The plugin calls the `ai-footprint` CLI as an external process. All scanning, matching,
and registry management is handled by the CLI — the plugin is a presentation layer that
integrates results into the JetBrains IDE experience.

This means the plugin automatically benefits from all matching engines (exact, fuzzy, AST,
tree-sitter, heuristic patterns) without duplicating any logic.
