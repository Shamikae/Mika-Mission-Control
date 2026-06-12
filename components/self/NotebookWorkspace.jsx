import { useMemo, useState } from 'react';
import { MemoryVaultSection, PromptLibrarySection } from '../sections/IntelligenceSections';
import ObsidianGraph from '../sections/ObsidianGraph';
import SelfWorkspace from './SelfWorkspace';

const TABS = [
  { id: 'prompts', label: 'Prompt Library' },
  { id: 'notes', label: 'Notes & Research' },
  { id: 'obsidian', label: 'Obsidian' },
];

function NotebookIndex({ memory = [], source }) {
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
        <p>{source?.message || 'No safe notebook source is connected.'}</p>
        <MemoryVaultSection data={{ memory, selfSources: { memory: source } }} />
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
          <p>{record.content || 'Indexed Obsidian note. Contents are not exposed by the safe vault index.'}</p>
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
      {activeTab === 'notes' && (
        <NotebookIndex memory={data.memory || []} source={data.selfSources?.memory} />
      )}
      {activeTab === 'obsidian' && <ObsidianGraph defaultTab="VAULT" />}
    </SelfWorkspace>
  );
}
