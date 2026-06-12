// pages/api/projects/[id]/index.js
import path from 'path';
import fs from 'fs';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid project id' });
  }

  const filePath = path.join(process.cwd(), 'data', 'projects', `${id}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return res.status(200).json(JSON.parse(raw));
  } catch {
    return res.status(404).json({ error: 'Project not found', id });
  }
}
