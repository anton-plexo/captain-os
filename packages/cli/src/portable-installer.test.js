import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyInstallPlan, buildInstallPlan, upsertManagedBlock } from './portable-installer.js';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'captain-os-install-'));

test('dry-run plan does not write and apply is idempotent', () => {
  const root = temp();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'HOST PREFIX\nHOST SUFFIX\n');
  const plan = buildInstallPlan(root);
  assert.ok(plan.length >= 7);
  assert.equal(fs.existsSync(path.join(root, '.captain-os')), false);
  applyInstallPlan(plan);
  const snapshot = Object.fromEntries(plan.map(({ file }) => [file, fs.readFileSync(file, 'utf8')]));
  assert.equal(buildInstallPlan(root).length, 0);
  for (const [file, content] of Object.entries(snapshot)) assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /^HOST PREFIX/);
});

test('managed block replacement preserves host-owned prefix and suffix', () => {
  const old = 'before\n<!-- captain-os-managed:start -->\nold\n<!-- captain-os-managed:end -->\nafter\n';
  const block = '<!-- captain-os-managed:start -->\nnew\n<!-- captain-os-managed:end -->\n';
  assert.equal(upsertManagedBlock(old, block), `before\n${block.trimEnd()}\nafter\n`);
});

test('malformed and duplicate markers fail before writes', () => {
  assert.throws(() => upsertManagedBlock('<!-- captain-os-managed:start -->', 'x'), /malformed/);
  assert.throws(() => upsertManagedBlock('<!-- captain-os-managed:start --><!-- captain-os-managed:end --><!-- captain-os-managed:start --><!-- captain-os-managed:end -->', 'x'), /duplicate/);
});

test('existing live task spine and config are never replaced', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, '.captain-os'));
  fs.writeFileSync(path.join(root, '.captain-os', 'task-spine.yaml'), 'live-state: keep\n');
  fs.writeFileSync(path.join(root, '.captain-os', 'project.yaml'), 'custom: keep\n');
  applyInstallPlan(buildInstallPlan(root));
  assert.equal(fs.readFileSync(path.join(root, '.captain-os', 'task-spine.yaml'), 'utf8'), 'live-state: keep\n');
  assert.equal(fs.readFileSync(path.join(root, '.captain-os', 'project.yaml'), 'utf8'), 'custom: keep\n');
});
