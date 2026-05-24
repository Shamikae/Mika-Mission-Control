#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { loadConfig, localConfigPath } = require('../lib/config-loader');

const AI_TOOLS = [
  { id: 'claude-code', label: 'Claude Code', commands: ['claude'], apps: ['Claude.app'] },
  { id: 'codex', label: 'Codex CLI', commands: ['codex'] },
  { id: 'cursor', label: 'Cursor', commands: ['cursor'], apps: ['Cursor.app'] },
  { id: 'windsurf', label: 'Windsurf', commands: ['windsurf'], apps: ['Windsurf.app'] },
  { id: 'gemini-cli', label: 'Gemini CLI', commands: ['gemini'] },
  { id: 'aider', label: 'Aider', commands: ['aider'] },
  { id: 'goose', label: 'Goose', commands: ['goose'], apps: ['Goose.app'] },
  { id: 'opencode', label: 'OpenCode', commands: ['opencode'] },
  { id: 'continue', label: 'Continue', commands: ['continue'], apps: ['Continue.app'] },
];

function commandExists(command) {
  const pathValue = process.env.PATH || '';
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  return pathDirs.some(dir => extensions.some(ext => {
    const candidate = path.join(dir, `${command}${ext}`);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }));
}

function appExists(appName) {
  const candidates = process.platform === 'darwin'
    ? [path.join('/Applications', appName), path.join(os.homedir(), 'Applications', appName)]
    : process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', appName.replace('.app', '')),
          path.join(process.env.ProgramFiles || '', appName.replace('.app', '')),
        ]
      : [
          path.join('/usr/share/applications', `${appName.replace('.app', '').toLowerCase()}.desktop`),
          path.join(os.homedir(), '.local/share/applications', `${appName.replace('.app', '').toLowerCase()}.desktop`),
        ];

  return candidates.some(candidate => candidate && fs.existsSync(candidate));
}

function detectAiTools() {
  return AI_TOOLS.map(tool => {
    const command = tool.commands?.find(commandExists) || null;
    const app = tool.apps?.find(appExists) || null;
    return { id: tool.id, label: tool.label, command, app, installed: Boolean(command || app) };
  });
}

function expandHome(input) {
  if (!input) return '';
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2));
  return input;
}

function ask(rl, question, fallback = '') {
  const suffix = fallback ? ` (${fallback})` : '';
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, answer => resolve(answer.trim() || fallback));
  });
}

function writeLocalConfig(localConfig) {
  fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
  fs.writeFileSync(localConfigPath, `${JSON.stringify(localConfig, null, 2)}\n`, 'utf8');
}

async function main() {
  const existing = fs.existsSync(localConfigPath)
    ? JSON.parse(fs.readFileSync(localConfigPath, 'utf8'))
    : {};
  const currentConfig = loadConfig();
  const detectedTools = detectAiTools();
  const installed = detectedTools.filter(tool => tool.installed);

  console.log('\nOpenClaw Mission Control setup\n');
  console.log('Detected AI tools:');
  if (installed.length === 0) {
    console.log('  None found. You can still run the dashboard in mock mode.');
  } else {
    installed.forEach(tool => {
      const via = tool.command ? `command: ${tool.command}` : `app: ${tool.app}`;
      console.log(`  - ${tool.label} (${via})`);
    });
  }

  const defaultVault = existing.vault?.localPath || currentConfig.vault?.localPath || '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const vaultPath = expandHome(await ask(rl, '\nVault path', defaultVault));
  const operatorName = await ask(rl, 'Operator name', existing.ui?.operatorName || currentConfig.ui?.operatorName || 'Command');
  rl.close();

  const localConfig = {
    ...existing,
    vault: {
      ...(existing.vault || {}),
      localPath: vaultPath,
    },
    ui: {
      ...(existing.ui || {}),
      operatorName,
    },
    localAiTools: detectedTools,
  };

  writeLocalConfig(localConfig);
  console.log(`\nWrote ${path.relative(process.cwd(), localConfigPath)}`);
  console.log('Run `npm run dev` to start, or `npm run launch` to install, set up, and start in one command.\n');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
