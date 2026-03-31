-- AI Footprint — Neovim plugin
-- Git-native provenance tracking for AI-generated code.
--
-- Provides diagnostics, virtual text, signs, commands, and a report
-- floating window — all powered by the ai-footprint CLI.

local M = {}

-- ----------------------------------------------------------------
-- Configuration
-- ----------------------------------------------------------------

M.config = {
  -- Path to the ai-footprint CLI
  cli_path = "ai-footprint",
  -- Scan on file save
  scan_on_save = true,
  -- Scan on BufEnter
  scan_on_enter = true,
  -- Fuzzy matching threshold
  fuzzy_threshold = 0.6,
  -- AST matching threshold
  ast_threshold = 0.65,
  -- Enable tree-sitter native matching
  enable_treesitter = true,
  -- Virtual text settings
  virtual_text = {
    enabled = true,
    prefix = "🤖 ",
    hl_group = "Comment",
  },
  -- Sign column
  signs = {
    enabled = true,
    text = "AI",
    hl = "DiagnosticWarn",
  },
  -- Diagnostics
  diagnostics = {
    enabled = true,
    severity = vim.diagnostic.severity.WARN,
    -- Only create diagnostics for unattributed pattern matches
    unattributed_only = false,
  },
  -- Floating window report
  float = {
    border = "rounded",
    max_width = 100,
    max_height = 30,
  },
}

-- ----------------------------------------------------------------
-- State
-- ----------------------------------------------------------------

local ns = vim.api.nvim_create_namespace("ai_footprint")
local sign_group = "AiFootprint"
local cached_matches = {} -- { [bufnr] = { matches... } }
local last_report = nil

-- ----------------------------------------------------------------
-- CLI execution
-- ----------------------------------------------------------------

---Run the ai-footprint CLI and return parsed JSON output.
---@param args string[] CLI arguments
---@param cwd? string Working directory
---@param callback fun(result: table|nil, err: string|nil)
local function run_cli(args, cwd, callback)
  local cmd = { M.config.cli_path, unpack(args) }
  local stdout_chunks = {}
  local stderr_chunks = {}

  vim.fn.jobstart(cmd, {
    cwd = cwd,
    stdout_buffered = true,
    stderr_buffered = true,
    on_stdout = function(_, data)
      if data then
        for _, line in ipairs(data) do
          if line ~= "" then
            table.insert(stdout_chunks, line)
          end
        end
      end
    end,
    on_stderr = function(_, data)
      if data then
        for _, line in ipairs(data) do
          if line ~= "" then
            table.insert(stderr_chunks, line)
          end
        end
      end
    end,
    on_exit = function(_, code)
      if code ~= 0 then
        local err = table.concat(stderr_chunks, "\n")
        callback(nil, err)
        return
      end
      local raw = table.concat(stdout_chunks, "\n")
      local ok, result = pcall(vim.json.decode, raw)
      if ok then
        callback(result, nil)
      else
        callback(nil, "Failed to parse JSON: " .. raw:sub(1, 200))
      end
    end,
  })
end

-- ----------------------------------------------------------------
-- Rendering
-- ----------------------------------------------------------------

