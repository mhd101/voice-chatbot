import { useEffect, useRef, useState } from "react";

export default function App() {
  const ws = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Audio recording
  const [responseText, setResponseText] = useState('')
  const mediaRecorder = useRef(null);
  const audioStream = useRef(null);
  const recordedChunks = useRef([]);
  
  // Audio playback
  const audioChunks = useRef([]);
  const isPlaying = useRef(false);
  const currentAudio = useRef(null);
  const audioContext = useRef(null);
  const bufferTimeout = useRef(null);
  // const bufferSize = 1;
  const [responseStartTime, setResponseStartTime] = useState(null);
  const [audioStartTime, setAudioStartTime] = useState(null);

  useEffect(() => {
    initializeAudioContext();
    connectWebSocket();
    return () => {
      if (ws.current) {
        ws.current.close();
      }
      cleanupAudio();
      stopRecording();
    };
  }, []);

  const initializeAudioContext = () => {
    try {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
      console.error("Web Audio API not supported:", error);
    }
  };

  const connectWebSocket = () => {
    try {
      ws.current = new WebSocket("ws://localhost:3000");
      ws.current.binaryType = "arraybuffer";

      ws.current.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
      };

      ws.current.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsConnected(false);
      };

      ws.current.onmessage = async (message) => {
        if (message.data instanceof ArrayBuffer) {
          console.log("Audio ArrayBuffer Received, size:", message.data.byteLength);
          
          if (!audioStartTime && responseStartTime) {
            const latency = Date.now() - responseStartTime;
            setAudioStartTime(Date.now());
            console.log(`First audio chunk received in ${latency}ms`);
          }
          
          const audioBlob = new Blob([message.data], { type: 'audio/pcm' });
          audioChunks.current.push(audioBlob);
          handleAudioBuffering();
        }
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
    }
  };

  const handleAudioBuffering = () => {
    if (isRecording) {
      console.log("User is recording, skipping audio playback");
      return;
    }

    if (bufferTimeout.current) {
      clearTimeout(bufferTimeout.current);
    }

    if (audioChunks.current.length >= 1 && !isPlaying.current) {
      bufferTimeout.current = setTimeout(() => {
        processAudioChunks();
      }, 50);
    }
  };

  const processAudioChunks = async () => {
    if (audioChunks.current.length === 0 || isPlaying.current || isRecording) return;

    try {
      if (audioContext.current && audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }

      const chunksToProcess = [...audioChunks.current];
      audioChunks.current = [];

      const concatenatedBuffer = await concatenateGeminiAudioChunks(chunksToProcess);
      await playConcatenatedAudio(concatenatedBuffer);

    } catch (error) {
      console.error("Audio processing error:", error);
      isPlaying.current = false;
    }
  };

  const concatenateGeminiAudioChunks = async (chunks) => {
    if (!audioContext.current) {
      throw new Error("Audio context not available");
    }

    console.log(`Processing ${chunks.length} Gemini audio chunks`);

    const audioBuffers = [];
    let totalLength = 0;
    const sampleRate = 24000;
    const numberOfChannels = 1;

    for (const chunk of chunks) {
      try {
        const arrayBuffer = await chunk.arrayBuffer();
        const audioBuffer = await convertGeminiPCMToAudioBuffer(arrayBuffer, sampleRate);
        
        if (audioBuffer) {
          audioBuffers.push(audioBuffer);
          totalLength += audioBuffer.length;
        }
      } catch (error) {
        console.error("Error processing audio chunk:", error);
      }
    }

    if (audioBuffers.length === 0) {
      throw new Error("No valid audio buffers to concatenate");
    }

    const concatenatedBuffer = audioContext.current.createBuffer(
      numberOfChannels,
      totalLength,
      sampleRate
    );

    let offset = 0;
    for (const buffer of audioBuffers) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        if (channel < numberOfChannels) {
          concatenatedBuffer.getChannelData(channel).set(
            buffer.getChannelData(channel),
            offset
          );
        }
      }
      offset += buffer.length;
    }

    return concatenatedBuffer;
  };

  const convertGeminiPCMToAudioBuffer = async (pcmArrayBuffer, sampleRate) => {
    try {
      const pcmData = new Int16Array(pcmArrayBuffer);
      
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0;
      }
      
      const audioBuffer = audioContext.current.createBuffer(1, pcmData.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Data);
      
      console.log(`Converted PCM to AudioBuffer: ${(pcmData.length / sampleRate).toFixed(2)}s`);
      return audioBuffer;
    } catch (error) {
      console.error("Error converting PCM to AudioBuffer:", error);
      return null;
    }
  };

  const playConcatenatedAudio = async (audioBuffer) => {
    if (!audioContext.current || !audioBuffer || isRecording) return;

    isPlaying.current = true;

    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.current.destination);

    currentAudio.current = source;

    source.onended = () => {
      isPlaying.current = false;
      currentAudio.current = null;
      
      if (audioChunks.current.length > 0 && !isRecording) {
        handleAudioBuffering();
      }
    };

    try {
      source.start();
      console.log(`Playing concatenated audio: ${audioBuffer.duration.toFixed(2)}s`);
    } catch (error) {
      console.error("Error starting audio playback:", error);
      isPlaying.current = false;
    }
  };

  const handleInterruption = () => {
    console.log("Handling audio interruption");
    
    if (currentAudio.current) {
      try {
        currentAudio.current.stop();
        console.log("Stopped current audio playback due to interruption");
      } catch (error) {
        console.log("Audio already stopped");
      }
      currentAudio.current = null;
    }
    
    isPlaying.current = false;
    audioChunks.current = [];
    
    if (bufferTimeout.current) {
      clearTimeout(bufferTimeout.current);
      bufferTimeout.current = null;
    }
    
    setResponseText("");
    
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'interrupt',
        timestamp: Date.now()
      }));
    }
  };

  const cleanupAudio = () => {
    if (bufferTimeout.current) {
      clearTimeout(bufferTimeout.current);
      bufferTimeout.current = null;
    }

    if (currentAudio.current) {
      try {
        currentAudio.current.stop();
      } catch (error) {
        // Audio might already be stopped
      }
      currentAudio.current = null;
    }

    audioChunks.current = [];
    isPlaying.current = false;
  };

  const startRecording = async () => {
    try {
      if (isPlaying.current || audioChunks.current.length > 0) {
        handleInterruption();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      recordedChunks.current = [];
      
      mediaRecorder.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.current.push(event.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        sendRecordedAudio();
      };

      audioStream.current = stream;
      mediaRecorder.current.start();
      setIsRecording(true);
      
      console.log("Recording started - audio playback interrupted if it was playing");
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
    }
    
    if (audioStream.current) {
      audioStream.current.getTracks().forEach(track => track.stop());
      audioStream.current = null;
    }
    
    setIsRecording(false);
    console.log("Recording stopped");
  };

  const sendRecordedAudio = async () => {
    if (recordedChunks.current.length === 0 || !ws.current) return;

    const requestStartTime = Date.now();
    console.log("🎤 Sending audio request...");

    try {
      const audioBlob = new Blob(recordedChunks.current, { type: 'audio/webm' });
      
      if (audioBlob.size < 1000) {
        alert('Recording too short. Please record for at least 1 second.');
        return;
      }

      const wavBuffer = await convertBlobToWAV(audioBlob);
      
      console.log('Sending audio to server:', wavBuffer.byteLength, 'bytes');
      
      setResponseStartTime(null);
      setAudioStartTime(null);
      
      const message = {
        type: 'audio_with_timestamp',
        timestamp: requestStartTime,
      };
      
      ws.current.send(JSON.stringify(message));
      ws.current.send(wavBuffer);
      
      setResponseText("");
      
    } catch (error) {
      console.error("Error sending audio:", error);
      alert("Failed to send audio: " + error.message);
    }
  };

  const convertBlobToWAV = async (blob) => {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      blob.arrayBuffer().then(buffer => {
        return audioContext.decodeAudioData(buffer);
      }).then(audioBuffer => {
        const wavBuffer = audioBufferToWAV(audioBuffer, 16000, 1);
        resolve(wavBuffer);
      }).catch(error => {
        console.error("Error converting audio:", error);
        reject(error);
      });
    });
  };

  const audioBufferToWAV = (audioBuffer, sampleRate, numChannels) => {
    const originalRate = audioBuffer.sampleRate;
    let audioData = audioBuffer.getChannelData(0);
    
    if (originalRate !== sampleRate) {
      audioData = resampleAudio(audioData, originalRate, sampleRate);
    }
    
    const length = audioData.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    const int16Data = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      int16Data[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
    }
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    const wavData = new Int16Array(arrayBuffer, 44);
    wavData.set(int16Data);
    
    return arrayBuffer;
  };

  const resampleAudio = (audioData, fromRate, toRate) => {
    const ratio = fromRate / toRate;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);
    
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const index = Math.floor(srcIndex);
      const fraction = srcIndex - index;
      
      if (index + 1 < audioData.length) {
        result[i] = audioData[index] * (1 - fraction) + audioData[index + 1] * fraction;
      } else {
        result[i] = audioData[index] || 0;
      }
    }
    
    return result;
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8">
      {/* Header */}
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-black mb-4">Revolt Voice Bot</h1>
      </div>

      {/* Recording Button - Centered */}
      <div className="mb-16 cursor-pointer mt-[-50px]">
        <button
          onClick={toggleRecording}
          disabled={!isConnected}
          className={`w-32 h-32 rounded-full border-4 transition-all duration-200 flex items-center cursor-pointer justify-center ${
            isRecording
              ? 'bg-black border-black text-white'
              : isConnected
              ? 'bg-white border-black text-black hover:bg-black hover:text-white'
              : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
          }`}
        >
          <div className="text-center ">
            {/* Microphone Icon using CSS */}
            <div className="mb-2">
              <svg
                className="w-8 h-8 mx-auto"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="text-xs font-medium">
              {isRecording ? 'STOP' : 'TALK'}
            </div>
          </div>
        </button>
      </div>

      {/* Status Indicators */}
      {isRecording && (
        <div className="mb-8">
          <div className="flex items-center gap-2 text-black">
            <div className="w-3 h-3 bg-black rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">Recording...</span>
          </div>
        </div>
      )}

    </div>
  );
}