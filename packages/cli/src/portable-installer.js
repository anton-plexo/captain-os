import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates');
const MARKERS = ['<!-- captain-os-managed:start -->', '<!-- captain-os-managed:end -->'];
const CONFIG_TEMPLATES = {
  'project.yaml': 'captain-os.project.yaml',
  'task-spine.yaml': 'task-spine.yaml',
  'owner-registry.yaml': 'owner-registry.yaml',
  'runtime-adapters.yaml': 'runtime-adapters.yaml',
};
const MANAGED_BLOCKS = { 'AGENTS.md': 'AGENTS.managed-block.md', 'CLAUDE.md': 'CLAUDE.managed-block.md' };

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
}

export function upsertManagedBlock(host, block) {
  const [start, end] = MARKERS;
  const starts = host.split(start).length - 1;
  const ends = host.split(end).length - 1;
  if (starts !== ends || starts > 1) throw new Error('malformed or duplicate Captain OS managed markers');
  if (!starts) return `${host}${host && !host.endsWith('\n') ? '\n' : ''}${block}`;
  const from = host.indexOf(start);
  const to = host.indexOf(end, from) + end.length;
  return host.slice(0, from) + block.trimEnd() + host.slice(to);
}

export function buildInstallPlan(root = process.cwd()) {
  const operations = [];
  for (const [target, template] of Object.entries(CONFIG_TEMPLATES)) {
    const file = path.join(root, '.captain-os', target);
    if (!fs.existsSync(file)) operations.push({ file, content: readTemplate(template), kind: 'create' });
  }
  const lock = path.join(root, '.captain-os.lock.json');
  if (!fs.existsSync(lock)) operations.push({ file: lock, content: readTemplate('captain-os.lock.json'), kind: 'create' });
  for (const [target, template] of Object.entries(MANAGED_BLOCKS)) {
    const file = path.join(root, target);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const content = upsertManagedBlock(before, readTemplate(template));
    if (content !== before) operations.push({ file, content, kind: before ? 'update-managed-block' : 'create' });
  }
  return operations;
}

export function applyInstallPlan(operations) {
  const staged = operations.map((op) => ({ ...op, tmp: `${op.file}.captain-os-tmp-${process.pid}` }));
  try {
    for (const op of staged) {
      fs.mkdirSync(path.dirname(op.file), { recursive: true });
      fs.writeFileSync(op.tmp, op.content, 'utf8');
    }
    for (const op of staged) fs.renameSync(op.tmp, op.file);
  } finally {
    for (const op of staged) if (fs.existsSync(op.tmp)) fs.rmSync(op.tmp);
  }
}

export function runPortableInstall({ apply = false, root = process.cwd() } = {}) {
  const plan = buildInstallPlan(root);
  console.log(`${apply ? 'Apply' : 'Dry-run'}: ${plan.length} Captain OS file operation(s)`);
  for (const op of plan) console.log(`- ${op.kind}: ${path.relative(root, op.file)}`);
  if (apply) applyInstallPlan(plan);
  return plan;
}