---Clear all AI Footprint decorations for a buffer.
---@param bufnr number
local function clear_decorations(bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
  pcall(vim.fn.sign_unplace, sign_group, { buffer = bufnr })
  if M.config.diagnostics.enabled then
    vim.diagnostic.reset(ns, bufnr)
  end
end

---Apply decorations (virtual text, signs, diagnostics) for scan matches.
---@param bufnr number
---@param matches table[]
local function apply_decorations(bufnr, matches)
  clear_decorations(bufnr)
  if #matches == 0 then return end

  local diagnostics = {}

  for _, match in ipairs(matches) do
    local line = match.line - 1 -- 0-indexed

    -- Virtual text
    if M.config.virtual_text.enabled then
      local tag
      if match.snippet then
        local label = match.snippet.model or match.snippet.source
        tag = string.format("%s [%s]", match.matchType or "snippet", label)
      else
        tag = string.format("pattern [%s]", match.pattern or "?")
      end

      local sim = ""
      if match.similarity then
        sim = string.format(" %d%%", math.floor(match.similarity * 100))
      end

      local text = string.format(
        "%s%s (%s)%s",
        M.config.virtual_text.prefix,
        tag,
        match.confidence,
        sim
      )

      pcall(vim.api.nvim_buf_set_extmark, bufnr, ns, line, 0, {
        virt_text = { { text, M.config.virtual_text.hl_group } },
        virt_text_pos = "eol",
        priority = 100,
      })
    end

    -- Signs
    if M.config.signs.enabled then
      pcall(vim.fn.sign_place, 0, sign_group, "AiFootprintSign", bufnr, {
        lnum = match.line,
        priority = 10,
      })
    end

    -- Diagnostics
    if M.config.diagnostics.enabled then
      local skip = M.config.diagnostics.unattributed_only and match.snippet ~= nil
      if not skip then
        local msg
        if match.snippet then
          local label = match.snippet.model or match.snippet.source
          msg = string.format(
            "AI Footprint: %s [%s] (%s)",
            match.matchType or "snippet",
            label,
            match.confidence
          )
        else
          msg = string.format(
            "AI Footprint: pattern [%s] (%s) — unattributed",
            match.pattern or "?",
            match.confidence
          )
        end

        table.insert(diagnostics, {
          bufnr = bufnr,
          lnum = line,
          col = 0,
          severity = M.config.diagnostics.severity,
          source = "ai-footprint",
          message = msg,
        })
      end
    end
  end

  if #diagnostics > 0 then
    vim.diagnostic.set(ns, bufnr, diagnostics)
  end
end

-- ----------------------------------------------------------------
-- Scanning
-- ----------------------------------------------------------------

---Scan a single file and apply decorations.
---@param bufnr? number Buffer to scan (defaults to current)
function M.scan_file(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  local filepath = vim.api.nvim_buf_get_name(bufnr)
  if filepath == "" then return end

  local cwd = vim.fn.getcwd()
  local rel = filepath
  if filepath:sub(1, #cwd) == cwd then
    rel = filepath:sub(#cwd + 2)
  end

  run_cli({ "scan", cwd, "--json" }, cwd, function(report, err)
    if err then
      vim.schedule(function()
        vim.notify("[ai-footprint] " .. err, vim.log.levels.WARN)
      end)
      return
    end

    if not report or not report.matches then return end

    -- Filter matches for this file
    local file_matches = {}
    for _, match in ipairs(report.matches) do
      if match.file == rel then
        table.insert(file_matches, match)
      end
    end

    cached_matches[bufnr] = file_matches
    last_report = report

    vim.schedule(function()
      if vim.api.nvim_buf_is_valid(bufnr) then
        apply_decorations(bufnr, file_matches)
      end
    end)
  end)
end

---Scan the entire workspace.
---@param callback? fun(report: table|nil)
function M.scan_workspace(callback)
  local cwd = vim.fn.getcwd()

  run_cli({ "scan", cwd, "--json" }, cwd, function(report, err)
    vim.schedule(function()
      if err then
        vim.notify("[ai-footprint] " .. err, vim.log.levels.ERROR)
        if callback then callback(nil) end
        return
      end

      last_report = report

      -- Update decorations for all open buffers
      if report and report.matches then
        local by_file = {}
        for _, match in ipairs(report.matches) do
          by_file[match.file] = by_file[match.file] or {}
          table.insert(by_file[match.file], match)
        end

        for _, buf in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_loaded(buf) then
            local name = vim.api.nvim_buf_get_name(buf)
            local rel = name
            if name:sub(1, #cwd) == cwd then
              rel = name:sub(#cwd + 2)
            end
            local matches = by_file[rel] or {}
            cached_matches[buf] = matches
            if vim.api.nvim_buf_is_valid(buf) then
              apply_decorations(buf, matches)
            end
          end
        end
      end

      if callback then callback(report) end
    end)
  end)
end

-- ----------------------------------------------------------------
-- Register snippet
-- ----------------------------------------------------------------

---Register selected text as an AI snippet.
---@param source? string Source label (default: from config)
---@param model? string Model name
function M.register_selection(source, model)
  local mode = vim.fn.mode()
  local lines

  if mode == "v" or mode == "V" or mode == "\22" then
    -- Visual mode — get selection
    vim.cmd('normal! "zy')
    local text = vim.fn.getreg("z")
    lines = vim.split(text, "\n")
  else
    vim.notify("[ai-footprint] Select code first (visual mode)", vim.log.levels.WARN)
    return
  end

  local content = table.concat(lines, "\n")
  if #content < 10 then
    vim.notify("[ai-footprint] Selection too short", vim.log.levels.WARN)
    return
  end

  -- Write to temp file
  local tmp = vim.fn.tempname() .. ".txt"
  local f = io.open(tmp, "w")
  if not f then
    vim.notify("[ai-footprint] Cannot create temp file", vim.log.levels.ERROR)
    return
  end
  f:write(content)
  f:close()

  local args = {
    "add-snippet",
    "--file", tmp,
    "--source", source or "ai",
  }
  if model and model ~= "" then
    table.insert(args, "--model")
    table.insert(args, model)
  end

  run_cli(args, vim.fn.getcwd(), function(result, err)
    os.remove(tmp)
    vim.schedule(function()
      if err then
        vim.notify("[ai-footprint] " .. err, vim.log.levels.ERROR)
      else
        vim.notify("[ai-footprint] Snippet registered", vim.log.levels.INFO)
        -- Re-scan current file
        M.scan_file()
      end
    end)
  end)
end

-- ----------------------------------------------------------------
-- Floating report window
-- ----------------------------------------------------------------

---Show the scan report in a floating window.
function M.show_report()
  local report = last_report
  if not report then
    vim.notify("[ai-footprint] No scan results. Run :AiFootprintScan first.", vim.log.levels.INFO)
    return
  end

  local lines = {
    "AI Footprint Report",
    string.rep("─", 50),
    string.format("Files analyzed:          %d", report.filesAnalyzed or 0),
    string.format("AI-attributed files:     %d", report.aiAttributedFiles or 0),
    string.format("Unattributed suspicious: %d", report.unattributedSuspicious or 0),
    string.format("Top model:               %s", report.topModel or "(none)"),
    "",
    "Matches:",
    string.rep("─", 50),
  }

  if report.matches then
    for _, match in ipairs(report.matches) do
      local tag
      if match.snippet then
        local label = match.snippet.model or match.snippet.source
        tag = string.format("%s [%s]", match.matchType or "snippet", label)
      else
        tag = string.format("pattern [%s]", match.pattern or "?")
      end

      local sim = ""
      if match.similarity then
        sim = string.format(" %d%%", math.floor(match.similarity * 100))
      end

      table.insert(lines, string.format(
        "  %s:%d  %s  (%s)%s",
        match.file, match.line, tag, match.confidence, sim
      ))
    end
  end

  if not report.matches or #report.matches == 0 then
    table.insert(lines, "  (no matches)")
  end

  -- Create floating window
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_set_option_value("modifiable", false, { buf = buf })
  vim.api.nvim_set_option_value("bufhidden", "wipe", { buf = buf })
  vim.api.nvim_set_option_value("filetype", "ai-footprint-report", { buf = buf })

  local width = math.min(M.config.float.max_width, vim.o.columns - 4)
  local height = math.min(M.config.float.max_height, #lines + 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = math.floor((vim.o.lines - height) / 2),
    col = math.floor((vim.o.columns - width) / 2),
    style = "minimal",
    border = M.config.float.border,
    title = " AI Footprint ",
    title_pos = "center",
  })

  -- Close on q or <Esc>
  vim.keymap.set("n", "q", function()
    vim.api.nvim_win_close(win, true)
  end, { buffer = buf, nowait = true })
  vim.keymap.set("n", "<Esc>", function()
    vim.api.nvim_win_close(win, true)
  end, { buffer = buf, nowait = true })
end

-- ----------------------------------------------------------------
-- SBOM export
-- ----------------------------------------------------------------

---Export an SBOM file.
---@param format? string "cyclonedx" or "spdx" (default: cyclonedx)
---@param output? string Output file path
function M.export_sbom(format, output)
  format = format or "cyclonedx"
  output = output or "ai-footprint-sbom.json"
  local cwd = vim.fn.getcwd()

  run_cli({ "sbom", "--format", format, "--output", output }, cwd, function(_, err)
    vim.schedule(function()
      if err then
        vim.notify("[ai-footprint] SBOM export failed: " .. err, vim.log.levels.ERROR)
      else
        vim.notify(string.format("[ai-footprint] SBOM exported to %s (%s)", output, format), vim.log.levels.INFO)
      end
    end)
  end)
end

-- ----------------------------------------------------------------
-- Team commands
-- ----------------------------------------------------------------

function M.team_pull()
  run_cli({ "team", "pull" }, vim.fn.getcwd(), function(_, err)
    vim.schedule(function()
      if err then
        vim.notify("[ai-footprint] team pull failed: " .. err, vim.log.levels.ERROR)
      else
        vim.notify("[ai-footprint] Team snippets pulled", vim.log.levels.INFO)
      end
    end)
  end)
end

function M.team_push()
  run_cli({ "team", "push" }, vim.fn.getcwd(), function(_, err)
    vim.schedule(function()
      if err then
        vim.notify("[ai-footprint] team push failed: " .. err, vim.log.levels.ERROR)
      else
        vim.notify("[ai-footprint] Local snippets pushed to team", vim.log.levels.INFO)
      end
    end)
  end)
end

function M.team_status()
  run_cli({ "team", "status" }, vim.fn.getcwd(), function(_, err)
    vim.schedule(function()
      if err then
        -- team status outputs to stdout, not JSON — this is expected
        vim.notify("[ai-footprint] " .. (err or ""), vim.log.levels.INFO)
      end
    end)
  end)
end

-- ----------------------------------------------------------------
-- Setup & autocommands
-- ----------------------------------------------------------------

---Setup the plugin with user configuration.
---@param opts? table User config overrides
function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})

  -- Define sign
  if M.config.signs.enabled then
    vim.fn.sign_define("AiFootprintSign", {
      text = M.config.signs.text,
      texthl = M.config.signs.hl,
    })
  end

  -- User commands
  vim.api.nvim_create_user_command("AiFootprintScan", function()
    M.scan_workspace(function(report)
      if report then
        vim.notify(string.format(
          "[ai-footprint] Scan complete: %d match(es) in %d files",
          #(report.matches or {}),
          report.filesAnalyzed or 0
        ), vim.log.levels.INFO)
      end
    end)
  end, { desc = "Scan workspace for AI-generated code" })

  vim.api.nvim_create_user_command("AiFootprintScanFile", function()
    M.scan_file()
  end, { desc = "Scan current file for AI-generated code" })

  vim.api.nvim_create_user_command("AiFootprintReport", function()
    M.show_report()
  end, { desc = "Show AI Footprint scan report" })

  vim.api.nvim_create_user_command("AiFootprintRegister", function(cmdargs)
    local source = cmdargs.fargs[1] or "ai"
    local model = cmdargs.fargs[2]
    M.register_selection(source, model)
  end, {
    desc = "Register visual selection as AI snippet",
    nargs = "*",
    range = true,
  })

  vim.api.nvim_create_user_command("AiFootprintSbom", function(cmdargs)
    local format = cmdargs.fargs[1] or "cyclonedx"
    local output = cmdargs.fargs[2] or "ai-footprint-sbom.json"
    M.export_sbom(format, output)
  end, {
    desc = "Export SBOM",
    nargs = "*",
  })

  vim.api.nvim_create_user_command("AiFootprintTeamPull", function()
    M.team_pull()
  end, { desc = "Pull snippets from team registry" })

  vim.api.nvim_create_user_command("AiFootprintTeamPush", function()
    M.team_push()
  end, { desc = "Push snippets to team registry" })

  vim.api.nvim_create_user_command("AiFootprintToggle", function()
    M.config.virtual_text.enabled = not M.config.virtual_text.enabled
    M.config.signs.enabled = not M.config.signs.enabled
    M.config.diagnostics.enabled = not M.config.diagnostics.enabled
    local state = M.config.virtual_text.enabled and "enabled" or "disabled"
    vim.notify("[ai-footprint] Overlays " .. state, vim.log.levels.INFO)

    -- Re-render current buffer
    local bufnr = vim.api.nvim_get_current_buf()
    local matches = cached_matches[bufnr] or {}
    if M.config.virtual_text.enabled then
      apply_decorations(bufnr, matches)
    else
      clear_decorations(bufnr)
    end
  end, { desc = "Toggle AI Footprint overlays" })

  -- Autocommands
  local augroup = vim.api.nvim_create_augroup("AiFootprint", { clear = true })

  if M.config.scan_on_save then
    vim.api.nvim_create_autocmd("BufWritePost", {
      group = augroup,
      pattern = "*",
      callback = function(ev)
        M.scan_file(ev.buf)
      end,
    })
  end

  if M.config.scan_on_enter then
    vim.api.nvim_create_autocmd("BufEnter", {
      group = augroup,
      pattern = "*",
      callback = function(ev)
        -- Only scan if not already cached
        if not cached_matches[ev.buf] then
          M.scan_file(ev.buf)
        end
      end,
    })
  end

  -- Clean up on buffer delete
  vim.api.nvim_create_autocmd("BufDelete", {
    group = augroup,
    pattern = "*",
    callback = function(ev)
      cached_matches[ev.buf] = nil
    end,
  })
end

return M
