/**
 * A kebab and the menu behind it.
 *
 * A menu is a trade: width on the row in exchange for a click on everything
 * inside. It is only worth making for controls a reviewer reaches for
 * occasionally, and it is only *safe* to make if what goes behind it stays
 * reachable — which is what most of this file is about. Escape, a click
 * elsewhere, and arrow keys, because a control that only a pointer can leave
 * is a trap rather than a menu.
 *
 * Data-driven rather than children: an item's disabled state, its checkedness
 * and its accessible role are all the same decision, and passing them as JSX
 * would let a caller draw a `<button>` in here that the menu's keyboard
 * handling knows nothing about.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

export interface MenuItem {
  /** Stable across renders. React's key, and nothing else. */
  id: string;
  label: string;
  onSelect: () => void;
  /**
   * Disabled rather than absent, wherever there is a reason to give. A control
   * that appears and disappears with the pull request is one the reviewer has
   * to rediscover; a disabled one with a title explains itself.
   */
  disabled?: boolean;
  title?: string;
  /**
   * Present for a toggle, absent for a command. A state the reviewer is in is
   * not an action they take once, and a plain `menuitem` cannot say which way
   * it is set.
   */
  checked?: boolean;
}

export interface MenuButtonProps {
  /** Names the trigger and the menu both. */
  label: string;
  items: readonly MenuItem[];
}

/** The vertical ellipsis, drawn rather than typed so it cannot fall back. */
function Kebab() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="3" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function MenuButton({ label, items }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  /** Which item the keyboard is on. Reset every time the menu opens. */
  const [at, setAt] = useState(0);

  // Pointerdown rather than click: a menu that waits for the whole click to
  // finish is still on screen while the reviewer is pressing something
  // underneath it, which is how a stray second activation happens.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      // The click that opened the menu is also a click on the page. Without
      // this the watcher sees it and the menu flickers shut.
      if (target instanceof Node && host.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  // The pointer is not required: opening puts the keyboard on the first item.
  useEffect(() => {
    if (!open) return;
    const first = items[0];
    if (first !== undefined) elements.current.get(first.id)?.focus();
  }, [open, items]);

  const shut = (): void => {
    setOpen(false);
    // Focus is on an item that is about to stop existing. Left alone the
    // keyboard falls back to the top of the document.
    trigger.current?.focus();
  };

  const move = (to: number): void => {
    const bounded = Math.max(0, Math.min(to, items.length - 1));
    setAt(bounded);
    const item = items[bounded];
    if (item !== undefined) elements.current.get(item.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') shut();
    else if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else return;

    event.preventDefault();
  };

  // A kebab that opens onto an empty menu is a control that appears broken.
  if (items.length === 0) return null;

  return (
    <div className="menu-host" ref={host}>
      <button
        type="button"
        className="menu-trigger"
        ref={trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setAt(0);
          setOpen((was) => !was);
        }}
      >
        <Kebab />
      </button>

      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="menu-item"
              ref={(node) => {
                if (node === null) elements.current.delete(item.id);
                else elements.current.set(item.id, node);
              }}
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              // Tab leaves a menu rather than moving inside one, so exactly one
              // item is in the sequence and the arrows do the rest.
              tabIndex={index === at ? 0 : -1}
              // `aria-disabled`, not `disabled`. A disabled element cannot take
              // focus, so arrowing onto one leaves focus where it was and takes
              // the menu's single tab stop with it — and the reason an item is
              // off is exactly what the reviewer came here to read.
              aria-disabled={item.disabled}
              title={item.title}
              onFocus={() => setAt(index)}
              onClick={() => {
                if (item.disabled === true) return;
                item.onSelect();
                shut();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
