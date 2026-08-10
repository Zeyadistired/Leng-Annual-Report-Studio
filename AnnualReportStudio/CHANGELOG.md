# Changelog

All notable changes to Leng (Annual Report Studio).

## [1.0.2] - 2026-08-10

### Changed — LLM second pass: batched, filtered, and ~10x faster on CPU

- **Batched runs with a smart filter.** "Run LLM Pass" now only sends items the model can actually change — text snippets (always), the 60–90% band where the top-2 candidate gap is under 15 pts, and tray items with a candidate above 40% — showing "X of N items need the LLM" before anything runs. Eligible items are grouped 6–8 per request (system prompt once, strict JSON array in/out, `max_tokens` ≈ 60/item, reasoning capped at 12 words); everything else keeps its deterministic result.
- **Background run with live progress.** Results stream into the queue as each batch lands, the progress line shows "i / N · ~T min left" with a Cancel button, and partial results are persisted — a cancelled run keeps its progress. Acceptance on a 16 GB CPU-only ThinkPad: ~80-item review completes in minutes and the first batch shows within 60 s.
- **Assist model selector + retuned server flags.** AI Assist settings now offer "Assist model: qwen3:1.7b fast (default) / qwen3:4b quality" (auto-downloads on switch, verified by SHA-256). The server now spawns with `--reasoning off --ctx-size 2048 --parallel 2 --threads <physical cores> -fa on` — the same tuning that earlier cut single calls from 70.4 s to 6.3 s, now with a smaller KV cache and two warm slots so batches overlap instead of serializing.

## [1.0.1] - 2026-08-10

### Fixed — Disabled Qwen3 reasoning at server spawn (11x faster second pass)

- `llama-server.exe` is now spawned with `--reasoning off --ctx-size 4096 --parallel 1` (re-tuned in 1.0.2 to `2048 / 2`). Measured on a CPU-only laptop, the old default spawned the server with Qwen3's built-in thinking enabled, so every second-pass call first wrote a multi-hundred-token internal essay: a single scoring call took 70.4 s and 20% of runs returned an empty answer (the 200-token cap was eaten by thinking, forcing the `reasoning_content` fallback). With `--reasoning off` the same call takes 6.3 s with a clean JSON answer and zero reasoning tokens, and the smaller context/parallel allocation cuts memory and wasted prefill for the large prompt queue. The `chat_template_kwargs: { think: false }` / prompt-suppression alternatives were tested against the real b10331 server and are ineffective (the flag is the only switch this build honors).

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
