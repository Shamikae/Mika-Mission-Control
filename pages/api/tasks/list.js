import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!fs.existsSync(DATA_FILE)) return res.status(200).json([]);
    const tasks = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return res.status(200).json(Array.isArray(tasks) ? tasks : []);
  } catch {
    return res.status(200).json([]);
  }
}
