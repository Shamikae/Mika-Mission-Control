// components/sections/IntelligenceSections.jsx
import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionHeader, StatusBadge, ProgressRing } from '../ui';
import { format, parseISO } from 'date-fns';
import { vaultSaveJournal, vaultSyncGoals } from '../../lib/vault';

// ── Shared mic button ───────────────────────────────────────────────

function MicButton({ value, onValue }) {
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);

  const toggle = useCallback(() => {
    const SR = typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;

    if (listening) { recogRef.current?.stop(); return; }

    const base = value || '';
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = 'en-US';

    r.onstart = () => setListening(true);
    r.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      onValue((base ? base + ' ' : '') + (final || interim));
    };
    r.onend = () => { setListening(false); recogRef.current = null; };
    r.onerror = () => { setListening(false); recogRef.current = null; };

    recogRef.current = r;
    r.start();
  }, [listening, value, onValue]);

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileTap={{ scale: 0.93 }}
      title={listening ? 'Stop recording' : 'Voice input'}
      className="relative w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
      style={{
        background: listening ? 'rgba(239,68,68,0.12)' : 'var(--bg-overlay)',
        border: `1px solid ${listening ? 'rgba(239,68,68,0.4)' : 'var(--border-default)'}`,
        color: listening ? '#ef4444' : 'var(--text-muted)',
      }}
    >
      {listening && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ scale: [1, 1.6, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          style={{ background: 'rgba(239,68,68,0.2)' }}
        />
      )}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </motion.button>
  );
}

const stagger = { initial: {}, animate: { transition: { staggerChildren: 0.08 } } };
const fadeUp  = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

// ── Prompt Library ─────────────────────────────────────────────────
const PROJECT_COLORS = {
  'digital-diamond': '#c9a84c',
  'managed-by-mika': '#0dd3c5',
  'medai':           '#818cf8',
  'cannaops':        '#4ade80',
  'hotel-hooker':    '#f472b6',
  'ai-twin':         '#60a5fa',
  'lead-recovery':   '#fb923c',
};

