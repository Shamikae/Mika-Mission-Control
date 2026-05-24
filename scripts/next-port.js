#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

const mode = process.argv[2] || 'dev';
const port = process.env.PORT || '3099';
const nextBin = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next',
);

const child = spawn(nextBin, [mode, '-p', port], { stdio: 'inherit' });

child.on('exit', code => {
  process.exit(code || 0);
});
