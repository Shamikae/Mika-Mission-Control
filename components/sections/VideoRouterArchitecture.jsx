// components/sections/VideoRouterArchitecture.jsx
// Architecture-only display of the Video Router system.
// No providers are connected. This is a planning and roadmap view.

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const SAPPHIRE = '#3b82f6';
const EMERALD  = '#10b981';
const GOLD     = '#c9a84c';
const AMBER    = '#f59e0b';

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

export default function VideoRouterArchitecture() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/data/video-router-architecture.json')
      .catch(() => null);
    // Load from static import since it's a local data file
    import('../../data/video-router-architecture.json')
      .then(m => setData(m.default))
      .catch(() => {});
  }, []);

  const commercial = data?.providers?.commercial || [
    { id: 'higgsfield', name: 'Higgsfield',   strength: 'Luxury & cinematic founder content' },
    { id: 'heygen',     name: 'HeyGen',       strength: 'AI avatar & talking head videos'    },
    { id: 'veo',        name: 'Veo (Google)', strength: 'Narrative & storytelling content'   },
    { id: 'kling',      name: 'Kling',        strength: 'Fast social & short-form content'   },
    { id: 'openart',    name: 'OpenArt',      strength: 'Creative design & artistic assets'  },
  ];

  const openSource = data?.providers?.openSource || [
    { id: 'wan',          name: 'Wan',          strength: 'Open source video generation'          },
    { id: 'hunyuanvideo', name: 'HunyuanVideo', strength: 'Experimental high-quality generation'  },
    { id: 'open-sora',    name: 'Open-Sora',    strength: 'Open source Sora-style generation'     },
    { id: 'comfyui',      name: 'ComfyUI',      strength: 'Custom node-based generation workflows' },
  ];

  const routingRules = data?.routingRules || [
    { contentType: 'Luxury Founder Content', provider: 'higgsfield' },
    { contentType: 'AI Twin Content',         provider: 'heygen'     },
    { contentType: 'Storytelling Content',    provider: 'veo'        },
    { contentType: 'Fast Social Content',     provider: 'kling'      },
    { contentType: 'Creative Design Assets',  provider: 'openart'    },
    { contentType: 'Open Source Workflows',   provider: 'wan'        },
    { contentType: 'Experimental Content',    provider: 'hunyuanvideo'},
    { contentType: 'Custom Workflows',        provider: 'comfyui'    },
  ];

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-5">

      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start justify-between">
        <div>
          <h3 className="font-ui text-base font-bold mb-0.5" style={{ color: 'var(--text-primary)' }}>
            Video Router Architecture
          </h3>
          <p className="font-mono text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
            ARCHITECTURE ONLY · NO PROVIDERS CONNECTED · FUTURE ROADMAP
          </p>
        </div>
        <span
          className="font-mono text-[8px] px-2.5 py-1 rounded-sm"
          style={{ color: AMBER, background: `${AMBER}12`, border: `1px solid ${AMBER}28` }}
        >
          PLANNED
        </span>
      </motion.div>

      {/* Providers grid */}
      <div className="grid grid-cols-2 gap-4">

        {/* Commercial */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color: SAPPHIRE }}>
            COMMERCIAL LAYER
          </div>
          <div className="space-y-2">
            {commercial.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-start gap-2.5 p-2.5 rounded-sm"
                style={{ background: `${SAPPHIRE}06`, border: `1px solid ${SAPPHIRE}14` }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: SAPPHIRE }} />
                <div>
                  <div className="font-ui text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                    {p.name}
                  </div>
                  <p className="font-body text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                    {p.strength}
                  </p>
                </div>
                <span
                  className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm ml-auto flex-shrink-0"
                  style={{ color: AMBER, background: `${AMBER}12`, border: `1px solid ${AMBER}22` }}
                >
                  PLANNED
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Open Source */}
        <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
          <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-3" style={{ color: EMERALD }}>
            OPEN SOURCE LAYER
          </div>
          <div className="space-y-2">
            {openSource.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-start gap-2.5 p-2.5 rounded-sm"
                style={{ background: `${EMERALD}06`, border: `1px solid ${EMERALD}14` }}
              >
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: EMERALD }} />
                <div>
                  <div className="font-ui text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                    {p.name}
                  </div>
                  <p className="font-body text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                    {p.strength}
                  </p>
                </div>
                <span
                  className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm ml-auto flex-shrink-0"
                  style={{ color: EMERALD, background: `${EMERALD}12`, border: `1px solid ${EMERALD}22` }}
                >
                  OPEN
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Routing rules */}
      <motion.div variants={fadeUp} className="panel-gold rounded-sm p-4">
        <div className="font-mono text-[8px] tracking-[0.2em] uppercase mb-4" style={{ color: GOLD }}>
          ROUTING LOGIC · CONTENT TYPE → PROVIDER
        </div>
        <div className="grid grid-cols-2 gap-2">
          {routingRules.map((rule, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-2 p-2 rounded-sm"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <span className="font-body text-[10px] flex-1" style={{ color: 'var(--text-secondary)' }}>
                {rule.contentType}
              </span>
              <span className="font-mono text-[7px]" style={{ color: 'var(--text-muted)' }}>→</span>
              <span className="font-mono text-[8px] font-semibold" style={{ color: GOLD }}>
                {rule.provider}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Architecture note */}
      <motion.div variants={fadeUp} className="flex items-center gap-3 px-4 py-3 rounded-sm"
        style={{ background: `${AMBER}06`, border: `1px solid ${AMBER}18` }}>
        <span style={{ fontSize: 16 }}>⚠</span>
        <div>
          <p className="font-ui text-xs font-semibold mb-0.5" style={{ color: AMBER }}>
            Architecture Only
          </p>
          <p className="font-body text-[11px]" style={{ color: 'var(--text-muted)' }}>
            No video generation APIs are connected. This view defines the routing architecture for Phase F.
            Providers will be integrated one at a time, starting with the highest-ROI use case.
          </p>
        </div>
      </motion.div>

    </motion.div>
  );
}
