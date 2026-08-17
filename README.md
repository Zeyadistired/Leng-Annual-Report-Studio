# Leng — Annual Report Studio

Nile University annual report renewal workbench (Electron + local AI).

## Get the ready-to-run app

No build required — download the installer from the latest **Release**:

> **Releases → [Latest release](https://github.com/Zeyadistired/Leng/releases/latest)**

- `Leng Setup 1.0.0.exe` — Windows installer (includes everything; AI model is auto-downloaded on first use)
- `Leng-1.0.2-source.zip` — full source snapshot for anyone who wants it without git

## Build from source

```
npm install
npm start          # run in dev mode
npm run dist       # build the Windows installer (outputs to dist/)
```

## Notes

- Data and AI files live in `%APPDATA%\Leng` (settings, models, bin).
- The AI pass runs a local `llama-server` (Qwen3 1.7B / 4B, downloaded automatically) — no cloud, works offline after setup.