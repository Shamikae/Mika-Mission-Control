import { motion } from 'framer-motion';

const STATE_META = {
  staged: {
    label: 'STAGED',
    color: 'var(--sapphire)',
    border: 'rgba(37, 99, 235, 0.33)',
    detail: 'Workspace shell is available. Configuration and live integration are intentionally deferred.',
  },
  unavailable: {
    label: 'UNAVAILABLE',
    color: 'var(--crimson)',
    border: 'rgba(239, 68, 68, 0.33)',
    detail: 'This workspace is not available in the current configuration.',
  },
  unknown: {
    label: 'UNKNOWN',
    color: 'var(--text-muted)',
    border: 'rgba(100, 116, 139, 0.33)',
    detail: 'No verified connection state is available.',
  },
};

export default function PlaceholderWorkspace({
  eyebrow = 'MIKA AGENTIC OS',
  title,
  description,
  state = 'staged',
  note,
}) {
  const meta = STATE_META[state] || STATE_META.unknown;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="workspace-placeholder"
    >
      <div className="workspace-placeholder-glow" />
      <div className="relative z-10 max-w-2xl">
        <div className="workspace-eyebrow">{eyebrow}</div>
        <div className="workspace-placeholder-heading flex items-center gap-3 mb-3">
          <h2 className="font-display text-3xl font-semibold" style={{ color: 'var(--ice-white)' }}>
            {title}
          </h2>
          <span className="workspace-state" style={{ color: meta.color, borderColor: meta.border }}>
            {meta.label}
          </span>
        </div>
        <p className="font-body text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
        <div className="workspace-placeholder-note">
          {note || meta.detail}
        </div>
      </div>
    </motion.section>
  );
}
