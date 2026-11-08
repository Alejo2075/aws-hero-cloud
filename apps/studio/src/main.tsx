import { createRoot } from 'react-dom/client';
import '@fontsource/press-start-2p/latin-400.css';
import './index.css';
import { App } from './App.js';

// The components switch to their dark palette with a `dark` class; follow the system setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const apply = (): void => {
  document.documentElement.classList.toggle('dark', dark.matches);
};
apply();
dark.addEventListener('change', apply);

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(<App />);
