/**
 * The review page's mount point.
 *
 * Everything it renders lives in `ui/`. This file exists to attach that to a
 * DOM node and to pull in the stylesheet, which keeps the app itself testable
 * in jsdom without a build step.
 */

import { createRoot } from 'react-dom/client';
import { followLoggingSetting } from '@/lib/settings-store';
import { bootPageTheme } from '@/ui/pageTheme';
import { App } from '@/ui/App';
// Before the stylesheet, not after: everything in it refers to these by name.
import '@/ui/tokens.css';
import './style.css';

// Before React has a root to render into, because the frame this is getting in
// front of is gone by then. `storage.local` cannot be read synchronously and
// `localStorage` on this origin can, so the chosen theme is mirrored there and
// read back here. `ui/pageTheme.ts` carries the argument; `usePageTheme` inside
// the app is what keeps the mirror honest.
bootPageTheme();

// Not awaited: the page has nothing to say until something fails, and making
// the first paint wait on a storage read would be a poor trade.
void followLoggingSetting();

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
