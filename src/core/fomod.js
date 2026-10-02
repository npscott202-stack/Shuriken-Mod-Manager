// FOMOD (ModuleConfig.xml) installer support: parsing, step visibility, and file resolution.
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const ARRAYS = new Set([
  'installStep', 'group', 'plugin', 'file', 'folder', 'flag', 'pattern', 'flagDependency', 'fileDependency',
  'dependencies', 'gameDependency', 'fommDependency',
]);

function find(dir, depth = 0) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const fomodDir = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === 'fomod');
  if (fomodDir) {
    const inner = fs.readdirSync(path.join(dir, fomodDir.name));
    const cfg = inner.find((n) => n.toLowerCase() === 'moduleconfig.xml');
    if (cfg) return { root: dir, configPath: path.join(dir, fomodDir.name, cfg) };
  }
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1 && depth < 3) return find(path.join(dir, dirs[0].name), depth + 1);
  return null;
}

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').slice(1);
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf).swap16().toString('utf16le').slice(1);
  return buf.toString('utf8').replace(/^﻿/, '');
}

function parse(configPath) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    isArray: (name) => ARRAYS.has(name),
    trimValues: true,
  });
  const doc = parser.parse(decode(fs.readFileSync(configPath)));
  const cfg = doc.config || {};
  const files = (node) => {
    if (!node) return [];
    const out = [];
    for (const f of node.file || []) out.push({ source: f['@source'], destination: f['@destination'], priority: +(f['@priority'] || 0), isFolder: false });
    for (const f of node.folder || []) out.push({ source: f['@source'], destination: f['@destination'] ?? '', priority: +(f['@priority'] || 0), isFolder: true });
    return out;
  };
  const steps = (cfg.installSteps?.installStep || []).map((step) => ({
    name: step['@name'] || 'Options',
    visible: step.visible || null,
    groups: (step.optionalFileGroups?.group || []).map((grp) => ({
      name: grp['@name'] || '',
      type: grp['@type'] || 'SelectAny',
      plugins: (grp.plugins?.plugin || []).map((pl) => ({
        name: pl['@name'] || '',
        description: typeof pl.description === 'string' ? pl.description : pl.description?.['#text'] || '',
        image: pl.image?.['@path'] || null,
        files: files(pl.files),
        flags: (pl.conditionFlags?.flag || []).map((f) => ({ name: f['@name'], value: typeof f === 'object' ? String(f['#text'] ?? '') : String(f) })),
        typeDescriptor: pl.typeDescriptor || null,
      })),
    })),
  }));
  return {
    moduleName: typeof cfg.moduleName === 'string' ? cfg.moduleName : cfg.moduleName?.['#text'] || '',
    required: files(cfg.requiredInstallFiles),
    steps,
    conditional: (cfg.conditionalFileInstalls?.patterns?.pattern || []).map((p) => ({ dependencies: p.dependencies, files: files(p.files) })),
  };
}

// --- condition evaluation ---
function evalDeps(deps, flags, dataDir) {
  if (!deps) return true;
  const list = Array.isArray(deps) ? deps : [deps];
  return list.every((d) => {
    const op = (d['@operator'] || 'And').toLowerCase();
    const results = [];
    for (const f of d.flagDependency || []) results.push((flags[f['@flag']] || '') === (f['@value'] || ''));
    for (const f of d.fileDependency || []) {
      const exists = dataDir ? fs.existsSync(path.join(dataDir, f['@file'])) : false;
      const st = f['@state'];
      results.push(st === 'Missing' ? !exists : exists);
    }
    for (const nested of d.dependencies || []) results.push(evalDeps(nested, flags, dataDir));
    if (!results.length) return true;
    return op === 'or' ? results.some(Boolean) : results.every(Boolean);
  });
}

function pluginType(plugin, flags, dataDir) {
  const td = plugin.typeDescriptor;
  if (!td) return 'Optional';
  if (td.type) return td.type['@name'] || 'Optional';
  const dt = td.dependencyType;
  if (!dt) return 'Optional';
  for (const p of dt.patterns?.pattern || []) {
    if (evalDeps(p.dependencies, flags, dataDir)) return p.type?.['@name'] || 'Optional';
  }
  return dt.defaultType?.['@name'] || 'Optional';
}

// selections: { [stepIndex]: { [groupIndex]: [pluginIndex, ...] } }
function flagsFrom(parsed, selections, uptoStep = Infinity) {
  const flags = {};
  parsed.steps.forEach((step, si) => {
    if (si >= uptoStep) return;
    const sel = selections[si] || {};
    step.groups.forEach((grp, gi) => {
      for (const pi of sel[gi] || []) for (const f of grp.plugins[pi]?.flags || []) flags[f.name] = f.value;
    });
  });
  return flags;
}

function publicSteps(parsed, root) {
  return parsed.steps.map((s) => ({
    name: s.name,
    groups: s.groups.map((g) => ({
      name: g.name,
      type: g.type,
      plugins: g.plugins.map((p) => ({
        name: p.name,
        description: p.description,
        image: p.image ? path.join(root, p.image.replace(/\//g, '\\')) : null,
      })),
    })),
  }));
}

function nextVisibleStep(parsed, fromIndex, selections, dataDir) {
  for (let i = fromIndex; i < parsed.steps.length; i++) {
    const flags = flagsFrom(parsed, selections, i);
    if (!parsed.steps[i].visible || evalDeps(parsed.steps[i].visible.dependencies || parsed.steps[i].visible, flags, dataDir)) {
      const step = parsed.steps[i];
      return {
        index: i,
        types: step.groups.map((g) => g.plugins.map((p) => pluginType(p, flags, dataDir))),
      };
    }
  }
  return { index: -1 };
}

function resolveFiles(parsed, selections, dataDir) {
  const flags = flagsFrom(parsed, selections);
  const ops = [...parsed.required];
  parsed.steps.forEach((step, si) => {
    const visibleFlags = flagsFrom(parsed, selections, si);
    if (step.visible && !evalDeps(step.visible.dependencies || step.visible, visibleFlags, dataDir)) return;
    const sel = selections[si] || {};
    step.groups.forEach((grp, gi) => {
      grp.plugins.forEach((pl, pi) => {
        const type = pluginType(pl, visibleFlags, dataDir);
        if ((sel[gi] || []).includes(pi) || type === 'Required' || grp.type === 'SelectAll') ops.push(...pl.files);
      });
    });
  });
  for (const c of parsed.conditional) if (evalDeps(c.dependencies, flags, dataDir)) ops.push(...c.files);
  return ops.sort((a, b) => a.priority - b.priority);
}

module.exports = { find, parse, publicSteps, nextVisibleStep, resolveFiles };
