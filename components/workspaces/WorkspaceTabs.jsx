import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export default function WorkspaceTabs({ tabs, initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || tabs[0]?.id);
  const active = tabs.find(tab => tab.id === activeTab) || tabs[0];

  return (
    <div className="approved-workspace">
      <div className="approved-workspace-tabs" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={active?.id === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={active?.id === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active?.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {active?.content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
