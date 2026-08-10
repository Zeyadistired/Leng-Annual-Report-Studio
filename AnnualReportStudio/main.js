const { app, BrowserWindow, dialog, session, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./lib/store');
const createAi = require('./lib/ai');

let win = null;
let launcher = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'Leng — Nile University',
    icon: path.join(__dirname, 'assets/icon.ico'),
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: '#F4F5F7',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('app.html');

  win.webContents.on('will-navigate', (e, url) => {
    const cur = win.webContents.getURL();
    if (url !== cur) e.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith('data:')) return { action: 'allow' };
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
}

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1040,
    height: 620,
    useContentSize: true,
    title: 'Leng — Nile University',
    icon: path.join(__dirname, 'assets/icon.ico'),
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#F4F5F7',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  launcher.loadFile('app.html', { query: { mode: 'launcher' } });
  launcher.on('closed', () => { launcher = null; });
}

function setupDownloads() {
  session.defaultSession.on('will-download', (e, item) => {
  e.preventDefault();
  const defaultPath = path.join(app.getPath('downloads'), item.getFilename());
  dialog.showSaveDialog(win, { defaultPath, filters: [{ name: 'All files', extensions: ['*'] }] })
    .then(r => {
      if (!r.canceled && r.filePath) {
        item.setSavePath(r.filePath);
        item.once('done', (ev, state) => {
          if (state === 'completed' && win) win.webContents.executeJavaScript('toast("File saved: ' + JSON.stringify(path.basename(r.filePath)).replace(/"/g, '\\"') + '")').catch(() => {});
        });
        item.resume();
      }
    })
    .catch(() => {});
  });
}

app.whenReady().then(() => {
  ipcMain.handle('export-pdf', async (e, meta) => {
    if (!win) return { ok: false, error: 'No active window.' };
    try {
      const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', marginsType: 0 });
      const year = meta && meta.year ? Number(meta.year) : new Date().getFullYear();
      const defaultPath = path.join(app.getPath('documents'), 'NU Annual Report ' + year + '-' + (year + 1) + '.pdf');
      const r = await dialog.showSaveDialog(win, {
        title: 'Export PDF',
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['createDirectory']
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      let filePath = r.filePath;
      if (path.extname(filePath).toLowerCase() !== '.pdf') filePath += '.pdf';
      await fs.promises.writeFile(filePath, data);
      shell.showItemInFolder(filePath);
      return { ok: true, path: filePath };
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (win) dialog.showErrorBox('Export failed', msg);
      return { ok: false, error: msg };
    }
  });
  ipcMain.handle('export-file', async (e, meta) => {
    if (!win) return { ok: false, error: 'No active window.' };
    try {
      const defaultPath = path.join(app.getPath('documents'), meta.defaultName);
      const r = await dialog.showSaveDialog(win, {
        title: meta.title || 'Export',
        defaultPath,
        filters: meta.filters || [{ name: 'All files', extensions: ['*'] }],
        properties: ['createDirectory']
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      let filePath = r.filePath;
      const ext = '.' + (meta.filters && meta.filters[0] && meta.filters[0].extensions[0] || '');
      if (ext !== '.' && path.extname(filePath).toLowerCase() !== ext) filePath += ext;
      const buffer = meta.encoding === 'base64' ? Buffer.from(meta.data, 'base64') : Buffer.from(meta.data, 'utf8');
      await fs.promises.writeFile(filePath, buffer);
      shell.showItemInFolder(filePath);
      return { ok: true, path: filePath };
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (win) dialog.showErrorBox('Export failed', msg);
      return { ok: false, error: msg };
    }
  });
  ipcMain.handle('pick-files', async () => {
    if (!win) return { ok: false, error: 'No active window.' };
    const r = await dialog.showOpenDialog(win, {
      title: 'Import owner submissions',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Owner submissions', extensions: ['xlsx', 'xls', 'docx', 'doc', 'pdf'] }]
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, paths: r.filePaths };
  });
  ipcMain.handle('pick-dir', async () => {
    if (!win) return { ok: false, error: 'No active window.' };
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose submission watch folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  });
  let watcher = null;
  ipcMain.handle('watch-dir', (e, dir) => {
    try {
      if (watcher) { watcher.close(); watcher = null; }
      if (dir) {
        watcher = fs.watch(dir, { persistent: false }, (ev, fn) => {
          if (win && !win.isDestroyed()) win.webContents.send('watch-changed', ev, fn);
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });
  ipcMain.handle('watch-unwatch', () => {
    try { if (watcher) { watcher.close(); watcher = null; } } catch (e) {}
    return { ok: true };
  });
  ipcMain.handle('launch-studio', () => {
    if (!win || win.isDestroyed()) createWindow();
    win.maximize();
    win.show();
    win.focus();
    if (launcher && !launcher.isDestroyed()) launcher.close();
    return { ok: true };
  });
  ipcMain.handle('launcher-close', () => {
    if (launcher && !launcher.isDestroyed()) launcher.close();
    return { ok: true };
  });
  /* ------- Self-contained AI Assist (zero-touch bootstrap) ------- */
  const store = new Store({ cwd: app.getPath('userData'), name: 'settings', defaults: { ai: { source: 'default', wizardDone: false, enabled: false } } });
  const ai = createAi({
    store,
    binDir: path.join(app.getPath('userData'), 'bin'),
    modelDir: path.join(app.getPath('userData'), 'models'),
    onState: (st) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send('ai-state-changed', st);
      } catch (e) {}
    }
  });
  ipcMain.handle('ai-state', async () => ai.state());
  ipcMain.handle('ai-setup', async (_e, payload) => ai.setup(String((payload || {}).action || 'retry')));
  ipcMain.handle('ai-settings-get', async () => ai.state());
  ipcMain.handle('ai-settings-set', async (_e, patch) => ai.applySettings(patch));
  ipcMain.handle('ai-pick-model', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose local model file (.gguf)',
      properties: ['openFile'],
      filters: [{ name: 'GGUF models', extensions: ['gguf'] }]
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  });
  ai.probeManaged();
  ai.autoStart();
  setInterval(() => ai.probeManaged(), 8000);

  /* ------- Local LLM / AI pass (endpoint from settings, default 127.0.0.1:11434) ------- */
  function llmProbe() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, version, error) => {
        if (done) return;
        done = true;
        resolve({ ok, version, error });
      };
      const http = require('http');
      const zlib = require('zlib');
      const paths = ['/health', '/version'];
      const tryPath = (idx) => {
        if (idx >= paths.length) return finish(false, '', 'no response');
        try {
          const req = http.get(ai.endpoint() + paths[idx], { timeout: 1500, headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => {
              try {
                if (/gzip/i.test(String(res.headers['content-encoding'] || ''))) b = zlib.gunzipSync(Buffer.from(b)).toString('utf8');
                const j = JSON.parse(b);
                if (paths[idx] === '/health') {
                  if (res.statusCode === 200 && j.status === 'ok') finish(true, '', '');
                  else if (res.statusCode === 404) tryPath(idx + 1);
                  else finish(false, '', 'loading');
                } else {
                  finish(true, String(j.version || ''), '');
                }
              } catch (e) { tryPath(idx + 1); }
            });
          });
          req.on('error', (e) => tryPath(idx + 1));
          req.on('timeout', () => { req.destroy(); finish(false, '', 'timeout'); });
        } catch (e) {
          finish(false, '', String(e && e.message ? e.message : e));
        }
      };
      tryPath(0);
    });
  }
  async function llmChat(model, system, user, maxTokens) {
    const ep = ai.endpoint();
    if (ai.managed()) {
      const res = await fetch(ep + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: String(model || 'qwen3:1.7b'),
          messages: [
            { role: 'system', content: String(system || '') },
            { role: 'user', content: String(user || '') }
          ],
          temperature: 0,
          stream: false,
          max_tokens: maxTokens || 512
        }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) throw new Error('AI server HTTP ' + res.status);
      const j = await res.json();
      const msg = j && j.choices && j.choices[0] && j.choices[0].message || {};
      const content = msg.content || msg.reasoning_content;
      if (!content) throw new Error('AI server empty response');
      return content;
    }
    const res = await fetch(ep + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: String(model || 'qwen3:1.7b'),
        messages: [
          { role: 'system', content: String(system || '') },
          { role: 'user', content: String(user || '') }
        ],
        stream: false,
        options: { temperature: 0, num_predict: maxTokens || 512 }
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
    const j = await res.json();
    const msg = j && j.message || {};
    const content = msg.content || msg.reasoning_content;
    if (!content) throw new Error('Ollama empty response');
    return content;
  }
  ipcMain.handle('llm-status', async () => {
    const p = await llmProbe();
    return { ok: p.ok, version: p.version, error: p.error, url: ai.endpoint() };
  });
  ipcMain.handle('llm-run-one', async (e, payload) => {
    try {
      const out = await llmChat(payload && payload.model, payload && payload.system, payload && payload.user, payload && payload.maxTokens);
      return { ok: true, out };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });
  createLauncher();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createLauncher();
  });
  app.on('will-quit', () => {
    ai.stop();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
