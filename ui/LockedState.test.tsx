import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LockedState } from './LockedState';

/**
 * The screen a reviewer sees every time they open a browser. It has to take
 * the passphrase without sending them somewhere else, and it has to say what
 * happened when the passphrase is wrong — a locked vault that silently stays
 * locked is indistinguishable from a broken extension.
 */

const PR = { owner: 'acme', repo: 'widgets', number: 42 };

describe('LockedState', () => {
  test('asks for the passphrase without leaving the page', async () => {
    render(<LockedState pr={PR} onUnlock={vi.fn()} />);

    expect(screen.getByLabelText(/passphrase/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /unlock/i })).toBeTruthy();
  });

  test('the passphrase is not readable on screen', () => {
    render(<LockedState pr={PR} onUnlock={vi.fn()} />);

    expect(screen.getByLabelText(/passphrase/i).getAttribute('type')).toBe('password');
  });

  test('unlocking hands over exactly what was typed', async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<LockedState pr={PR} onUnlock={onUnlock} />);

    await userEvent.type(screen.getByLabelText(/passphrase/i), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledWith('correct horse');
    });
  });

  test('Enter unlocks, because that is what a password field invites', async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<LockedState pr={PR} onUnlock={onUnlock} />);

    await userEvent.type(screen.getByLabelText(/passphrase/i), 'correct horse{Enter}');

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledWith('correct horse');
    });
  });

  test('a refused passphrase is reported in the words the vault used', async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error('That passphrase does not open this vault.'));
    render(<LockedState pr={PR} onUnlock={onUnlock} />);

    await userEvent.type(screen.getByLabelText(/passphrase/i), 'wrong{Enter}');

    expect(await screen.findByText(/does not open this vault/i)).toBeTruthy();
  });

  test('an empty passphrase does not reach the vault', async () => {
    const onUnlock = vi.fn();
    render(<LockedState pr={PR} onUnlock={onUnlock} />);

    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));

    expect(onUnlock).not.toHaveBeenCalled();
  });
});
