import fs   from 'fs';
import path from 'path';
import { loadConfig } from '../../../lib/config-loader';

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

function parseWikiLinks(content) {
  const links = new Set();
  const re = /\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) links.add(m[1].trim());
  return [...links];
}

function parseTags(content) {
  const tags = new Set();
  const re = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]+)/gm;
  let m;
  while ((m = re.exec(content)) !== null) tags.add(m[1]);
  return [...tags];
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const config    = loadConfig();
  const rawPath   = config.vault?.localPath || '';

  if (!rawPath) {
    return res.status(200).json({ nodes: [], links: [], warn: 'VAULT_PATH not configured' });
  }

  // localPath may point to a file or a directory — normalise to the vault root
  let vaultDir = rawPath;
  try {
    const stat = fs.statSync(rawPath);
    if (!stat.isDirectory()) vaultDir = path.dirname(rawPath);
  } catch {
    return res.status(200).json({ nodes: [], links: [], warn: 'Configured vault path was not found' });
  }

  const files = walk(vaultDir);
  if (files.length === 0) {
    return res.status(200).json({ nodes: [], links: [], warn: 'No markdown files found' });
  }

  // Build title → node map (title is filename without .md)
  const byTitle = new Map();  // lowercase title → node
  const nodes   = [];

  for (const file of files) {
    const rel    = path.relative(vaultDir, file);
    const parts  = rel.split(path.sep);
    const title  = path.basename(file, '.md');
    const folder = parts.length > 1 ? parts[0] : 'root';
    const id     = rel.replace(/\.md$/, '');

    const node = { id, name: title, group: folder, val: 3 };
    nodes.push(node);
    byTitle.set(title.toLowerCase(), node);
  }

  // Parse links
  const links = [];
  const tagNodes = new Map(); // tag → node

  for (const file of files) {
    const rel   = path.relative(vaultDir, file);
    const srcId = rel.replace(/\.md$/, '');
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

    for (const target of parseWikiLinks(content)) {
      const targetNode = byTitle.get(target.toLowerCase());
      if (targetNode) {
        links.push({ source: srcId, target: targetNode.id });
        // Bump source size per outgoing link
        const srcNode = byTitle.get(path.basename(srcId).toLowerCase());
        if (srcNode) srcNode.val = Math.min(srcNode.val + 0.8, 12);
      }
    }

    for (const tag of parseTags(content)) {
      const tagId = `#${tag}`;
      if (!tagNodes.has(tagId)) {
        const tagNode = { id: tagId, name: `#${tag}`, group: 'tag', val: 2, isTag: true };
        tagNodes.set(tagId, tagNode);
        nodes.push(tagNode);
      }
      links.push({ source: srcId, target: tagId });
    }
  }

  return res.status(200).json({ nodes, links, fileCount: files.length });
}
