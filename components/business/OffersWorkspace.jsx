import { useState } from 'react';
import OfferLibrary from '../sections/OfferLibrary';
import BusinessWorkspace from '../workspaces/BusinessWorkspace';
import BusinessOverview from './BusinessOverview';

export default function OffersWorkspace() {
  const [mode, setMode] = useState('library');

  return (
    <BusinessWorkspace
      title="Offers"
      description="Offer design, validation, sales assets, and governed campaign planning."
    >
      <div className="business-focus-tabs" role="tablist">
        <button type="button" className={mode === 'library' ? 'active' : ''} onClick={() => setMode('library')}>
          Offer Library
        </button>
        <button type="button" className={mode === 'campaigns' ? 'active' : ''} onClick={() => setMode('campaigns')}>
          Campaigns
        </button>
      </div>
      <div className="business-existing-surface">
        {mode === 'library' ? <OfferLibrary /> : <BusinessOverview focus="campaigns" />}
      </div>
    </BusinessWorkspace>
  );
}
