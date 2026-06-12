import { useState } from 'react';
import { MemoryVaultSection } from '../sections/IntelligenceSections';
import ObsidianGraph from '../sections/ObsidianGraph';
import SelfWorkspace from './SelfWorkspace';

const TABS = [
  { id: 'memory', label: 'Memory' },
  { id: 'obsidian', label: 'Obsidian Context' },
];

export default function MemoryWorkspace({ data }) {
  const [activeTab, setActiveTab] = useState('memory');

  return (
    <SelfWorkspace
      title="Memory"
      description="Review persistent Mika context and its configured Obsidian relationships without browsing the filesystem."
    >
      <div className="self-workspace-tabs" role="tablist" aria-label="Memory views">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'memory' ? <MemoryVaultSection data={data} /> : <ObsidianGraph defaultTab="VAULT" />}
    </SelfWorkspace>
  );
}
