/**
 * The review page's mount point.
 *
 * Everything it renders lives in `ui/`. This file exists to attach that to a
 * DOM node and to pull in the stylesheet, which keeps the app itself testable
 * in jsdom without a build step.
 */

import { createRoot } from 'react-dom/client';
import { App } from '@/ui/App';
import './style.css';

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
