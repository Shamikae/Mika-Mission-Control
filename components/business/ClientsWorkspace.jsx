import { useState } from 'react';
import ClientDelivery from '../sections/ClientDelivery';
import ProposalCenter from '../sections/ProposalCenter';
import BusinessWorkspace from '../workspaces/BusinessWorkspace';

export default function ClientsWorkspace() {
  const [mode, setMode] = useState('delivery');

  return (
    <BusinessWorkspace
      title="Clients"
      description="Client onboarding, delivery health, milestones, and proposal handoff."
    >
      <div className="business-focus-tabs" role="tablist">
        <button type="button" className={mode === 'delivery' ? 'active' : ''} onClick={() => setMode('delivery')}>
          Client Delivery
        </button>
        <button type="button" className={mode === 'proposals' ? 'active' : ''} onClick={() => setMode('proposals')}>
          Proposals
        </button>
      </div>
      <div className="business-existing-surface">
        {mode === 'delivery' ? <ClientDelivery /> : <ProposalCenter />}
      </div>
    </BusinessWorkspace>
  );
}
