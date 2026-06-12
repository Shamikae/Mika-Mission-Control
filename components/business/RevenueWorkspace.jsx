import { useState } from 'react';
import ProposalCenter from '../sections/ProposalCenter';
import RevenueOpportunities from '../sections/RevenueOpportunities';
import RevenueTracking from '../sections/RevenueTracking';
import BusinessWorkspace from '../workspaces/BusinessWorkspace';
import BusinessOverview from './BusinessOverview';

const MODES = [
  { id: 'tracking', label: 'Revenue' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'follow-ups', label: 'Follow-ups' },
  { id: 'overview', label: 'Overview' },
];

export default function RevenueWorkspace() {
  const [mode, setMode] = useState('tracking');

  return (
    <BusinessWorkspace
      title="Revenue"
      description="Revenue tracking, forecasts, opportunities, proposals, and governed follow-up planning."
    >
      <div className="business-focus-tabs" role="tablist">
        {MODES.map(entry => (
          <button type="button" key={entry.id} className={mode === entry.id ? 'active' : ''} onClick={() => setMode(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="business-existing-surface">
        {mode === 'tracking' && <RevenueTracking />}
        {mode === 'opportunities' && <RevenueOpportunities />}
        {mode === 'proposals' && <ProposalCenter />}
        {mode === 'follow-ups' && <BusinessOverview focus="follow-ups" />}
        {mode === 'overview' && <BusinessOverview />}
      </div>
    </BusinessWorkspace>
  );
}
