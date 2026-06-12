import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiBriefcase, FiRefreshCw } from 'react-icons/fi';

const ENDPOINTS = {
  leads: '/api/leads/list',
  offers: '/api/offers/list',
  clients: '/api/clients/list',
  proposals: '/api/proposals/list',
  revenue: '/api/revenue/list',
};

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export default function BusinessOverview({ focus = 'overview' }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const entries = await Promise.all(Object.entries(ENDPOINTS).map(async ([key, url]) => {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${key} data unavailable`);
        return [key, await response.json()];
      }));
      setData(Object.fromEntries(entries));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const followUps = useMemo(() => {
    const leads = data.leads?.leads || [];
    const revenue = data.revenue?.revenue || [];
    return [
      ...leads.filter(lead => lead.nextAction || ['contacted', 'qualified', 'proposal-sent', 'negotiating'].includes(lead.status))
        .map(lead => ({
          id: lead.leadId,
          title: lead.fullName || lead.company || 'Lead',
          detail: lead.nextAction || `Lead is currently ${lead.status}`,
          source: 'Lead',
        })),
      ...revenue.filter(item => item.nextAction)
        .map(item => ({
          id: item.revenueId,
          title: item.sourceLabel || item.notes || 'Revenue item',
          detail: item.nextAction,
          source: 'Revenue',
        })),
    ];
  }, [data]);

  const summaryCards = [
    { label: 'Leads', value: data.leads?.summary?.total || 0, detail: `${data.leads?.summary?.hotLeads || 0} high priority` },
    { label: 'Offers', value: data.offers?.summary?.total || 0, detail: `${data.offers?.summary?.selling || 0} selling` },
    { label: 'Clients', value: data.clients?.summary?.total || 0, detail: `${data.clients?.summary?.activeCount || 0} active` },
    { label: 'Proposals', value: data.proposals?.summary?.total || 0, detail: money(data.proposals?.summary?.totalValue) },
    { label: 'Pipeline', value: money(data.revenue?.summary?.pipelineValue), detail: `${data.revenue?.summary?.total || 0} revenue records` },
  ];

  return (
    <section className="business-overview">
      <div className="business-overview-heading">
        <div><span>LIVE BUSINESS DATA</span><h2>{focus === 'overview' ? 'Business Overview' : focus.replaceAll('-', ' ')}</h2></div>
        <button type="button" onClick={load} disabled={loading}><FiRefreshCw size={12} /> Refresh</button>
      </div>

      {loading ? (
        <div className="business-empty-state">Loading business records…</div>
      ) : error ? (
        <div className="business-empty-state error">{error}</div>
      ) : focus === 'follow-ups' ? (
        followUps.length ? (
          <div className="business-followup-list">
            {followUps.map(item => (
              <article key={`${item.source}-${item.id}`}>
                <FiBriefcase size={14} />
                <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                <span>{item.source}</span>
              </article>
            ))}
          </div>
        ) : <div className="business-empty-state">No lead or revenue follow-ups are currently recorded.</div>
      ) : focus === 'campaigns' ? (
        <div className="business-campaign-state">
          <strong>Campaign planning is available through Offer Library</strong>
          <p>
            Select an offer and use “Queue Content Campaign.” It creates an approval-required Mika task;
            it does not publish or contact anyone.
          </p>
          {(data.offers?.offers || []).length ? (
            <div>
              {(data.offers.offers || []).filter(offer => offer.status !== 'archived').map(offer => (
                <span key={offer.offerId}>{offer.title} · {offer.status}</span>
              ))}
            </div>
          ) : <small>No offers are available for campaign planning.</small>}
        </div>
      ) : (
        <div className="business-summary-grid">
          {summaryCards.map(card => (
            <article key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
