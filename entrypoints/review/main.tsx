/**
 * The review page's mount point.
 *
 * Everything it renders lives in `ui/`. This file exists to attach that to a
 * DOM node and to pull in the stylesheet, which keeps the app itself testable
 * in jsdom without a build step.
 */

import { createRoot } from 'react-dom/client';
import { followLoggingSetting } from '@/lib/settings-store';
import { App } from '@/ui/App';
// Before the stylesheet, not after: everything in it refers to these by name.
import '@/ui/tokens.css';
import './style.css';

// Not awaited: the page has nothing to say until something fails, and making
// the first paint wait on a storage read would be a poor trade.
void followLoggingSetting();

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
