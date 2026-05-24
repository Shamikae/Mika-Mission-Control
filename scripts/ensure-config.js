#!/usr/bin/env node
const fs = require('fs');
const { localConfigPath } = require('../lib/config-loader');

if (!fs.existsSync(localConfigPath)) {
  console.log('No local config found. Starting setup wizard first.\n');
  require('./setup');
}
