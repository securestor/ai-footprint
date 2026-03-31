# AI Footprint — Neovim Plugin

Neovim plugin for in-editor AI code provenance tracking. Powered by the `ai-footprint` CLI.

## Features

- **Virtual text** — inline attribution labels at end of AI-detected lines
- **Signs** — gutter indicators (configurable icon/highlight)
- **Diagnostics** — integrates with Neovim's built-in diagnostics (trouble.nvim compatible)
- **Floating report** — full scan report in a floating window (`:AiFootprintReport`)
- **Commands** — scan workspace, scan file, register snippets, toggle overlays, export SBOM
- **Auto-scan** — on BufEnter and BufWritePost (configurable)
- **Team support** — pull/push commands for shared team registries

## Requirements

- Neovim 0.9.0+
- `ai-footprint` CLI installed globally: `npm install -g ai-footprint`

## Installation

### lazy.nvim

```lua
{
  "aifootprint/ai-footprint",
  config = function()
    require("ai-footprint").setup({
      -- All options are optional — defaults shown below
      cli_path = "ai-footprint",
      scan_on_save = true,
      scan_on_enter = true,
      fuzzy_threshold = 0.6,
      ast_threshold = 0.65,
      enable_treesitter = true,
      virtual_text = {
        enabled = true,
        prefix = "🤖 ",
        hl_group = "Comment",
      },
      signs = {
        enabled = true,
        text = "AI",
        hl = "DiagnosticWarn",
      },
      diagnostics = {
        enabled = true,
        severity = vim.diagnostic.severity.WARN,
        unattributed_only = false,
      },
    })
  end,
}
```

### packer.nvim

```lua
use {
  "aifootprint/ai-footprint",
  config = function()
    require("ai-footprint").setup()
  end,
}
```

### vim-plug

```vim
Plug 'aifootprint/ai-footprint'
lua require("ai-footprint").setup()
```

## Commands

| Command | Description |
|---|---|
| `:AiFootprintScan` | Scan entire workspace |
| `:AiFootprintScanFile` | Scan current file |
| `:AiFootprintReport` | Show report in floating window |
| `:AiFootprintRegister [source] [model]` | Register visual selection as AI snippet |
| `:AiFootprintToggle` | Toggle overlays (virtual text, signs, diagnostics) |
| `:AiFootprintSbom [format] [output]` | Export SBOM (cyclonedx/spdx) |
| `:AiFootprintTeamPull` | Pull snippets from team registry |
| `:AiFootprintTeamPush` | Push snippets to team registry |

## Lua API

```lua
local fp = require("ai-footprint")

-- Scan
fp.scan_file()                           -- Scan current buffer
fp.scan_workspace(function(report) end)  -- Scan all files

-- Register
fp.register_selection("copilot", "gpt-4.1")  -- Register visual selection

-- Report
fp.show_report()                         -- Floating window

-- SBOM
fp.export_sbom("cyclonedx", "bom.json")

-- Team
fp.team_pull()
fp.team_push()
```

## Integrations

### trouble.nvim

AI Footprint diagnostics appear automatically in trouble.nvim — no extra config needed.

### lualine.nvim

```lua
-- Add to your lualine config
{
  sections = {
    lualine_x = {
      function()
        local fp = require("ai-footprint")
        local buf = vim.api.nvim_get_current_buf()
        local matches = fp.cached_matches and fp.cached_matches[buf]
        if matches and #matches > 0 then
          return "🤖 " .. #matches
        end
        return ""
      end,
    },
  },
}
```

## Architecture

```
neovim/
├── lua/ai-footprint/
│   └── init.lua          # Everything — setup, scanning, rendering, commands
└── README.md
```

The plugin delegates all scanning and matching to the `ai-footprint` CLI. This means
it automatically supports all matching engines (exact, fuzzy, AST, tree-sitter,
heuristic patterns) and features (SBOM, team registry) without duplicating logic.
