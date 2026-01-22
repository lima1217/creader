import React from 'react';
import ReactDOM from 'react-dom/client';
import { AIPanelWindow } from './components/AIPanelWindow';
import './index.css';
import './App.css';
import './components/AIPanel.css';

// This is the entry point for the standalone AI window
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <AIPanelWindow />
    </React.StrictMode>,
);
