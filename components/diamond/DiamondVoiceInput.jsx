import { useEffect, useRef, useState } from 'react';
import { FiMic, FiMicOff } from 'react-icons/fi';

export default function DiamondVoiceInput({ onTranscript }) {
  const recognitionRef = useRef(null);
  const transcriptHandlerRef = useRef(onTranscript);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState('Checking browser support…');

  useEffect(() => {
    transcriptHandlerRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      setMessage('Voice input is not supported in this browser.');
      return undefined;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onstart = () => {
      setListening(true);
      setMessage('Listening for one command…');
    };
    recognition.onend = () => {
      setListening(false);
      setMessage('Voice is available. Nothing is sent until you speak.');
    };
    recognition.onerror = event => {
      setListening(false);
      setMessage(event.error === 'not-allowed'
        ? 'Microphone permission was not granted.'
        : 'Voice input could not capture that command.');
    };
    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) transcriptHandlerRef.current(transcript);
    };

    recognitionRef.current = recognition;
    setSupported(true);
    setMessage('Voice is available. Nothing is sent until you speak.');

    return () => recognition.abort();
  }, []);

  function toggleListening() {
    if (!recognitionRef.current || !supported) return;
    if (listening) recognitionRef.current.stop();
    else {
      try {
        recognitionRef.current.start();
      } catch {
        setMessage('Voice input is already active.');
      }
    }
  }

  return (
    <div className={`diamond-voice-input ${supported ? 'supported' : 'unsupported'}`}>
      <button type="button" onClick={toggleListening} disabled={!supported}>
        {supported ? <FiMic size={17} /> : <FiMicOff size={17} />}
        {listening ? 'Stop listening' : 'Speak command'}
      </button>
      <p>{message}</p>
      <span>Browser speech recognition · no command execution</span>
    </div>
  );
}
