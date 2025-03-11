import { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [message, setMessage] = useState<{ x: number, y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:4041');

    socket.onopen = () => {
      console.log('WebSocket connection opened');
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessage(data);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
    };

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (message && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the circle
        ctx.beginPath();
        ctx.arc(150, 150, 100, 0, 2 * Math.PI);
        ctx.stroke();

        // Draw the green line
        const x = 150 + message.x * 100;
        const y = 150 + message.y * 100;
        ctx.beginPath();
        ctx.moveTo(150, 150);
        ctx.lineTo(x, y);
        ctx.strokeStyle = 'green';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }, [message]);

  return (
    <div>
      <canvas ref={canvasRef} width={300} height={300} style={{ border: '1px solid green' }}></canvas>
    </div>
  );
}

export default App;