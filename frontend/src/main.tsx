import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ color: '#2563eb' }}>🚀 Stock Market Simulator</h1>
      <p style={{ color: '#059669' }}>✅ Frontend is working perfectly!</p>
      <div style={{ 
        background: '#f0f9ff', 
        padding: '16px', 
        borderRadius: '8px',
        marginTop: '20px' 
      }}>
        <h3>System Status:</h3>
        <ul>
          <li>✅ React App Running</li>
          <li>✅ Vite Build System Active</li>
          <li>⏳ Backend Connection Pending</li>
        </ul>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);