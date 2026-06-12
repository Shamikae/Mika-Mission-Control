// components/sections/ContentPipeline.jsx
// Visual representation of the 10-stage content production pipeline.
// Architecture-only — stages show counts from active studio data when provided.

import { motion } from 'framer-motion';
import { PIPELINE_STAGES } from '../../lib/ContentSkillsRegistry';

export default function ContentPipeline({ stageCounts = {}, compact = false }) {
  return (
    <div className="w-full overflow-x-auto">
      <div className={`flex items-stretch gap-0 min-w-max ${compact ? '' : 'pb-1'}`}>
        {PIPELINE_STAGES.map((stage, i) => {
          const count = stageCounts[stage.id] || 0;
          const isLast = i === PIPELINE_STAGES.length - 1;

          return (
            <div key={stage.id} className="flex items-center">
              {/* Stage block */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.28 }}
                className={`flex flex-col items-center justify-center rounded-sm relative group ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
                style={{
                  background: count > 0 ? `${stage.color}12` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${count > 0 ? `${stage.color}30` : 'rgba(255,255,255,0.05)'}`,
                  minWidth: compact ? 72 : 88,
                }}
              >
                {/* Count badge */}
                {count > 0 && (
                  <div
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center font-mono text-[7px] font-bold"
                    style={{ background: stage.color, color: '#07090f' }}
                  >
                    {count}
                  </div>
                )}

                <span
                  className={`${compact ? 'text-xs' : 'text-sm'} mb-1`}
                  style={{ color: count > 0 ? stage.color : 'var(--text-muted)', opacity: count > 0 ? 1 : 0.4 }}
                >
                  {stage.icon}
                </span>
                <span
                  className="font-mono tracking-wider leading-none text-center"
                  style={{
                    fontSize: compact ? 7 : 8,
                    color: count > 0 ? stage.color : 'var(--text-muted)',
                    opacity: count > 0 ? 1 : 0.5,
                  }}
                >
                  {stage.label}
                </span>

                {/* Tooltip */}
                {!compact && (
                  <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-sm text-center whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                    style={{
                      background: 'var(--bg-overlay)',
                      border: `1px solid ${stage.color}30`,
                      fontSize: 9,
                      color: 'var(--text-secondary)',
                      maxWidth: 160,
                      whiteSpace: 'normal',
                    }}
                  >
                    <div className="font-mono font-bold mb-0.5" style={{ color: stage.color }}>
                      {stage.agent}
                    </div>
                    {stage.description}
                  </div>
                )}
              </motion.div>

              {/* Arrow connector */}
              {!isLast && (
                <div className="flex items-center px-0.5 flex-shrink-0">
                  <span
                    className="font-mono text-[8px]"
                    style={{ color: 'rgba(255,255,255,0.12)' }}
                  >
                    →
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
