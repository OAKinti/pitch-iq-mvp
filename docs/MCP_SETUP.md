# MCP Server Setup

`.mcp.json` (committed, project scope) pre-wires **build123d-mcp** for the hardware CAD track.
Claude Code asks you to approve project MCP servers the first time it starts in this repo.

## 1. build123d-mcp (required for HUMAN GATE 2 / hardware sprint)

PyPI: `build123d-mcp` (0.3.91 as of Nov 22 2026, Python 3.11–3.14). Source: github.com/pzfreo/build123d-mcp

```jsonc
// .mcp.json (already committed)
{ "mcpServers": { "build123d": { "command": "uv", "args": ["tool", "run", "--python", "3.12", "build123d-mcp@latest"] } } }
```

**Person A (CAD owner) setup on Windows:**
1. Install `uv` once. Run `winget install --id=astral-sh.uv -e` or, in PowerShell, `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`. Then open a new terminal.
2. Smoke test: `uv tool run --python 3.12 build123d-mcp@latest --version`. The first run downloads Python 3.12 and OpenCascade wheels, roughly 300 MB.
3. In this repo, start `claude`, approve the `build123d` server, and run `/mcp`. It should show `build123d · connected`.
4. In Claude: "Use build123d `install_skill` with target `claude` and skill `modeling`". This is optional; the repo already has `.claude/skills/eyewear-cad-rulebook`.

Tools used by the rulebook: `execute` (run build123d code in the persistent session), `show` (register a part by name), `get_object`, `validate` (pre-export solid check), `inspect_features` (measurements), `diff_step` (compare revisions with `render`), `import_cad_file`, plus PNG/SVG/DXF preview and STEP/STL/DXF export.

Fallback when the MCP server is unavailable: `uv run --python 3.12 --with build123d hardware/glasses/build.py`. See `eyewear-cad-rulebook` §7.

## 2. Figma MCP (optional — UI polish, Person B)

Figma ships an official remote MCP server. Connect it as a **claude.ai connector** at claude.ai/customize/connectors, or locally:
```
claude mcp add --transport http figma https://mcp.figma.com/mcp
```
Use it to pull frames into `src/screens/` *through* the `design-tokens` skill. Figma hex values must map to existing tokens and never be pasted raw. Keep it out of cloud routines; remove it from their Connectors tab.

## 3. Maestro MCP (optional — Day 5 simulator QA)

Maestro runs `.maestro/mvp-smoke.yaml` against an iOS Simulator or Android emulator with a Dev Client or Expo Go build.
1. Install the Maestro CLI (see maestro.mobile.dev; on Windows, use WSL2 or Android Studio's emulator with the Windows CLI).
2. Register the MCP server bundled with the CLI: `claude mcp add maestro -- maestro mcp`.
3. Start an emulator, run `npx expo start --android`, then ask `ui-qa-verifier` to run the smoke flow.
Cloud routines have no simulator, so tag simulator tasks `[device]` in `SPRINT_STATE.md`.

## Security notes
- Approve only the servers listed here. Project `.mcp.json` is code-reviewed like any other file.
- MCP servers run with your user permissions. Never put API keys in `.mcp.json`; use env vars referenced by the server.
