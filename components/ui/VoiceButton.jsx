import { useState, useEffect, useRef, useCallback } from 'react';
import { FiMic, FiMicOff } from 'react-icons/fi';

// Web Speech API is browser-only. All access is guarded by the `supported`
// state which is only set after mount (never during SSR).
export default function VoiceButton({ onTranscript, disabled = false, className = '' }) {
  const [supported, setSupported]   = useState(false);
  const [listening, setListening]   = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(Boolean(SR));
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setTranscript('');
  }, []);

  const start = useCallback(() => {
    if (!supported || listening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.lang            = 'en-US';

    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('');
      setTranscript(text);
      if (e.results[e.results.length - 1].isFinal) {
        onTranscript?.(text.trim());
        setTranscript('');
        setListening(false);
      }
    };

    rec.onerror = () => stop();
    rec.onend   = () => { setListening(false); setTranscript(''); };

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [supported, listening, onTranscript, stop]);

  // Cleanup on unmount
  useEffect(() => () => recognitionRef.current?.stop(), []);

  if (!supported) return null;

  return (
    <div className="voice-button-wrapper">
      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={disabled}
        className={`voice-btn${listening ? ' voice-btn--active' : ''} ${className}`}
        aria-label={listening ? 'Stop recording' : 'Start voice input'}
        title={listening ? 'Stop recording' : 'Speak your instruction'}
      >
        <span className={listening ? 'voice-ring' : ''}>
          {listening ? <FiMicOff size={13} /> : <FiMic size={13} />}
        </span>
      </button>
      {transcript && (
        <span className="voice-transcript">{transcript}</span>
      )}
    </div>
  );
}