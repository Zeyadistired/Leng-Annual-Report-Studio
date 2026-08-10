const { ipcRenderer } = require('electron');

try {
  window.api = {
    exportPDF: (meta) => ipcRenderer.invoke('export-pdf', meta),
    saveFile: (meta) => ipcRenderer.invoke('export-file', meta),
    pickFiles: () => ipcRenderer.invoke('pick-files'),
    pickDir: () => ipcRenderer.invoke('pick-dir'),
    watchDir: (dir) => ipcRenderer.invoke('watch-dir', dir),
    unwatchDir: () => ipcRenderer.invoke('watch-unwatch'),
    launchStudio: () => ipcRenderer.invoke('launch-studio'),
    closeLauncher: () => ipcRenderer.invoke('launcher-close'),
    llmStatus: () => ipcRenderer.invoke('llm-status'),
    llmRunOne: (payload) => ipcRenderer.invoke('llm-run-one', payload),
    aiState: () => ipcRenderer.invoke('ai-state'),
    aiSetup: (payload) => ipcRenderer.invoke('ai-setup', payload),
    aiSettingsGet: () => ipcRenderer.invoke('ai-settings-get'),
    aiSettingsSet: (patch) => ipcRenderer.invoke('ai-settings-set', patch),
    aiPickModel: () => ipcRenderer.invoke('ai-pick-model'),
    onAiState: (cb) => {
      const h = (_e, st) => cb(st);
      ipcRenderer.on('ai-state-changed', h);
      return () => ipcRenderer.removeListener('ai-state-changed', h);
    },
    onWatchChange: (cb) => {
      const h = (_e, ev, fn) => cb(ev, fn);
      ipcRenderer.on('watch-changed', h);
      return () => ipcRenderer.removeListener('watch-changed', h);
    }
  };
} catch (e) {}
