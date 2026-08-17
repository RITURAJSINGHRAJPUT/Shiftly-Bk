import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 'none' so the browser never answers an update check for the worker
    // script itself from a stale HTTP cache — it always checks the network,
    // which is what lets a fix like this one actually get picked up promptly.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  });
}
