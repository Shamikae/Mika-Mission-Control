// components/sections/MikaTwinStudio.jsx
// AI Twin personal brand studio. Architecture and placeholder view.
// HeyGen and voice clone integration planned for a future phase.

import { motion } from 'framer-motion';
import { useStore } from '../../lib/store';
import { AGENT_AVATARS } from '../../lib/agent-avatars';

const SAPPHIRE = '#3b82f6';
const TWIN_COLOR = '#60a5fa';
const EMERALD = '#10b981';
const GOLD = '#c9a84c';
const AMBER = '#f59e0b';

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

const MOCK_VIDEOS = [
  { id: 'v1', title: 'AI Does My Job — Episode 3', platform: 'TikTok', status: 'published', views: '14.2k', date: '2026-05-28' },
  { id: 'v2', title: 'AI Does My Job — Episode 2', platform: 'TikTok', status: 'published', views: '18.4k', date: '2026-05-21' },
  { id: 'v3', title: 'AI Does My Job — Episode 1', platform: 'TikTok', status: 'published', views: '9.1k',  date: '2026-05-14' },
  { id: 'v4', title: 'Episode 4 — in production',  platform: 'TikTok', status: 'in_production', views: null, date: null },
];

const FUTURE_INTEGRATIONS = [
  { id: 'heygen',     name: 'HeyGen',       purpose: 'AI avatar + talking head video generation', status: 'planned' },
  { id: 'elevenlabs', name: 'ElevenLabs',   purpose: 'Voice cloning for voiceover production',    status: 'planned' },
  { id: 'captions',   name: 'Captions.ai',  purpose: 'Auto-captioning and B-roll generation',     status: 'planned' },
];

export default function MikaTwinStudio() {
  const { setActiveAgentId, setActiveSection } = useStore();
  const twinAvatar = AGENT_AVATARS['twin'] || {};

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* Twin identity header */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-5 relative overflow-hidden"
        style={{ borderColor: `${TWIN_COLOR}25` }}>
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl pointer-events-none"
          style={{ background: `${TWIN_COLOR}08` }} />
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0"
            style={{ background: twinAvatar.gradient || `linear-gradient(135deg, ${TWIN_COLOR}40, ${TWIN_COLOR}20)` }}>
            🤖
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-ui text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Mika Twin Studio
              </h3>
              <span className="font-mono text-[8px] px-2 py-0.5 rounded-sm"
                style={{ color: TWIN_COLOR, background: `${TWIN_COLOR}14`, border: `1px solid ${TWIN_COLOR}28` }}>
                AI TWIN ACTIVE
              </span>
            </div>
            <p className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
              Personal brand content factory — scripts, hooks, and calendars for Mika's creator channels.
            </p>
            <div className="flex items-center gap-4 mt-2">
              <div>
                <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>AVATAR STATUS</div>
                <div className="font-mono text-[9px] font-bold" style={{ color: AMBER }}>
                  ◎ HEYGEN NOT CONNECTED
                </div>
              </div>
              <div>
                <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>VOICE STATUS</div>
                <div className="font-mono text-[9px] font-bold" style={{ color: AMBER }}>
                  ◎ VOICE CLONE NOT CONNECTED
                </div>
              </div>
              <div>
                <div className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>CONTENT STATUS</div>
                <div className="font-mono text-[9px] font-bold" style={{ color: EMERALD }}>
                  ● SCRIPTS ACTIVE
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => setActiveAgentId('twin')}
            className="font-ui text-[9px] font-bold px-3 py-1.5 rounded-sm tracking-wider transition-all flex-shrink-0"
            style={{ background: `${TWIN_COLOR}12`, border: `1px solid ${TWIN_COLOR}28`, color: TWIN_COLOR }}
          >
            OPEN WORKSPACE →
          </button>
        </div>
      </motion.div>

      {/* Content performance + video library */}
      <div className="grid grid-cols-2 gap-4">

        {/* Generated videos */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color: TWIN_COLOR }}>
            VIDEO LIBRARY
          </div>
          <div className="space-y-2">
            {MOCK_VIDEOS.map((v, i) => (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-center gap-2.5 p-2 rounded-sm"
                style={{
                  background: v.status === 'published' ? 'rgba(255,255,255,0.02)' : `${AMBER}08`,
                  border: `1px solid ${v.status === 'published' ? 'rgba(255,255,255,0.05)' : `${AMBER}18`}`,
                }}
              >
                <div className="w-8 h-8 rounded-sm flex items-center justify-center flex-shrink-0 text-base"
                  style={{ background: `${TWIN_COLOR}12`, border: `1px solid ${TWIN_COLOR}20` }}>
                  {v.status === 'published' ? '▶' : '⏳'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-[11px] truncate" style={{ color: 'var(--text-primary)' }}>{v.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-[7px]" style={{ color: TWIN_COLOR }}>{v.platform}</span>
                    {v.date && <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>{v.date}</span>}
                  </div>
                </div>
                {v.views && (
                  <span className="font-mono text-[8px] font-bold flex-shrink-0" style={{ color: EMERALD }}>
                    {v.views}
                  </span>
                )}
                {v.status === 'in_production' && (
                  <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
                    style={{ color: AMBER, background: `${AMBER}12`, border: `1px solid ${AMBER}22` }}>
                    IN PROD
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Planned integrations */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color: AMBER }}>
            PLANNED INTEGRATIONS
          </div>
          <div className="space-y-2">
            {FUTURE_INTEGRATIONS.map((int, i) => (
              <motion.div
                key={int.id}
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="flex items-start gap-2.5 p-2.5 rounded-sm"
                style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}14` }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: AMBER }} />
                <div className="flex-1">
                  <div className="font-ui text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                    {int.name}
                  </div>
                  <p className="font-body text-[10px]" style={{ color: 'var(--text-muted)' }}>{int.purpose}</p>
                </div>
                <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm flex-shrink-0"
                  style={{ color: AMBER, background: `${AMBER}12`, border: `1px solid ${AMBER}22` }}>
                  PLANNED
                </span>
              </motion.div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            <p className="font-body text-[10px]" style={{ color: 'var(--text-muted)' }}>
              When HeyGen is connected, Twin will generate talking-head videos autonomously from script input.
              Voice clone will be trained on sample recordings.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Quick actions */}
      <motion.div variants={fadeUp} className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[8px] tracking-widest" style={{ color: 'var(--text-muted)' }}>TWIN ACTIONS</span>
        {[
          { label: 'Generate Scripts', section: 'task-dispatch' },
          { label: 'Batch Hooks × 10', section: 'task-dispatch' },
          { label: 'Open TikTok Studio', studio: 'tiktok' },
        ].map((a, i) => (
          <button
            key={i}
            onClick={() => setActiveSection(a.section || 'task-dispatch')}
            className="font-ui text-[10px] font-semibold px-3 py-1.5 rounded-sm tracking-wider transition-all"
            style={{
              background: `${TWIN_COLOR}10`,
              border: `1px solid ${TWIN_COLOR}28`,
              color: TWIN_COLOR,
            }}
          >
            {a.label}
          </button>
        ))}
      </motion.div>

    </motion.div>
  );
}
