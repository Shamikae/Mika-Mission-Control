// GET /api/revenue/forecast
// Calculates full forecast from revenue-items.json.

import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();

function readJson(fp, fb) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fb; }
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const revenue = readJson(path.join(ROOT, 'data', 'revenue-items.json'), {}).revenue || [];

  const totalProjected   = revenue.filter(r => r.status !== 'lost').reduce((s, r) => s + (r.amount || 0), 0);
  const weightedForecast = revenue
    .filter(r => r.status !== 'received' && r.status !== 'lost')
    .reduce((s, r) => s + (r.amount || 0) * ((r.probability || 50) / 100), 0);
  const receivedRevenue = revenue.filter(r => r.status === 'received').reduce((s, r) => s + (r.amount || 0), 0);
  const pendingRevenue  = revenue.filter(r => r.status === 'pending' || r.status === 'won').reduce((s, r) => s + (r.amount || 0), 0);
  const lostRevenue     = revenue.filter(r => r.status === 'lost').reduce((s, r) => s + (r.amount || 0), 0);

  // Monthly forecast: group by YYYY-MM
  const monthly = {};
  for (const r of revenue) {
    if (r.status === 'lost') continue;
    const dateKey = r.status === 'received'
      ? (r.receivedDate || r.updatedAt || r.createdAt || '').slice(0, 7)
      : (r.expectedCloseDate || r.createdAt || '').slice(0, 7);
    if (!dateKey || dateKey.length < 7) continue;
    if (!monthly[dateKey]) monthly[dateKey] = { month: dateKey, projected: 0, received: 0, weighted: 0, count: 0 };
    if (r.status === 'received') {
      monthly[dateKey].received += r.amount || 0;
    } else {
      monthly[dateKey].projected += r.amount || 0;
      monthly[dateKey].weighted  += (r.amount || 0) * ((r.probability || 50) / 100);
    }
    monthly[dateKey].count++;
  }
  const monthlyForecast = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));

  // By lane
  const byLane = {};
  for (const r of revenue) {
    const key = r.laneId || 'unassigned';
    if (!byLane[key]) byLane[key] = { laneId: key, total: 0, received: 0, projected: 0, lost: 0 };
    if (r.status === 'received') byLane[key].received += r.amount || 0;
    else if (r.status === 'lost') byLane[key].lost  += r.amount || 0;
    else byLane[key].projected += r.amount || 0;
    if (r.status !== 'lost') byLane[key].total += r.amount || 0;
  }
  const revenueByLane = Object.values(byLane).sort((a, b) => b.total - a.total);

  // By type
  const byType = {};
  for (const r of revenue) {
    const key = r.revenueType || 'service';
    if (!byType[key]) byType[key] = { revenueType: key, total: 0, received: 0, count: 0 };
    if (r.status !== 'lost') byType[key].total += r.amount || 0;
    if (r.status === 'received') byType[key].received += r.amount || 0;
    byType[key].count++;
  }
  const revenueByType = Object.values(byType).sort((a, b) => b.total - a.total);

  // By status
  const byStatus = {};
  for (const r of revenue) {
    const key = r.status || 'projected';
    if (!byStatus[key]) byStatus[key] = { status: key, count: 0, total: 0 };
    byStatus[key].count++;
    byStatus[key].total += r.amount || 0;
  }
  const revenueByStatus = Object.values(byStatus);

  // Upcoming closes (next 60 days, not received/lost)
  const now = new Date();
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today = now.toISOString().split('T')[0];
  const upcomingCloses = revenue
    .filter(r => !['received', 'lost'].includes(r.status) && r.expectedCloseDate && r.expectedCloseDate <= in60)
    .sort((a, b) => (a.expectedCloseDate || '').localeCompare(b.expectedCloseDate || ''));

  // At-risk: overdue (past close date) + not received/lost
  const atRisk = revenue.filter(r =>
    !['received', 'lost'].includes(r.status) &&
    ((r.expectedCloseDate && r.expectedCloseDate < today) || r.probability < 30)
  );

  return res.status(200).json({
    totalProjected,
    weightedForecast,
    receivedRevenue,
    pendingRevenue,
    lostRevenue,
    monthlyForecast,
    revenueByLane,
    revenueByType,
    revenueByStatus,
    upcomingCloses,
    atRisk,
  });
}
