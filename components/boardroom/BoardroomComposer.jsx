import { useState } from 'react';
import { FiArchive, FiEdit3 } from 'react-icons/fi';
import VoiceButton from '../ui/VoiceButton';

const VAULT_COPY = {
  idle: 'Save prompt to Diamond Vault',
  saving: 'Saving to Diamond Vault…',
  saved: 'Saved to Diamond Vault',
  failed: 'Vault save failed',
};

export default function BoardroomComposer({
  selectedAgents,
  sessionType,
  onSubmit,
  vaultState,
}) {
  const [prompt, setPrompt] = useState('');
  const [saveToVault, setSaveToVault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const normalized = prompt.trim();
    if (!normalized || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ prompt: normalized, saveToVault });
      setPrompt('');
      setSaveToVault(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="boardroom-composer" onSubmit={submit}>
      <div className="boardroom-composer-context">
        <span>{sessionType}</span>
        <span>
          {selectedAgents.length
            ? selectedAgents.map(agent => agent.displayName).join(' · ')
            : 'No agents selected'}
        </span>
      </div>
      <div className="boardroom-composer-textarea-wrap">
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          placeholder="Frame the decision, constraints, and desired planning outcome…"
          rows={4}
          maxLength={8000}
        />
        <div className="boardroom-voice-corner">
          <VoiceButton
            onTranscript={t => setPrompt(prev => prev ? `${prev} ${t}` : t)}
            disabled={submitting}
          />
        </div>
      </div>
      <div className="boardroom-composer-actions">
        <label className="boardroom-vault-option">
          <input
            type="checkbox"
            checked={saveToVault}
            onChange={event => setSaveToVault(event.target.checked)}
            disabled={vaultState === 'saving'}
          />
          <FiArchive size={13} />
          {VAULT_COPY[vaultState] || VAULT_COPY.idle}
        </label>
        <button type="submit" disabled={!prompt.trim() || submitting}>
          <FiEdit3 size={13} />
          Add planning prompt
        </button>
      </div>
    </form>
  );
}
