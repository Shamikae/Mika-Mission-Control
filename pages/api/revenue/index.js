import fs   from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'revenue.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { brands: [], daily: [], updatedAt: null, weekStart: null };
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export default function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(load());
  }

  if (req.method === 'POST') {
    // Update a single brand's weekTotal and trend, or a daily entry's revenue.
    // Body: { type: 'brand', id, weekTotal, trend }
    //    or { type: 'daily', date, revenue, tasks, approvals }
    const { type, id, date, ...fields } = req.body || {};
    const data = load();

    if (type === 'brand') {
      const idx = data.brands.findIndex(b => b.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Brand not found' });
      data.brands[idx] = { ...data.brands[idx], ...fields };
    } else if (type === 'daily') {
      const idx = data.daily.findIndex(d => d.date === date);
      if (idx === -1) return res.status(404).json({ error: 'Date not found' });
      data.daily[idx] = { ...data.daily[idx], ...fields };
    } else {
      return res.status(400).json({ error: 'type must be "brand" or "daily"' });
    }

    data.updatedAt = new Date().toISOString().split('T')[0];
    save(data);
    return res.status(200).json({ ok: true, data });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
