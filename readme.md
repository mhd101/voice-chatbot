# Revolt Voice Bot

Revolt Voice Bot is a real-time AI-powered assistant designed specifically for Revolt Motors. It uses Google Gemini 2.5 Native Audio Dialog model for full-duplex voice interaction via WebSocket streaming. The bot understands and responds in multiple Indian languages, but only within the Revolt Motors context.

## Features

- Real-time voice communication using microphone
- Full-duplex streaming using WebSockets
- Gemini 2.5 native audio model support
- Responds only within the context of Revolt Motors
- Multi Language Support
- Interruption feature

## Demo Link

[Link](https://www.loom.com/share/e16d0ff322fe43aaaf0a859f19e91023)

## Project Structure

```
revolt-voice-bot/
│
├── backend/                  # Node.js backend for audio streaming & Gemini API integration
│   ├── .env                  # Environment variables (API keys etc.)
│   ├── index.js              # WebSocket server handling audio streams
│   ├── package.json          # Backend dependencies
│
├── frontend/                 # React app for capturing microphone and handling audio UI
│   ├── public/               # Static assets
│   ├── src/                  # Main React source code (App.jsx, components, etc.)
│   ├── index.html            # Root HTML template
│   ├── package.json          # Frontend dependencies
│   ├── vite.config.js        # Vite bundler config
│
├── .gitignore                # Git ignored files
├── readme.md                 # Project documentation
```

## Setup Instructions

### 1. Clone the Repo

```bash
git clone https://github.com/your-username/revolt-voice-bot.git
cd revolt-voice-bot
```

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in `/backend` with the following:

```
GEMINI_API_KEY=your_api_key_here
PORT=3000
```

Then run:

```bash
node index.js
```

### 3. Frontend Setup

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

This will start the Vite server at `http://localhost:3000`.


