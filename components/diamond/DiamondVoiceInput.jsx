import { useCallback, useEffect, useRef, useState } from 'react';
import { FiMic, FiMicOff } from 'react-icons/fi';

export default function DiamondVoiceInput({ onTranscript }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim,   setInterim]   = useState('');
  const recognitionRef  = useRef(null);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = 'en-US';

    rec.onstart  = () => { setListening(true); };
    rec.onend    = () => { setListening(false); setInterim(''); };
    rec.onerror  = () => { setListening(false); setInterim(''); };
    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('');
      setInterim(text);
      if (e.results[e.results.length - 1].isFinal) {
        onTranscriptRef.current?.(text.trim());
        setInterim('');
      }
    };

    recognitionRef.current = rec;
    setSupported(true);
    return () => rec.abort();
  }, []);

  const toggle = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) rec.stop();
    else { try { rec.start(); } catch { /* already active */ } }
  }, [listening]);

  if (!supported) return null;

  return (
    <div className="diamond-voice-input">
      <button
        type="button"
        className={`diamond-voice-trigger${listening ? ' diamond-voice-trigger--active' : ''}`}
        onClick={toggle}
        aria-label={listening ? 'Stop voice input' : 'Speak a command'}
      >
        <span className={`diamond-voice-icon${listening ? ' diamond-voice-icon--pulse' : ''}`}>
          {listening ? <FiMicOff size={14} /> : <FiMic size={14} />}
        </span>
        {listening ? 'Listening…' : 'Speak command'}
      </button>

      {interim && (
        <span className="diamond-voice-live">{interim}</span>
      )}
    </div>
  );
}
