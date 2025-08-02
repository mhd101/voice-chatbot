import { useEffect, useRef, useState } from "react"

function App() {

  const [isRecording, setIsRecording] = useState(false)
  const audioRef = useRef(null)
  const wsRef = useRef(null)
  const mediaRecorderRef = useRef(null)

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true})
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm"
    })

    wsRef.current = new WebSocket("ws://localhost:3001")

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0){
        e.data.arrayBuffer().then((buffer) => {
          const wavBuffer = convertToWav(new Uint8Array(buffer))
          wsRef.current.send(wavBuffer)
        })
      }
    }

    wsRef.current.onmessage = (e) => {
      const audioBlob = base64ToBlob(e.data, "audio/mp3")
      const audioURL = URL.createObjectURL(audioBlob)
      audioRef.current.src = audioURL
      audioRef.current.play()
    }

    mediaRecorder.start(1000)
    mediaRecorderRef.current = mediaRecorder
    setIsRecording(true)
  }

  const stopRecording = () => {
    mediaRecorderRef.current.stop();
    wsRef.current.close()
    setIsRecording(false);
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-3xl font-bold mb-4">Revolt Voice Assistant</h1>
        <button onClick={isRecording ? stopRecording : startRecording} className="bg-blue-600 text-white px-6 py-2 rounded cursor-pointer">{isRecording ? "Stop" : "Start Talking"}</button>
        <audio ref={audioRef} controls className="mt-6"></audio>
      </div>
    </>
  )
}

export default App

// Utility Functions

function base64ToBlob(base64, type){
  const byteCharacters = atob(base64)
  const byteArrays = []

  for(let offset = 0; offset < byteCharacter.length; offset += 512){
    const slice = byteCharacters.slice(offset, offset+512)
    const byteNumber = new Array(slice.length)
    for(let i=0; i < slice.length; i++){
      byteNumber[i] = slice.charCodeAt(i)
    }
    byteArrays.push(new Uint8Array(byteNumber))
  }
  return new Blob(byteArrays, {type})
}

function convertToWav(buffer){
  return buffer; // assume input is WAV
}


