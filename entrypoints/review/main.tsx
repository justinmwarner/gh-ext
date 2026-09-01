/**
 * The review page shell.
 *
 * It renders the route parameters and nothing else. Its job right now is to
 * prove the content script → background → tab navigation path end to end; the
 * review UI replaces this body later.
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseReviewHash } from '@/lib/github/pr-url';
import type { PrRef } from '@/lib/messages';

function useReviewRoute(): PrRef | null {
  const [ref, setRef] = useState(() => parseReviewHash(window.location.hash));

  useEffect(() => {
    // The page is never reloaded when the route changes — the worker navigates
    // an already-open review tab by replacing the hash.
    const onHashChange = () => setRef(parseReviewHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return ref;
}

function App() {
  const ref = useReviewRoute();

  if (ref === null) {
    return (
      <>
        <h1>Fast GitHub Review</h1>
        <p className="empty">
          No pull request in the URL. Open this page from the “Fast review”
          button on a pull request.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>
        {ref.owner}/{ref.repo} #{ref.number}
      </h1>
      <dl>
        <dt>owner</dt>
        <dd>{ref.owner}</dd>
        <dt>repo</dt>
        <dd>{ref.repo}</dd>
        <dt>number</dt>
        <dd>{ref.number}</dd>
      </dl>
    </>
  );
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
