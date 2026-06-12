import { useState } from 'react';
import LeadPipeline from '../sections/LeadPipeline';
import BusinessWorkspace from '../workspaces/BusinessWorkspace';
import BusinessOverview from './BusinessOverview';

export default function LeadsWorkspace() {
  const [mode, setMode] = useState('pipeline');

  return (
    <BusinessWorkspace
      title="Leads"
      description="Lead intake, qualification, proposals, and approval-gated follow-up planning."
    >
      <div className="business-focus-tabs" role="tablist">
        <button type="button" className={mode === 'pipeline' ? 'active' : ''} onClick={() => setMode('pipeline')}>
          Lead Pipeline
        </button>
        <button type="button" className={mode === 'follow-ups' ? 'active' : ''} onClick={() => setMode('follow-ups')}>
          Follow-ups
        </button>
        <button type="button" className={mode === 'overview' ? 'active' : ''} onClick={() => setMode('overview')}>
          Overview
        </button>
      </div>
      <div className="business-existing-surface">
        {mode === 'pipeline' && <LeadPipeline />}
        {mode === 'follow-ups' && <BusinessOverview focus="follow-ups" />}
        {mode === 'overview' && <BusinessOverview />}
      </div>
    </BusinessWorkspace>
  );
}
