const fs = require('fs');
const path = require('path');

const baseConfig = require('../config/openclaw.config');

const localConfigPath = path.join(process.cwd(), 'config', 'openclaw.local.json');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (!isObject(source)) return target;

  return Object.entries(source).reduce((next, [key, value]) => {
    if (isObject(value) && isObject(next[key])) {
      next[key] = deepMerge({ ...next[key] }, value);
    } else if (value !== undefined) {
      next[key] = value;
    }
    return next;
  }, { ...target });
}

function loadLocalConfig() {
  if (!fs.existsSync(localConfigPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${localConfigPath}: ${error.message}`);
  }
}

function loadConfig() {
  return deepMerge(baseConfig, loadLocalConfig());
}

module.exports = {
  loadConfig,
  localConfigPath,
};
