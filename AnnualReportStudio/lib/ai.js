const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const zlib = require('zlib');
const unzip = require('./unzip');

const PINNED = {
  serverUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10331/llama-b10331-bin-win-cpu-x64.zip',
  serverSha256: 'defec84d389193c87aa3038d2bd6b8cb7ee0c2afcabfe04fcd069343f828e848',
  serverZip: 'llama-b10331-bin-win-cpu-x64.zip',
  serverExe: 'llama-server.exe',
  modelUrl: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
  modelSha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
  modelFile: 'Qwen3-4B-Q4_K_M.gguf',
  defaultEndpoint: 'http://127.0.0.1:11434'
};

module.exports = function createAi(opts) {
  const store = opts.store;
  const binDir = opts.binDir;
  const modelDir = opts.modelDir;
  const hooks = opts.testHooks || {};
  const onState = opts.onState || (() => {});
  const conf = Object.assign({}, PINNED, hooks.conf || {});

  let serverProc = null;
  let abortCtrl = null;
  let phase = 'idle';
  let error = '';
  let progress = { server: 0, model: 0 };
  let version = '';
  let endpoint = '';

  function broadcast() { onState(state()); }

  function state() {
    return {
      phase,
      error,
      progress: Object.assign({}, progress),
      version,
      endpoint: endpoint || '',
      wizardDone: !!store.get('ai.wizardDone'),
      enabled: !!store.get('ai.enabled'),
      source: store.get('ai.source', 'default'),
      customServerUrl: store.get('ai.customServerUrl', ''),
      customModelUrl: store.get('ai.customModelUrl', ''),
      localModelPath: store.get('ai.localModelPath', ''),
      modelFile: conf.modelFile,
      binDir,
      modelDir,
      serverReady: hasServer(),
      modelReady: modelExists()
    };
  }

  function hasServer() {
    try { return fs.existsSync(path.join(binDir, conf.serverExe)) && fs.statSync(path.join(binDir, conf.serverExe)).size > 0; } catch (e) { return false; }
  }

  function modelPath() { return path.join(modelDir, conf.modelFile); }

  function modelExists() {
    try { return fs.existsSync(modelPath()) && fs.statSync(modelPath()).size > 0; } catch (e) { return false; }
  }

  function sha256File(p) {
    return new Promise((res, rej) => {
      try {
        const h = crypto.createHash('sha256');
        const s = fs.createReadStream(p);
        s.on('data', d => h.update(d));
        s.on('end', () => res(h.digest('hex')));
        s.on('error', rej);
      } catch (e) { rej(e); }
    });
  }

  async function realDownload(url, dest, kind, signal) {
    const res = await fetch(url, { signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + kind + ' download (' + url.slice(0, 90) + ')');
    const total = Number(res.headers.get('content-length') || 0);
    const out = fs.createWriteStream(dest);
    const reader = res.body.getReader();
    let got = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      got += value.length;
      if (kind === 'server') progress.server = total ? Math.round(got / total * 100) : -1;
      else progress.model = total ? Math.round(got / total * 100) : -1;
      broadcast();
    }
    await new Promise(r => out.end(r));
  }

  async function download(url, dest, kind) {
    const ac = new AbortController();
    abortCtrl = ac;
    try {
      if (hooks.download) {
        await new Promise((resolve, reject) => {
          hooks.download({ url, dest, kind, progress, signal: ac.signal }, err => err ? reject(new Error(err)) : resolve());
        });
      } else {
        await realDownload(url, dest, kind, ac.signal);
      }
    } finally {
      if (abortCtrl === ac) abortCtrl = null;
    }
  }

  function getFreePort() {
    return new Promise((res, rej) => {
      const srv = net.createServer();
      srv.once('error', rej);
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => res(port));
      });
    });
  }

  function spawnServer(exe, args) {
    if (hooks.spawnServer) return hooks.spawnServer(exe, args);
    const proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
    proc.on('error', () => {});
    return proc;
  }

  function probe(ep, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, ver, err) => {
        if (!done) { done = true; resolve({ ok, version: ver || '', error: err || '' }); }
      };
      const paths = ['/health', '/version'];
      const tryPath = (idx) => {
        if (idx >= paths.length) return finish(false, '', 'no response');
        try {
          const req = http.get(ep + paths[idx], { timeout: timeoutMs || 1200, headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
            let b = '';
            res.on('data', c => { b += c; });
            res.on('end', () => {
              try {
                if (/gzip/i.test(String(res.headers['content-encoding'] || ''))) b = zlib.gunzipSync(Buffer.from(b)).toString('utf8');
                const j = JSON.parse(b);
                if (paths[idx] === '/health') {
                  if (res.statusCode === 200 && j.status === 'ok') finish(true, '');
                  else if (res.statusCode === 404) tryPath(idx + 1);
                  else finish(false, '', 'loading');
                } else {
                  finish(true, String(j.version || ''));
                }
              } catch (e) { tryPath(idx + 1); }
            });
          });
          req.on('error', e => tryPath(idx + 1));
          req.on('timeout', () => { req.destroy(); finish(false, '', 'timeout'); });
        } catch (e) {
          finish(false, '', String(e && e.message ? e.message : e));
        }
      };
      tryPath(0);
    });
  }

  async function waitReady(ep, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const p = await probe(ep, 1000);
      if (p.ok) return p;
      await new Promise(r => setTimeout(r, 400));
    }
    return probe(ep, 1200);
  }

  async function ensureServer(src) {
    const exe = path.join(binDir, conf.serverExe);
    if (hasServer()) { progress.server = 100; broadcast(); return exe; }
    fs.mkdirSync(binDir, { recursive: true });
    let url = conf.serverUrl;
    if (src === 'custom' && store.get('ai.customServerUrl')) url = store.get('ai.customServerUrl');
    const zipPath = path.join(binDir, conf.serverZip + '.part');
    const finZip = path.join(binDir, conf.serverZip);
    progress.server = 0;
    broadcast();
    await download(url, zipPath, 'server');
    const h = await sha256File(zipPath);
    const expected = (hooks.conf && hooks.conf.serverSha256) || conf.serverSha256;
    if (expected && h.toLowerCase() !== String(expected).toLowerCase()) throw new Error('Server archive checksum mismatch (SHA256)');
    fs.renameSync(zipPath, finZip);
    try { fs.unlinkSync(zipPath); } catch (e) {}
    unzip.extract(finZip, binDir);
    const found = unzip.findFile(binDir, conf.serverExe);
    if (!found) throw new Error('llama-server.exe not found in downloaded archive');
    progress.server = 100;
    broadcast();
    return found;
  }

  async function ensureModel(src) {
    fs.mkdirSync(modelDir, { recursive: true });
    if (src === 'local') {
      const lp = store.get('ai.localModelPath', '');
      if (!lp || !fs.existsSync(lp) || fs.statSync(lp).size === 0) throw new Error('Local model file not found: ' + (lp || '(empty)'));
      progress.model = 100;
      broadcast();
      return lp;
    }
    const dest = modelPath();
    let url = conf.modelUrl;
    if (src === 'custom' && store.get('ai.customModelUrl')) url = store.get('ai.customModelUrl');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      if (src === 'default') {
        const expected = (hooks.conf && hooks.conf.modelSha256) || conf.modelSha256;
        if (expected) {
          const h = await sha256File(dest);
          if (h.toLowerCase() === String(expected).toLowerCase()) { progress.model = 100; return dest; }
        } else {
          progress.model = 100;
          return dest;
        }
      } else {
        progress.model = 100;
        return dest;
      }
    }
    progress.model = 0;
    broadcast();
    const tmp = dest + '.part';
    await download(url, tmp, 'model');
    if (src === 'default') {
      const expected = (hooks.conf && hooks.conf.modelSha256) || conf.modelSha256;
      if (expected) {
        const h = await sha256File(tmp);
        if (h.toLowerCase() !== String(expected).toLowerCase()) {
          try { fs.unlinkSync(tmp); } catch (e) {}
          throw new Error('Model checksum mismatch (SHA256)');
        }
      }
    }
    fs.renameSync(tmp, dest);
    try { fs.unlinkSync(tmp); } catch (e) {}
    progress.model = 100;
    broadcast();
    return dest;
  }

  async function runSetup() {
    const src = store.get('ai.source', 'default');
    phase = 'busy';
    error = '';
    progress = { server: 0, model: 0 };
    broadcast();
    try {
      const exe = await ensureServer(src);
      const modelFile = await ensureModel(src);
      const port = await getFreePort();
      serverProc = spawnServer(exe, ['--host', '127.0.0.1', '--port', String(port), '--model', modelFile]);
      const ep = 'http://127.0.0.1:' + port;
      const ready = await waitReady(ep, 120000);
      if (!ready.ok) throw new Error('llama-server did not become ready: ' + (ready.error || 'timeout'));
      endpoint = ep;
      version = ready.version || '';
      store.set('ai.endpoint', ep);
      store.set('ai.enabled', true);
      phase = 'ready';
    } catch (e) {
      error = String(e && e.message ? e.message : e);
      phase = 'error';
      store.set('ai.enabled', false);
      stopServer();
    }
    broadcast();
    return state();
  }

  function stopServer() {
    try {
      if (serverProc && serverProc.pid !== undefined && serverProc.pid > 0) {
        try { process.kill(serverProc.pid); } catch (e) {}
      }
    } catch (e) {}
    serverProc = null;
  }

  function cancel() {
    try { if (abortCtrl) abortCtrl.abort(); } catch (e) {}
  }

  function setEnabled(on) {
    store.set('ai.enabled', !!on);
    if (!on) { cancel(); stopServer(); endpoint = ''; phase = 'off'; }
    broadcast();
  }

  function setup(action) {
    store.set('ai.wizardDone', true);
    if (action === 'skip' || action === 'disable' || action === 'cancel') {
      cancel();
      stopServer();
      endpoint = '';
      phase = 'off';
      store.set('ai.enabled', false);
      broadcast();
      return Promise.resolve(state());
    }
    if (action === 'enable' || action === 'retry') {
      store.set('ai.enabled', true);
      return runSetup();
    }
    return Promise.resolve(state());
  }

  function applySettings(patch) {
    patch = patch || {};
    if (patch.source !== undefined) store.set('ai.source', String(patch.source));
    if (patch.customServerUrl !== undefined) store.set('ai.customServerUrl', String(patch.customServerUrl));
    if (patch.customModelUrl !== undefined) store.set('ai.customModelUrl', String(patch.customModelUrl));
    if (patch.localModelPath !== undefined) store.set('ai.localModelPath', String(patch.localModelPath));
    if (patch.wizardDone !== undefined) store.set('ai.wizardDone', !!patch.wizardDone);
    return state();
  }

  function probeManaged() {
    if (phase === 'busy') return Promise.resolve(state());
    const ep = store.get('ai.endpoint', '');
    if (!ep) { phase = 'off'; broadcast(); return Promise.resolve(state()); }
    return probe(ep, 1500).then(p => {
      if (p.ok && (p.version || endpoint)) {
        phase = 'ready';
        endpoint = ep;
        version = p.version || version;
      } else {
        phase = 'off';
        endpoint = '';
      }
      broadcast();
      return state();
    });
  }

  function autoStart() {
    if (!store.get('ai.enabled') || !hasServer() || !modelExists()) return Promise.resolve(state());
    const ep = store.get('ai.endpoint', '');
    if (ep) {
      return probe(ep, 1500).then(p => {
        if (p.ok && (p.version || endpoint)) {
          phase = 'ready';
          endpoint = ep;
          version = p.version || version;
          broadcast();
          return state();
        }
        return runSetup();
      });
    }
    return runSetup();
  }

  return {
    state,
    setup,
    cancel,
    setEnabled,
    applySettings,
    probeManaged,
    autoStart,
    stop: stopServer,
    endpoint: () => endpoint || store.get('ai.endpoint', '') || conf.defaultEndpoint,
    managed: () => !!(store.get('ai.endpoint') && phase === 'ready'),
    conf
  };
};