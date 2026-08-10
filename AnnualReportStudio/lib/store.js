const fs = require('fs');
const path = require('path');

function Store(opts) {
  if (!(this instanceof Store)) return new Store(opts);
  opts = opts || {};
  this.dir = opts.cwd || (typeof process !== 'undefined' && process.cwd ? process.cwd() : '.');
  this.name = opts.name || 'config';
  this.file = path.join(this.dir, this.name + '.json');
  this.data = {};
  if (opts.defaults) this.data = JSON.parse(JSON.stringify(opts.defaults));
  try {
    if (fs.existsSync(this.file)) this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
  } catch (e) {}
}

Store.prototype.path = function () { return this.file; };

Store.prototype.get = function (key, def) {
  const k = String(key || '');
  if (!k) return this.data;
  const parts = k.split('.');
  let cur = this.data;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return def;
    cur = cur[parts[i]];
  }
  return cur === undefined ? def : cur;
};

Store.prototype.set = function (key, value) {
  const k = String(key || '');
  if (!k) return;
  const parts = k.split('.');
  let cur = this.data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
  this._write();
};

Store.prototype.delete = function (key) {
  this.set(key, undefined);
};

Store.prototype.has = function (key) {
  return this.get(key) !== undefined;
};

Store.prototype.clear = function () {
  this.data = {};
  this._write();
};

Store.prototype._write = function () {
  try {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  } catch (e) {}
};

module.exports = Store;
