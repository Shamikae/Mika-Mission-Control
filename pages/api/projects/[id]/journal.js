// pages/api/projects/[id]/journal.js
import path from 'path';
import fs from 'fs';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id } = req.query;
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid project id' });
  }

  const { entry } = req.body || {};
  if (!entry || typeof entry !== 'string' || !entry.trim()) {
    return res.status(400).json({ error: 'entry is required' });
  }

  const filePath = path.join(process.cwd(), 'data', 'projects', `${id}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const newEntry = {
      id: `j-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      entry: entry.trim(),
    };
    data.journal = [newEntry, ...data.journal];
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return res.status(200).json(newEntry);
  } catch {
    return res.status(404).json({ error: 'Project not found' });
  }
}
