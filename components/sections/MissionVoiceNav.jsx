import { useCallback, useEffect, useRef, useState } from 'react';
import { FiArrowRight, FiMic, FiMicOff } from 'react-icons/fi';
import { useStore } from '../../lib/store';

// Ordered by priority — more specific phrases first within each section group.
const VOICE_ROUTES = [
  { phrases: ['diamond control'],                      section: 'diamond-control',              label: 'Diamond Control'   },
  { phrases: ['agent hub', 'agents hub', 'workforce'], section: 'agents-hub',                   label: 'Agents Hub'        },
  { phrases: ['mission control'],                      section: 'mission-control',              label: 'Mission Control'   },
  { phrases: ['boardroom', 'board room'],              section: 'boardroom',                    label: 'Boardroom'         },
  { phrases: ['hermes'],                               section: 'hermes-workspace',             label: 'Hermes'            },
  { phrases: ['openclaw'],                             section: 'openclaw-status',              label: 'OpenClaw'          },
  { phrases: ['memory vault', 'memory'],               section: 'memory-vault',                 label: 'Memory Vault'      },
  { phrases: ['journal'],                              section: 'journal',                      label: 'Journal'           },
  { phrases: ['goals', 'goal'],                        section: 'goals',                        label: 'Goals'             },
  { phrases: ['approvals', 'approval', 'telegram'],    section: 'telegram',                     label: 'Approvals'         },
  { phrases: ['content pipeline', 'pipeline'],         section: 'pipeline',                     label: 'Content Pipeline'  },
  { phrases: ['task dispatch', 'dispatch'],            section: 'task-dispatch',                label: 'Task Dispatch'     },
  { phrases: ['revenue'],                              section: 'revenue',                      label: 'Revenue'           },
  { phrases: ['leads', 'lead pipeline'],               section: 'leads',                        label: 'Leads'             },
  { phrases: ['cost intelligence', 'costs'],           section: 'diamond-control:costs',        label: 'Cost Intelligence' },
  { phrases: ['engineering'],                          section: 'diamond-control:engineering',  label: 'Engineering'       },
  { phrases: ['vault'],                                section: 'memory-vault',                 label: 'Memory Vault'      },
  { phrases: ['agents'],                               section: 'agents-hub',                   label: 'Agents Hub'        },
];

function resolveRoute(transcript) {
  const lower = transcript.toLowerCase();
  return VOICE_ROUTES.find(r => r.phrases.some(p => lower.includes(p))) || null;
}

export default function MissionVoiceNav() {
  const { setActiveSection } = useStore();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim,   setInterim]   = useState('');
  const [feedback,  setFeedback]  = useState(null); // { label, ok }
  const recognitionRef = useRef(null);
  const timerRef       = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = 'en-US';

    rec.onstart  = () => { setListening(true); setFeedback(null); };
    rec.onend    = () => { setListening(false); setInterim(''); };
    rec.onerror  = () => { setListening(false); setInterim(''); };
    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('');
      setInterim(text);
      if (e.results[e.results.length - 1].isFinal) {
        setInterim('');
        const route = resolveRoute(text);
        clearTimeout(timerRef.current);
        if (route) {
          setFeedback({ label: `Opening ${route.label}`, ok: true });
          setActiveSection(route.section);
        } else {
          setFeedback({ label: `"${text.trim()}" — not recognised`, ok: false });
        }
        timerRef.current = setTimeout(() => setFeedback(null), 3500);
      }
    };

    recognitionRef.current = rec;
    setSupported(true);
    return () => { rec.abort(); clearTimeout(timerRef.current); };
  }, [setActiveSection]);

  const toggle = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) rec.stop();
    else { try { rec.start(); } catch { /* already active */ } }
  }, [listening]);

  if (!supported) return null;

  return (
    <div className="mission-voice-bar">
      <button
        type="button"
        className={`mission-voice-btn font-ui${listening ? ' mission-voice-btn--active' : ''}`}
        onClick={toggle}
        aria-label={listening ? 'Stop voice navigation' : 'Speak to navigate'}
      >
        {listening ? <FiMicOff size={13} /> : <FiMic size={13} />}
        {listening ? 'Listening…' : 'Voice navigate'}
      </button>

      <div className="mission-voice-status">
        {interim && (
          <span className="mission-voice-interim font-mono">{interim}</span>
        )}
        {!interim && feedback && (
          <span className={`mission-voice-feedback font-mono${feedback.ok ? ' mission-voice-feedback--ok' : ' mission-voice-feedback--miss'}`}>
            {feedback.ok && <FiArrowRight size={10} />}
            {feedback.label}
          </span>
        )}
        {!interim && !feedback && (
          <span className="mission-voice-hint font-mono">
            {listening ? 'Say a section name…' : 'Say a section name to navigate'}
          </span>
        )}
      </div>
    </div>
  );
}
