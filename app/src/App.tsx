import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [message, setMessage] = useState('');

    useEffect(() => {
        const socket = new WebSocket('ws://localhost:4041');

        socket.onopen = () => {
            console.log('WebSocket connection opened');
        };

        socket.onmessage = (event) => {
            setMessage(event.data);
        };

        socket.onclose = () => {
            console.log('WebSocket connection closed');
        };

        return () => {
            socket.close();
        };
    }, []);

  return (
    <>
      <div>
          <h1>Received Message</h1>
          <p>{message}</p>
      </div>
    </>
  )
}

export default App
