const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    // console.log('Client connected');

    ws.on('message', (message) => {
        let buf = Buffer.from(message);
        console.log('Received:', buf.toString());
    });

    ws.on('close', () => {
        // console.log('Client disconnected');
    });
});

console.log('WebSocket server is listening on ws://localhost:8080');