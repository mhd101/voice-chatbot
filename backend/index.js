import express from 'express';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { GoogleGenAI, MediaResolution, Modality } from '@google/genai';
dotenv.config();

// setting up the express server
const app = express();
const PORT = 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// create websocket server
const wss = new WebSocketServer({ server });

// storing session for each websocket connection
const sessions = new Map();

// handling new websocket connection
wss.on('connection', async (ws) => {
  console.log('WebSocket client connected');

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let session;

  try {
    // connecting to gemini live session
    session = await ai.live.connect({
      // Change the model name for specific need : gemini-2.5-flash-preview-native-audio-dialog
      model: 'models/gemini-live-2.5-flash-preview',
      config: {
        responseModalities: [Modality.AUDIO],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          languageCode: 'en-IN',
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck',
            },
          }
        },
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' },
        },
        // prompt to act as a revolt motor voice bot
        systemInstruction: {
          parts: [
            {
              text: `
              You are a voice assistant for Revolt Motors. Respond only in the language spoken by the user. You support Hindi, English, Marathi, Tamil, and other Indian languages. 
              You are a helpful voice assistant for Revolt Motors. Only answer questions or respond within the scope of Revolt Motors’ products, services, policies, customer support, and relevant company information.
              If a user asks something unrelated to Revolt Motors, politely respond that you cannot answer outside this.
              Do not generate responses outside the Revolt Motors domain, including personal opinions, unrelated facts, general knowledge, or external topics.
              Always keep responses brief, relevant, and professional.`,
            },
          ],
        },
      },
      // defining gemini session events callbacks
      callbacks: {
        onopen: () => {
          console.debug('Gemini session opened');
          // Send confirmation to client
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'status',
              message: 'Connected to Gemini Live'
            }));
          }
        },
        onmessage: (msg) => {
          console.debug('Gemini message received:', JSON.stringify(msg, null, 2));
          // sending model response back to the frontend
          handleModelTurn(msg, ws);
        },
        onerror: (e) => {
          console.error('Gemini Error:', e);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Gemini error: ' + e.message
            }));
          }
        },
        onclose: (e) => {
          console.debug('Gemini session closed:', e.reason);
          
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Gemini session closed: ' + e.reason
            }));
          }
        },
      },
    });

    sessions.set(ws, session);
    console.log('Gemini session created and stored');

  } catch (error) {
    console.error('Failed to create Gemini session:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to connect to Gemini: ' + error.message
    }));
    return;
  }

  // when a message is received from the client
  ws.on('message', async (message) => {
    const currentSession = sessions.get(ws);
    if (!currentSession) {
      console.error('No session found for WebSocket');
      return;
    }

    try {
      // Check if message is JSON (text or control messages)
      if (message[0] === 0x7B) { // ASCII for '{'
        const jsonMessage = JSON.parse(message.toString());

        if (jsonMessage.type === 'text') {
          console.log('User text:', jsonMessage.text);
          await currentSession.sendClientContent({
            turns: [{
              role: 'user',
              parts: [{ text: jsonMessage.text }]
            }],
            turnComplete: true
          });
        }
      } else {
        // Handle binary audio data
        console.log('Received audio data, size:', message.length);

        try {
          // Convert audio to proper format for Gemini
          const audioData = await processAudioData(message);

          if (audioData) {
            console.log('Sending processed audio to Gemini...');

            await currentSession.sendClientContent({
              turns: [{
                role: 'user',
                parts: [{
                  inlineData: {
                    mimeType: audioData.mimeType,
                    data: audioData.data
                  }
                }]
              }],
              turnComplete: true
            });

            console.log('Audio sent successfully to Gemini');
          }

        } catch (error) {
          console.error('Error processing audio:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process audio: ' + error.message
          }));
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message: ' + error.message
      }));
    }
  });

  // handling websocket closure
  ws.on('close', () => {
    const currentSession = sessions.get(ws);
    if (currentSession) {
      currentSession.close();
      sessions.delete(ws);
    }
    console.log('WebSocket client disconnected');
  });

  // handling websocket errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    const currentSession = sessions.get(ws);
    if (currentSession) {
      currentSession.close();
      sessions.delete(ws);
    }
  });
});

// converts audio buffer to base64 and determines MIME type. Support WAV and raw PCM formats
async function processAudioData(audioBuffer) {
  try {
    // Check if it's a WAV file
    const wavHeader = audioBuffer.slice(0, 4).toString();

    if (wavHeader === 'RIFF') {
      // It's a WAV file, extract parameters
      const view = new DataView(audioBuffer.buffer || audioBuffer);
      const sampleRate = view.getUint32(24, true);
      const channels = view.getUint16(22, true);
      const bitsPerSample = view.getUint16(34, true);

      console.log('WAV file detected:', {
        sampleRate,
        channels,
        bitsPerSample,
        size: audioBuffer.length
      });

      // Convert to the format Gemini expects
      // Gemini Live typically expects PCM audio
      const audioData = Buffer.from(audioBuffer).toString('base64');
      console.log(audioData)

      // Use the correct MIME type based on the WAV properties
      let mimeType;
      if (sampleRate === 16000 && channels === 1 && bitsPerSample === 16) {
        mimeType = 'audio/pcm;rate=16000';
      } else if (sampleRate === 24000 && channels === 1 && bitsPerSample === 16) {
        mimeType = 'audio/pcm;rate=24000';
      } else {
        // Default fallback
        mimeType = `audio/pcm;rate=${sampleRate}`;
      }

      return {
        data: audioData,
        mimeType: mimeType
      };
    } else {
      // Try to handle as raw PCM or other format
      console.log('Non-WAV audio data, treating as raw PCM');
      const audioData = Buffer.from(audioBuffer).toString('base64');

      return {
        data: audioData,
        mimeType: 'audio/pcm;rate=16000' // Default assumption
      };
    }
  } catch (error) {
    console.error('Error processing audio data:', error);
    return null;
  }
}

// handling model responses and sends them to client 
function handleModelTurn(message, ws) {
  console.log('handleModelTurn called');

  try {
    if (message.serverContent?.modelTurn?.parts) {
      const parts = message.serverContent.modelTurn.parts;
      console.log('Model turn parts:', parts.length);

      for (const part of parts) {
        if (part?.inlineData) {
          const { data, mimeType } = part.inlineData;
          console.log('Received audio response, mimeType:', mimeType);

          // Send audio response to client
          const audioBuffer = Buffer.from(data, 'base64');

          // First send a message indicating audio is coming
          ws.send(JSON.stringify({ type: 'audio' }));
          // Then send the actual audio data
          ws.send(audioBuffer);

          console.log('Audio response sent to client, size:', audioBuffer.length);
        }
      }
    }

    // Also check for setup complete or other server content
    if (message.serverContent?.setupComplete) {
      console.log('Setup complete received');
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Setup complete'
      }));
    }

    if (message.serverContent?.turnComplete) {
      console.log('Turn complete received');
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Turn complete'
      }));
    }

  } catch (error) {
    console.error('Error in handleModelTurn:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Error processing response: ' + error.message
    }));
  }
}
