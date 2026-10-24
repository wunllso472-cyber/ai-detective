import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfig } from './config.mjs';

// 轻量 JSON 文件存储。每次操作都直接读写磁盘：Next.js 开发模式下不同路由可能各有一份模块实例，不能依赖内存状态。

function dir(...parts) {
  const p = path.join(getConfig().dataDir, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

// ---------- 集合（小列表，整体读写） ----------
function collectionFile(name) {
  return path.join(dir(), `${name}.json`);
}

export function list(name) {
  return readJson(collectionFile(name), []);
}

export function get(name, id) {
  return list(name).find((x) => x.id === id) || null;
}

export function upsert(name, item) {
  const items = list(name);
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = item;
  else items.unshift(item);
  writeJson(collectionFile(name), items);
  return item;
}

export function update(name, id, patch) {
  const items = list(name);
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  items[i] = { ...items[i], ...(typeof patch === 'function' ? patch(items[i]) : patch) };
  writeJson(collectionFile(name), items);
  return items[i];
}

export function remove(name, id) {
  writeJson(collectionFile(name), list(name).filter((x) => x.id !== id));
}

// ---------- 大对象（查证结果、调查报告，一个文件一份） ----------
export function saveDoc(kind, id, data) {
  writeJson(path.join(dir(kind), `${id}.json`), data);
  return data;
}

export function loadDoc(kind, id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) return null;
  return readJson(path.join(dir(kind), `${id}.json`), null);
}

// ---------- 搜索缓存 ----------
export function cacheGet(key, maxAgeMs) {
  const file = path.join(dir('cache'), crypto.createHash('md5').update(key).digest('hex') + '.json');
  const hit = readJson(file, null);
  if (hit && Date.now() - hit.t < maxAgeMs) return hit.v;
  return null;
}

export function cacheSet(key, value) {
  const file = path.join(dir('cache'), crypto.createHash('md5').update(key).digest('hex') + '.json');
  writeJson(file, { t: Date.now(), v: value });
}
