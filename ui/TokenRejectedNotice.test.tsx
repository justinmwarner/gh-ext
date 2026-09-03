/**
 * The banner that turns a per-control failure into one the reviewer can act on.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TokenRejectedNotice } from './TokenRejectedNotice';

vi.mock('./openOptions', () => ({ openOptions: vi.fn() }));

describe('TokenRejectedNotice', () => {
  it('says what has stopped working, and what has not', async () => {
    render(<TokenRejectedNotice retry={() => {}} />);

    const text = screen.getByRole('alert').textContent ?? '';
    // Both halves matter. Naming only the breakage would suggest the diff on
    // screen is untrustworthy too, and it is not.
    expect(text).toMatch(/posted|resolved|viewed/i);
    expect(text).toMatch(/safe to read|still.*read/i);
  });

  it('offers the page that can actually fix it', async () => {
    const { openOptions } = await import('./openOptions');
    render(<TokenRejectedNotice retry={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /check your token/i }));

    expect(openOptions).toHaveBeenCalled();
  });

  it('offers a reload once the token has been replaced', async () => {
    const retry = vi.fn();
    render(<TokenRejectedNotice retry={retry} />);

    await userEvent.click(screen.getByRole('button', { name: /reload/i }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
