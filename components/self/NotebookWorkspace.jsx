import { useMemo, useState } from 'react';
import { MemoryVaultSection, PromptLibrarySection } from '../sections/IntelligenceSections';
import ObsidianGraph from '../sections/ObsidianGraph';
import SelfWorkspace from './SelfWorkspace';

const TABS = [
  { id: 'prompts', label: 'Prompt Library' },
  { id: 'notes', label: 'Notes & Research' },
  { id: 'obsidian', label: 'Obsidian' },
];

function NotebookIndex({ memory = [] }) {
  const records = useMemo(() => (
    memory.filter(item => {
      const searchable = `${item.category || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
      return searchable.includes('note') || searchable.includes('research');
    })
  ), [memory]);

  if (!records.length) {
    return (
      <div className="self-empty-state">
        <span>NOTES & RESEARCH</span>
        <h2>No notebook-specific records found</h2>
        <p>Existing memory remains available below. Records are not duplicated or moved into a new data store.</p>
        <MemoryVaultSection data={{ memory }} />
      </div>
    );
  }

  return (
    <div className="notebook-records">
      {records.map(record => (
        <article key={record.id} className="notebook-record">
          <div>
            <span>{record.category || 'Note'}</span>
            <h2>{record.title}</h2>
          </div>
          <p>{record.content}</p>
          {(record.tags || []).length ? (
            <div className="notebook-tags">
              {record.tags.map(tag => <span key={tag}>#{tag}</span>)}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export default function NotebookWorkspace({ data }) {
  const [activeTab, setActiveTab] = useState('prompts');

  return (
    <SelfWorkspace
      title="Notebook"
      description="One place for Mika prompts, existing notes and research, and configured Obsidian context."
    >
      <div className="self-workspace-tabs" role="tablist" aria-label="Notebook views">
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

      {activeTab === 'prompts' && <PromptLibrarySection data={data} />}
      {activeTab === 'notes' && <NotebookIndex memory={data.memory || []} />}
      {activeTab === 'obsidian' && <ObsidianGraph defaultTab="VAULT" />}
    </SelfWorkspace>
  );
}