export function PromptLibrarySection({ data }) {
  const { prompts } = data;
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [copied, setCopied]   = useState(false);

  const filtered = prompts?.filter(p =>
    !search ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.tags.some(t => t.includes(search.toLowerCase()))
  );

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader icon="⌘" title="Prompt Library" subtitle="Curated agent prompts — your AI arsenal" />

      <motion.div variants={fadeUp} className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search prompts, tags, categories..."
          className="flex-1 bg-transparent border border-[rgba(201,168,76,0.15)] rounded-sm px-3 py-2 font-mono text-xs text-[#f0ede6] placeholder-[#4b5563] focus:outline-none focus:border-[rgba(201,168,76,0.4)] transition-colors"
        />
        <button className="btn-gold">+ NEW PROMPT</button>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        {filtered?.map((prompt, i) => {
          const color = PROJECT_COLORS[prompt.project] || '#c9a84c';
          const isSelected = selected?.id === prompt.id;
          return (
            <motion.div
              key={prompt.id}
              variants={fadeUp}
              onClick={() => setSelected(isSelected ? null : prompt)}
              className="panel-gold rounded-sm p-4 card-hover cursor-pointer relative overflow-hidden"
              style={{ borderLeftColor: color, borderLeftWidth: 2 }}
            >
              <div className="absolute top-0 right-0 w-12 h-12 blur-2xl opacity-10 rounded-full"
                style={{ background: color }} />

              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="font-ui text-sm font-semibold text-[#f0ede6] mb-1">{prompt.title}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="tag" style={{ color, borderColor: `${color}30`, background: `${color}10` }}>
                      {prompt.category}
                    </span>
                    {prompt.tags.slice(0, 2).map(t => (
                      <span key={t} className="tag" style={{ color: '#4b5563', borderColor: 'rgba(75,85,99,0.3)' }}>#{t}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <div className="font-mono text-xs font-semibold text-[#c9a84c]">{prompt.rating}★</div>
                  <div className="font-mono text-[9px] text-[#4b5563]">{prompt.uses}× used</div>
                </div>
              </div>

              <p className="font-body text-[11px] text-[#4b5563] leading-relaxed line-clamp-2">{prompt.preview}</p>

              <AnimatePresence>
                {isSelected && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 overflow-hidden"
                  >
                    <div className="p-2 rounded-sm mb-2 font-mono text-[10px] text-[#8892a4] leading-relaxed"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      {prompt.preview}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); copy(prompt.preview); }}
                      className="btn-gold text-[9px] px-2 py-1"
                    >
                      {copied ? '✓ COPIED' : '⎘ COPY'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Goals ──────────────────────────────────────────────────────────

function GoalCard({ goal, color, onToggleTask, onAddTask, onDeleteGoal }) {
  const [newTask, setNewTask] = useState('');
  const tasks    = goal.tasks || [];
  const done     = tasks.filter(t => t.done).length;
  const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : (goal.progress || 0);

  const submitTask = () => {
    const text = newTask.trim();
    if (!text) return;
    onAddTask(goal.id, text);
    setNewTask('');
  };

  return (
    <motion.div variants={fadeUp} className="panel-raised rounded-xl p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="relative flex-shrink-0">
          <ProgressRing value={progress} size={52} strokeWidth={3} color={color} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[8px] font-bold leading-none" style={{ color }}>{progress}%</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-ui text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
            {goal.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {goal.category && (
              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color }}>
                {goal.category}
              </span>
            )}
            {goal.deadline && (
              <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                Due {format(parseISO(goal.deadline), 'MMM d, yyyy')}
              </span>
            )}
            {tasks.length > 0 && (
              <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>
                {done}/{tasks.length} tasks
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onDeleteGoal(goal.id)}
          className="font-mono text-[11px] opacity-20 hover:opacity-60 transition-opacity flex-shrink-0 mt-0.5"
          style={{ color: 'var(--text-muted)' }}
        >✕</button>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {tasks.map(task => (
            <motion.label
              key={task.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="flex items-start gap-2.5 cursor-pointer group"
            >
              <button
                type="button"
                onClick={() => onToggleTask(goal.id, task.id)}
                className="mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
                style={{
                  background: task.done ? color : 'transparent',
                  border: `1.5px solid ${task.done ? color : 'var(--border-default)'}`,
                  boxShadow: task.done ? `0 0 8px ${color}40` : 'none',
                }}
              >
                {task.done && (
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#07090f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              <span
                className="text-sm leading-snug transition-all"
                style={{
                  color: task.done ? 'var(--text-muted)' : 'var(--text-secondary)',
                  textDecoration: task.done ? 'line-through' : 'none',
                }}
              >
                {task.text}
              </span>
            </motion.label>
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            No tasks yet — add one below.
          </p>
        )}
      </div>

      {/* Add task row */}
      <div
        className="flex items-center gap-2 pt-3 border-t"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <input
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitTask(); }}
          placeholder="Add a task..."
          className="flex-1 bg-transparent text-xs focus:outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <MicButton value={newTask} onValue={setNewTask} />
        <button
          onClick={submitTask}
          disabled={!newTask.trim()}
          className="font-mono text-[8px] font-semibold px-2 py-1 rounded transition-all disabled:opacity-20"
          style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
        >
          + ADD
        </button>
      </div>
    </motion.div>
  );
}

export function GoalsSection({ data }) {
  const [goals, setGoals] = useState(() =>
    (data.goals || []).map(g => ({ ...g, tasks: g.tasks || [] }))
  );
  const [adding,      setAdding]      = useState(false);
  const [newTitle,    setNewTitle]    = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [synced,      setSynced]      = useState(false);

  const save = useCallback((next) => {
    setGoals(next);
    vaultSyncGoals(next);
  }, []);

  const toggleTask = (goalId, taskId) => {
    save(goals.map(g =>
      g.id !== goalId ? g : {
        ...g,
        tasks: g.tasks.map(t => t.id !== taskId ? t : { ...t, done: !t.done }),
      }
    ));
  };

  const addTask = (goalId, text) => {
    save(goals.map(g =>
      g.id !== goalId ? g : {
        ...g,
        tasks: [...g.tasks, { id: `t-${Date.now()}`, text, done: false }],
      }
    ));
  };

  const deleteGoal = (goalId) => save(goals.filter(g => g.id !== goalId));

  const submitGoal = () => {
    if (!newTitle.trim()) return;
    const next = [...goals, {
      id:       `g-${Date.now()}`,
      title:    newTitle.trim(),
      category: newCategory.trim() || 'General',
      brand:    null,
      deadline: newDeadline || null,
      tasks:    [],
      progress: 0,
    }];
    save(next);
    setAdding(false);
    setNewTitle('');
    setNewCategory('');
    setNewDeadline('');
  };

  const handleSync = async () => {
    await vaultSyncGoals(goals);
    setSynced(true);
    setTimeout(() => setSynced(false), 2000);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader
        icon="◭"
        title="Goals"
        subtitle="Set milestones, track tasks, sync to Obsidian"
        action={
          <div className="flex items-center gap-2">
            <button onClick={handleSync} className="btn-ghost text-[10px]">
              {synced ? '✓ SYNCED' : '⬆ SYNC'}
            </button>
            <button onClick={() => setAdding(a => !a)} className="btn-gold">
              + ADD GOAL
            </button>
          </div>
        }
      />

      {/* New goal form */}
      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="panel-raised rounded-xl p-5 space-y-4">
              <div className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
                NEW GOAL
              </div>

              {/* Title + mic */}
              <div className="flex items-center gap-2">
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitGoal(); }}
                  placeholder="Goal title..."
                  autoFocus
                  className="flex-1 bg-transparent text-sm focus:outline-none border-b pb-1 transition-colors"
                  style={{
                    color: 'var(--text-primary)',
                    borderColor: newTitle ? 'var(--gold)' : 'var(--border-default)',
                  }}
                />
                <MicButton value={newTitle} onValue={setNewTitle} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="Category (e.g. Revenue)"
                  className="bg-transparent text-xs focus:outline-none border-b pb-1"
                  style={{ color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}
                />
                <input
                  type="date"
                  value={newDeadline}
                  onChange={e => setNewDeadline(e.target.value)}
                  className="bg-transparent text-xs focus:outline-none border-b pb-1 font-mono"
                  style={{ color: 'var(--text-muted)', borderColor: 'var(--border-default)', colorScheme: 'dark' }}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={submitGoal} disabled={!newTitle.trim()} className="btn-gold disabled:opacity-30">
                  CREATE GOAL
                </button>
                <button onClick={() => setAdding(false)} className="btn-ghost">CANCEL</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Goal cards grid */}
      {goals.length === 0 ? (
        <div className="panel-raised rounded-xl p-12 text-center">
          <div className="text-3xl mb-3 opacity-20">◭</div>
          <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            No goals yet — click + ADD GOAL to create one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {goals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              color={PROJECT_COLORS[goal.brand] || '#c9a84c'}
              onToggleTask={toggleTask}
              onAddTask={addTask}
              onDeleteGoal={deleteGoal}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Journal ────────────────────────────────────────────────────────

const MOODS = [
  { id: 'focused', emoji: '🎯', label: 'Focused', color: '#c9a84c' },
  { id: 'winning', emoji: '🔥', label: 'Winning', color: '#4ade80' },
  { id: 'blocked', emoji: '😤', label: 'Blocked', color: '#ef4444' },
  { id: 'tired',   emoji: '😴', label: 'Tired',   color: '#8892a4' },
  { id: 'curious', emoji: '🧠', label: 'Curious', color: '#60a5fa' },
];

const MOOD_META = Object.fromEntries(MOODS.map(m => [m.id, m]));

export function JournalSection({ data }) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const [entries,   setEntries]   = useState(data.journal || []);
  const [title,     setTitle]     = useState('');
  const [body,      setBody]      = useState('');
  const [mood,      setMood]      = useState('focused');
  const [composing, setComposing] = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [expanded,  setExpanded]  = useState(null);

  const todayEntries = entries.filter(e => (e.date || '').slice(0, 10) === today);
  const pastEntries  = entries.filter(e => (e.date || '').slice(0, 10) !== today);

  const handleSave = async () => {
    if (!body.trim()) return;
    const now      = new Date().toISOString();
    const entryTitle = title.trim() || format(new Date(), 'MMMM d, yyyy');
    const entry = {
      id:    `j-${Date.now()}`,
      date:  today,
      title: entryTitle,
      body:  body.trim(),
      mood,
      tags:  [],
    };
    await vaultSaveJournal({ ...entry, date: now });
    setEntries(prev => [entry, ...prev]);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setComposing(false);
      setTitle('');
      setBody('');
      setMood('focused');
    }, 1200);
  };

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader
        icon="◳"
        title="Journal"
        subtitle={`Daily log — ${format(new Date(), 'EEEE, MMMM d')}`}
        action={
          <button onClick={() => setComposing(c => !c)} className="btn-gold">
            + NEW ENTRY
          </button>
        }
      />

      {/* Compose form */}
      <AnimatePresence>
        {composing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="panel-raised rounded-xl p-5 space-y-4">
              {/* Date stamp */}
              <div className="font-mono text-[9px] tracking-widest" style={{ color: 'var(--gold)' }}>
                {format(new Date(), 'EEEE, MMMM d yyyy — HH:mm')}
              </div>

              {/* Title row */}
              <div className="flex items-center gap-2">
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Entry title (optional)"
                  className="flex-1 bg-transparent text-sm border-b pb-1 focus:outline-none transition-colors"
                  style={{
                    color: 'var(--text-primary)',
                    borderColor: title ? 'var(--gold)' : 'var(--border-default)',
                  }}
                />
                <MicButton value={title} onValue={setTitle} />
              </div>

              {/* Mood selector */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] tracking-widest flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  MOOD
                </span>
                {MOODS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMood(m.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[9px] font-semibold transition-all"
                    style={mood === m.id ? {
                      background: `${m.color}20`,
                      color: m.color,
                      border: `1px solid ${m.color}50`,
                      boxShadow: `0 0 10px ${m.color}20`,
                    } : {
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    <span>{m.emoji}</span>
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>

              {/* Body + mic */}
              <div className="relative">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="What happened today? What did you build, decide, struggle with, or win?"
                  rows={6}
                  className="w-full bg-transparent text-sm resize-none focus:outline-none leading-relaxed pr-10"
                  style={{ color: 'var(--text-primary)' }}
                />
                <div className="absolute top-1 right-0">
                  <MicButton value={body} onValue={setBody} />
                </div>
              </div>

              {/* Actions */}
              <div
                className="flex gap-2 pt-3 border-t"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <button
                  onClick={handleSave}
                  disabled={!body.trim()}
                  className="btn-gold disabled:opacity-30"
                >
                  {saved ? '✓ SAVED TO VAULT' : 'SAVE TO VAULT'}
                </button>
                <button onClick={() => setComposing(false)} className="btn-ghost">
                  CANCEL
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Today's entries */}
      {todayEntries.length > 0 && (
        <div className="space-y-3">
          <div className="font-mono text-[9px] tracking-widest px-1" style={{ color: 'var(--gold)' }}>
            TODAY
          </div>
          {todayEntries.map(entry => (
            <JournalEntryCard key={entry.id} entry={entry} expanded={expanded} onExpand={setExpanded} />
          ))}
        </div>
      )}

      {/* Past entries */}
      {pastEntries.length > 0 && (
        <div className="space-y-3">
          {todayEntries.length > 0 && (
            <div className="font-mono text-[9px] tracking-widest px-1 pt-2" style={{ color: 'var(--text-muted)' }}>
              PREVIOUS
            </div>
          )}
          {pastEntries.map(entry => (
            <JournalEntryCard key={entry.id} entry={entry} expanded={expanded} onExpand={setExpanded} />
          ))}
        </div>
      )}

      {entries.length === 0 && !composing && (
        <div className="panel-raised rounded-xl p-12 text-center">
          <div className="text-3xl mb-3 opacity-20">◳</div>
          <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            No entries yet — click + NEW ENTRY to start.
          </p>
        </div>
      )}
    </motion.div>
  );
}

function JournalEntryCard({ entry, expanded, onExpand }) {
  const meta  = MOOD_META[entry.mood];
  const color = meta?.color || '#c9a84c';
  const open  = expanded === entry.id;

  return (
    <motion.div variants={fadeUp} className="panel-raised rounded-xl overflow-hidden">
      <button
        onClick={() => onExpand(open ? null : entry.id)}
        className="w-full flex items-center gap-4 p-4 text-left transition-all"
        style={{ background: open ? `${color}06` : undefined }}
      >
        {meta && (
          <span className="text-xl flex-shrink-0">{meta.emoji}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-ui text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {entry.title}
            </span>
            {meta && (
              <span
                className="font-mono text-[8px] px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: `${color}15`, color }}
              >
                {meta.label}
              </span>
            )}
          </div>
          <div className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>
            {format(parseISO(entry.date + 'T12:00:00'), 'EEEE, MMMM d yyyy')}
          </div>
        </div>
        <span
          className="font-mono text-[10px] flex-shrink-0 transition-transform"
          style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-3">
              <div
                className="pt-3 border-t"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {entry.body}
                </p>
              </div>
              {entry.aiSummary && (
                <div
                  className="p-3 rounded-lg"
                  style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)' }}
                >
                  <div className="font-mono text-[8px] tracking-widest mb-1" style={{ color: 'var(--gold)' }}>
                    ◈ AI DEBRIEF
                  </div>
                  <p className="text-xs italic leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {entry.aiSummary}
                  </p>
                </div>
              )}
              {entry.tags?.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {entry.tags.map(t => (
                    <span key={t} className="font-mono text-[8px]" style={{ color: PROJECT_COLORS[t] || 'var(--text-muted)' }}>
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Memory Vault ───────────────────────────────────────────────────
const SOURCE_ICON = { Obsidian: '🗂', 'Google Drive': '📁', Manual: '✍️' };

export function MemoryVaultSection({ data }) {
  const { memory } = data;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  const categories = ['All', ...new Set(memory?.map(m => m.category) || [])];
  const filtered = memory?.filter(m => {
    const matchesCat = filter === 'All' || m.category === filter;
    const matchesSearch = !search ||
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.content.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <motion.div variants={stagger} initial="initial" animate="animate" className="space-y-6">
      <SectionHeader
        icon="⬡"
        title="Memory Vault"
        subtitle="Persistent knowledge base — clients, SOPs, brand context, technical notes"
        action={<button className="btn-gold">+ ADD MEMORY</button>}
      />

      <motion.div variants={fadeUp} className="flex gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vault..."
          className="flex-1 min-w-48 bg-transparent border border-[rgba(201,168,76,0.15)] rounded-sm px-3 py-2 font-mono text-xs text-[#f0ede6] placeholder-[#4b5563] focus:outline-none focus:border-[rgba(201,168,76,0.4)] transition-colors"
        />
        <div className="flex gap-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`font-ui text-[10px] tracking-wider px-3 py-1.5 rounded-sm border transition-all ${
                filter === cat
                  ? 'text-[#07090f] bg-[#c9a84c] border-[#c9a84c]'
                  : 'text-[#4b5563] border-[rgba(201,168,76,0.15)] hover:border-[rgba(201,168,76,0.3)] hover:text-[#8892a4]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </motion.div>

      <div className="space-y-3">
        {filtered?.map((mem, i) => (
          <motion.div
            key={mem.id}
            variants={fadeUp}
            className="panel-gold rounded-sm p-4 card-hover"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="font-ui text-sm font-semibold text-[#f0ede6]">{mem.title}</span>
                  <span className="tag" style={{ color: '#c9a84c', borderColor: 'rgba(201,168,76,0.25)', background: 'rgba(201,168,76,0.08)' }}>
                    {mem.category}
                  </span>
                </div>
                <p className="font-body text-xs text-[#8892a4] leading-relaxed line-clamp-2">{mem.content}</p>
                <div className="flex items-center gap-3 mt-2">
                  {mem.tags.map(t => (
                    <span key={t} className="font-mono text-[9px] text-[#4b5563]">#{t}</span>
                  ))}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-mono text-[9px] text-[#4b5563] mb-1">
                  {SOURCE_ICON[mem.source]} {mem.source}
                </div>
                <div className="font-mono text-[9px] text-[#4b5563]">
                  {format(parseISO(mem.lastAccessed), 'MMM d HH:mm')}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
