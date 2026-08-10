# Changelog

All notable changes to Leng (Annual Report Studio).

## [1.0.0] - 2026-08-09

### Added — Self-contained AI assist (zero-touch local bootstrap)

- **First-run AI Assist Setup wizard.** On first launch, Leng offers "Enable AI Assist" or "Skip" (deterministic mode). Enabling downloads the pinned llama.cpp server release and the Qwen3-4B Q4_K_M model (~3 GB total) into `%APPDATA%\Leng` with a per-step progress bar, SHA256 verification, and cancel support; skipping never blocks the app.

- **Managed local server, no installer bloat.** Nothing AI-related is bundled in the installer — on first enable, the server archive is downloaded, unzipped, verified, and `llama-server.exe` is spawned on a free localhost port (endpoint saved to settings). The LLM second pass client now reads its endpoint from settings (default `http://127.0.0.1:11434`), and failures degrade gracefully to "AI: Off" deterministic mode.

- **Model source settings (Default / Custom / Local).** Sources can be switched in AI Assist settings — Custom URL points the pinned downloads at a mirror, and Local File skips downloads entirely (USB / LAN distribution in air-gapped environments), verified by SHA-256 when using official sources.

- **AI Assist panel on the top bar.** No more first-run popup: an "AI Assist Setup" button sits under the Target Year selector and opens a settings panel showing model name, server/model install status, endpoint and version, an editable system prompt (with restore-default), and the source options. A status chip on the panel header reflects the AI state at a glance.

- **AI Assist panel renders as a centered overlay.** The panel now opens as a fixed, viewport-centered modal (dimmed backdrop) instead of an in-flow block pinned to the bottom-left corner, so it stays centered regardless of scroll position.

- **AI server auto-starts on launch.** If AI Assist was enabled and the server/model files are installed, Leng probes the saved endpoint and respawns `llama-server.exe` automatically at startup — no more "AI: Off" until you hand-click after every restart. A periodic probe (every 8 s) keeps the status chip truthful if the server ever dies. Buttons relabel to "Start AI server" / "Start AI" once files are installed instead of promising a download.

- **Fixed: AI server probe against llama.cpp b10331.** The new llama.cpp server rejects clients that do not negotiate gzip (HTTP 415) and serves its web UI instead of JSON on `/` — the readiness probe used to misread this and time out ("AI server did not become ready") exactly 120 s after "Start AI", while the panel looked stuck at "Downloading 0%". Probing now checks `/health` (model loaded) with a `/version` fallback, negotiates `Accept-Encoding: gzip`, and decompresses responses. The busy panel also stopped lying: it shows "Server installed / Model installed — starting AI server" with real progress instead of static "Downloading…" headings, and responses from the reasoning model fall back to `reasoning_content` when `content` comes back empty.

## [1.0.0] - 2026-08-06

### Added — Local LLM second pass (Ollama, 127.0.0.1:11434)

- **One-click LLM second pass.** Imported files now get a deterministic extraction and match pass, followed by an optional "Run LLM pass" (qwen3:4b via Ollama `/api/chat`, temperature 0) that re-scores tray/review items against report variables. Promotions are blended 50/50 between LLM confidence and the deterministic score, and the queue is re-ranked by blended confidence with the model's reasoning shown on each chip.

- **Type-gate guard on LLM proposals.** An LLM suggestion whose proposed value does not fit the target variable's type (e.g., a percentage proposed for a count variable, or narrative text proposed for a number) is never accepted — it stays in the tray with an explicit "does not fit" reason. This closes the "number proposed for a text variable" class of bug.

- **Structured prompts with domain context.** Each prompt carries the snippet, source context (file/ref/page), the target report section (Learning Pillar, Schools, etc.), and up to five scored candidates with last-year values and types — so the local model can check semantic equivalence and magnitude sanity before proposing a match.
