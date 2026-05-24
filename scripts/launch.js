#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const { localConfigPath } = require('../lib/config-loader');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!fs.existsSync('node_modules')) {
  run('npm', ['install']);
}

if (!fs.existsSync(localConfigPath)) {
  run('node', ['scripts/setup.js']);
}

run('npm', ['run', 'dev']);
