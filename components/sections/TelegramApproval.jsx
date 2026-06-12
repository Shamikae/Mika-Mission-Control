// components/sections/TelegramApproval.jsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader } from '../ui';
import {
  approveTask,
  fetchTelegramStatus,
  rejectTask,
  verifyTelegramDelivery,
} from '../../lib/api';
import { useStore } from '../../lib/store';
import { formatDistanceToNow, parseISO } from 'date-fns';

const CHANNEL_ICONS = {
  Instagram: '📸',
  TikTok:    '🎵',
  Email:     '✉️',
  WhatsApp:  '💬',
  Telegram:  '✈️',
  Internal:  '🔒',
};

const PRIORITY_COLOR = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#8892a4',
};

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.1 } } };
const fadeUp  = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

const VERIFICATION_META = {
  verified: { label: 'VERIFIED', color: '#0dd3c5' },
  failed: { label: 'FAILED', color: '#ef4444' },
  not_configured: { label: 'NOT CONFIGURED', color: '#f59e0b' },
  unknown: { label: 'UNKNOWN', color: '#8892a4' },
};

function formatVerificationTime(value) {
  if (!value) return 'No verification has been run.';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Verification time unavailable.';
  return `Last verification: ${timestamp.toLocaleString()}`;
}

export default function TelegramApproval({ data }) {
  const { approvals: initialApprovals } = data;
  const [approvals, setApprovals]   = useState(initialApprovals || []);
  const [expandedId, setExpandedId] = useState(null);
  const [processing, setProcessing] = useState({});
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState('');
  const { addNotification }         = useStore();

  useEffect(() => {
    fetchTelegramStatus()
      .then(setTelegramStatus)
      .catch(() => setTelegramStatus({
        enabled: false,
        configured: false,
        verification: { status: 'unknown', checkedAt: null, error: null },
      }));
  }, []);

  const runVerification = async () => {
    setVerifying(true);
    setVerificationNotice('');
    try {
      const verification = await verifyTelegramDelivery();
      setTelegramStatus(current => ({
        ...(current || {}),
        verification,
      }));
      setVerificationNotice(verification.cooldown
        ? 'Verification was run recently. No additional test message was sent.'
        : verification.status === 'verified'
          ? 'Telegram confirmed delivery of the test message.'
          : verification.status === 'not_configured'
            ? 'Telegram approval delivery is not configured.'
            : 'Telegram could not confirm delivery.');
    } catch {
      setVerificationNotice('Telegram verification could not be completed.');
    } finally {
      setVerifying(false);
    }
  };

  const handle = async (id, action) => {
    setProcessing(p => ({ ...p, [id]: action }));
    await new Promise(r => setTimeout(r, 600));
    if (action === 'approve') {
      await approveTask(id);
      addNotification({ type: 'success', message: `Task ${id} approved` });
    } else {
      await rejectTask(id);
      addNotification({ type: 'error', message: `Task ${id} rejected` });
    }
    setApprovals(prev => prev.filter(a => a.id !== id));
    setProcessing(p => { const n = {...p}; delete n[id]; return n; });
  };

  const verification = telegramStatus?.verification || {
    status: 'unknown',
    checkedAt: null,
    error: null,
  };
  const verificationMeta = VERIFICATION_META[verification.status] || VERIFICATION_META.unknown;

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader
        icon="✉"
        title="Telegram Approval Center"
        subtitle="Human-in-the-loop decisions — approve or reject pending agent actions"
        action={
          <div className="flex items-center gap-2">
            <div className="status-dot" style={{ background: verificationMeta.color }} />
            <span className="font-mono text-[10px]" style={{ color: verificationMeta.color }}>
              TELEGRAM {verificationMeta.label}
            </span>
          </div>
        }
      />

      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[9px] tracking-widest" style={{ color: verificationMeta.color }}>
              DELIVERY VERIFICATION · {verificationMeta.label}
            </div>
            <p className="font-mono text-[9px] mt-2 text-[#8892a4]">
              {formatVerificationTime(verification.checkedAt)}
            </p>
            {verification.error && (
              <p className="font-mono text-[9px] mt-2 text-[#ef4444]">
                {verification.error}
              </p>
            )}
            {verificationNotice && (
              <p className="font-mono text-[9px] mt-2 text-[#8892a4]">
                {verificationNotice}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={runVerification}
            disabled={verifying}
            className="btn-ghost text-[10px] disabled:opacity-50"
            title="Sends one clearly labeled, non-destructive Telegram test message"
          >
            {verifying ? 'VERIFYING…' : 'VERIFY DELIVERY'}
          </button>
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-3">
        {[
          { label: 'Pending',   value: approvals.length,            color: approvals.length > 0 ? '#ef4444' : '#4b5563' },
          { label: 'High Priority', value: approvals.filter(a => a.priority === 'high').length,   color: '#ef4444' },
          { label: 'Approved Today', value: 8,                      color: '#0dd3c5' },
          { label: 'Rejected Today', value: 1,                      color: '#8892a4' },
        ].map(({ label, value, color }) => (
          <div key={label} className="panel-gold rounded-sm p-3 text-center">
            <div className="font-mono text-2xl font-semibold" style={{ color }}>{value}</div>
            <div className="font-mono text-[9px] text-[#4b5563] mt-1 tracking-wider">{label.toUpperCase()}</div>
          </div>
        ))}
      </motion.div>

      {/* Approval cards */}
      <AnimatePresence mode="popLayout">
        {approvals.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="panel-gold rounded-sm p-12 text-center"
          >
            <div className="text-4xl mb-4 opacity-30">◈</div>
            <p className="font-ui text-sm text-[#4b5563]">All clear — no pending approvals</p>
            <p className="font-mono text-[10px] text-[#4b5563] mt-2">Your agents are operating autonomously</p>
          </motion.div>
        ) : (
          approvals.map((item, i) => {
            const isExpanded = expandedId === item.id;
            const isProcessing = !!processing[item.id];

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, x: processing[item.id] === 'approve' ? 60 : -60 }}
                transition={{ duration: 0.35 }}
                className="panel-gold rounded-sm overflow-hidden card-hover"
              >
                {/* Priority stripe */}
                <div className="h-0.5" style={{ background: PRIORITY_COLOR[item.priority] }} />

                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="font-mono text-xs font-semibold text-[#f0ede6]">{item.id}</span>
                        <span className="tag" style={{ color: PRIORITY_COLOR[item.priority], borderColor: `${PRIORITY_COLOR[item.priority]}30`, background: `${PRIORITY_COLOR[item.priority]}10` }}>
                          {item.priority.toUpperCase()}
                        </span>
                        <span className="tag" style={{ color: '#8892a4', borderColor: 'rgba(136,146,164,0.2)', background: 'rgba(136,146,164,0.05)' }}>
                          {item.action}
                        </span>
                        <span className="font-mono text-[9px] text-[#4b5563]">
                          {CHANNEL_ICONS[item.channel]} {item.channel}
                        </span>
                      </div>

                      <p className="font-ui text-sm text-[#f0ede6] mb-1">{item.summary}</p>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[10px] text-[#c9a84c]">Agent: {item.agent}</span>
                        <span className="font-mono text-[9px] text-[#4b5563]">
                          {formatDistanceToNow(parseISO(item.createdAt))} ago
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="btn-ghost text-[10px] px-2 py-1.5"
                      >
                        {isExpanded ? 'HIDE' : 'PREVIEW'}
                      </button>
                      <button
                        disabled={isProcessing}
                        onClick={() => handle(item.id, 'reject')}
                        className="btn-danger text-[10px] px-3 py-1.5 disabled:opacity-50"
                      >
                        {isProcessing && processing[item.id] === 'reject' ? '...' : '✕ REJECT'}
                      </button>
                      <button
                        disabled={isProcessing}
                        onClick={() => handle(item.id, 'approve')}
                        className="btn-gold text-[10px] px-3 py-1.5 disabled:opacity-50"
                      >
                        {isProcessing && processing[item.id] === 'approve' ? '...' : '✓ APPROVE'}
                      </button>
                    </div>
                  </div>

                  {/* Expandable content preview */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 p-3 rounded-sm font-body text-xs text-[#8892a4] leading-relaxed italic"
                          style={{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.08)' }}>
                          "{item.content}"
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })
        )}
      </AnimatePresence>
    </motion.div>
  );
}
