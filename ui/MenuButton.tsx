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
 *
 * Two shapes of menu use it. The commit menu is a handful of commands, each of
 * which is the whole reason for opening it, so choosing one shuts the menu. The
 * file filters are the opposite — a reviewer opens that menu to set three
 * things — so it arrives in labelled sections, and its boxes ask to leave the
 * menu open. One keyboard serves both: the arrows walk every item in order,
 * across sections, exactly as they walk a single list.
 */

import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * Opening the menu from somewhere other than its trigger.
 *
 * For a sentence elsewhere on the page that names what the menu is doing — the
 * scope bar's "Showing 12 of 40 files" — and is a button because following it
 * should land the reviewer in the controls that set it. A handle rather than an
 * `open` prop, for the reason `FilesView.openFind` gives: this is an event, and
 * a prop would have to be unset again by whoever set it.
 */
export interface MenuButtonHandle {
  open(): void;
}

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
  /**
   * Leave the menu open once this has run, with the keyboard still on it.
   *
   * For a box that is one of several. A menu that shut on each of them would
   * be opened three times to set three filters, and would drop the reviewer's
   * place in it every time.
   */
  keepOpen?: boolean;
  /** A figure drawn after the label, muted: how many files a row stands for. */
  detail?: string;
  /**
   * A sentence under the label, drawn and read.
   *
   * On screen rather than in a `title`, because what goes here is the kind of
   * thing a reviewer has to be told — why a row is off, or what it could not
   * check — and a tooltip says nothing until a pointer happens to find it. It
   * describes the item rather than joining its name, so the name stays short
   * enough to be recognised when it is announced.
   */
  note?: string;
}

/** A run of items under one heading. */
export interface MenuGroup {
  /** Stable across renders. */
  id: string;
  /**
   * Drawn above the items and names the group. Absent for a run that needs no
   * heading, which is what a flat `items` list becomes.
   */
  label?: string;
  items: readonly MenuItem[];
}

export interface MenuButtonProps {
  /** Names the trigger and the menu both. */
  label: string;
  /** A flat list, for a menu that needs no sections. */
  items?: readonly MenuItem[];
  /** Sections, for one that does. Takes precedence over `items`. */
  groups?: readonly MenuGroup[];
  /** What the trigger draws. The kebab, unless a caller has a better glyph. */
  icon?: ReactNode;
  /**
   * The trigger stands for something that is currently on.
   *
   * Drawn, and only drawn. Being a menu button, the trigger cannot be a toggle
   * as well — `aria-pressed` beside `aria-haspopup` would announce a switch that
   * does not switch — so whoever sets this owes the same fact in words
   * somewhere a reader will meet it.
   */
  active?: boolean;
  /**
   * A sentence describing the trigger, read after its name.
   *
   * Where {@link active} owes its words to a reader who cannot see the drawing:
   * the name stays what the control is, and this says what state it is in.
   */
  description?: string;
  /** Extra class on the host, for a caller that has to place the menu differently. */
  className?: string;
  /**
   * Where the menu is drawn.
   *
   * `below`, the default, hangs it under the host — right for the scope bar,
   * which has the whole column beneath it. `escape` fixes it to the window at
   * the trigger's corner, measured when it opens, for a trigger inside a box
   * that clips: the rail is `overflow: hidden` all the way down, and a menu
   * wider than the rail would be cut off at its edge.
   */
  placement?: 'below' | 'escape';
  /**
   * The menu opened or shut, by whatever route.
   *
   * For a caller that treats one visit to the menu as one decision — the file
   * filters do, so that a box unticked and ticked back again has moved nothing.
   * Also said on unmount while open, so a caller cannot be left believing a
   * menu is open that no longer exists.
   */
  onOpenChange?: (open: boolean) => void;
  ref?: Ref<MenuButtonHandle>;
}

/** Clear of the window's edge, so a menu never sits flush against it. */
const MARGIN = 8;

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

export function MenuButton({
  label,
  items = [],
  groups,
  icon,
  active = false,
  description,
  className,
  placement = 'below',
  onOpenChange,
  ref,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  /** Which item the keyboard is on. Reset every time the menu opens. */
  const [at, setAt] = useState(0);

  const sections: readonly MenuGroup[] = groups ?? [{ id: 'items', items }];
  /** Every item, in the order the arrows walk them. */
  const all = sections.flatMap((section) => section.items);

  // Read by the handle and by the unmount below, which are built once.
  const live = useRef({ open, all, onOpenChange });
  live.current = { open, all, onOpenChange };

  // Opening lands the keyboard on the first item, through the same effect a
  // click on the trigger does, so the two ways in cannot behave differently.
  // Asked again while already open — a second press of the sentence that
  // opens it — it takes the keyboard back to the first item itself: the effect
  // below will not run, because nothing it depends on has moved, and leaving
  // `at` reset with focus elsewhere would put the menu's one tab stop on an
  // item the keyboard is not on.
  useImperativeHandle(
    ref,
    (): MenuButtonHandle => ({
      open() {
        setAt(0);
        if (!live.current.open) {
          setOpen(true);
          return;
        }
        const first = live.current.all[0];
        if (first !== undefined) elements.current.get(first.id)?.focus();
      },
    }),
    [],
  );

  /** What was last said to `onOpenChange`, so each change is said once. */
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current === open) return;
    announced.current = open;
    live.current.onOpenChange?.(open);
  }, [open]);
  useEffect(
    () => () => {
      if (announced.current) live.current.onOpenChange?.(false);
    },
    [],
  );
  /** Prefixes every note's id, so two menus on one page cannot describe each other. */
  const noteId = useId();

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
      // Only reclaim the keyboard if the keyboard was in here. Opening puts
      // focus on the first item, so dismissing by pointer would otherwise
      // strand it on `<body>` when the click lands somewhere unfocusable. The
      // guard matters because this runs on `pointerdown`, before the browser
      // has moved focus to whatever is being clicked — restoring
      // unconditionally would take focus off the thing the reviewer is in the
      // middle of pressing.
      const inside =
        document.activeElement instanceof Node &&
        host.current?.contains(document.activeElement) === true;
      if (inside) shut();
      else setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  // The pointer is not required: opening puts the keyboard on the first item.
  //
  // Keyed on the first item's *id*, not on `items`. Callers build that array
  // inline, so its identity changes on every render of the component holding
  // the menu — and those re-render on any session change. Depending on the
  // array meant a background resolve or viewed-toggle re-ran this while the
  // menu was open, dragging focus off whatever the reviewer had arrowed to and
  // back to the top. The id is what this effect actually reads.
  const firstId = all[0]?.id;
  useEffect(() => {
    if (!open || firstId === undefined) return;
    elements.current.get(firstId)?.focus();
  }, [open, firstId]);

  /**
   * Put an escaping menu at its trigger, inside the window.
   *
   * Before paint, so it never draws a frame at the corner of the page. Its own
   * width is only known once it is on screen, which is why this is measured
   * rather than computed: a menu wider than the room to the trigger's right is
   * slid left until it fits, and one taller than the room below scrolls.
   * Measured again if the window changes size while it is open.
   */
  useLayoutEffect(() => {
    if (!open || placement !== 'escape') return;
    const place = (): void => {
      const at = trigger.current?.getBoundingClientRect();
      const box = menu.current;
      if (at === undefined || box === null) return;
      const left = Math.max(
        MARGIN,
        Math.min(at.left, window.innerWidth - box.offsetWidth - MARGIN),
      );
      const top = at.bottom + 4;
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.maxHeight = `${Math.max(120, window.innerHeight - top - MARGIN)}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, placement]);

  const shut = (): void => {
    setOpen(false);
    // Focus is on an item that is about to stop existing. Left alone the
    // keyboard falls back to the top of the document.
    trigger.current?.focus();
  };

  const move = (to: number): void => {
    const bounded = Math.max(0, Math.min(to, all.length - 1));
    setAt(bounded);
    const item = all[bounded];
    if (item !== undefined) elements.current.get(item.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') shut();
    else if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else return;

    event.preventDefault();
  };

  // A kebab that opens onto an empty menu is a control that appears broken.
  if (all.length === 0) return null;

  /** The index across every section, which is what the keyboard counts in. */
  let index = -1;

  const renderItem = (item: MenuItem) => {
    index += 1;
    const position = index;
    const described = item.note === undefined ? undefined : `${noteId}-${item.id}`;

    return (
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
        aria-describedby={described}
        // Tab leaves a menu rather than moving inside one, so exactly one
        // item is in the sequence and the arrows do the rest.
        tabIndex={position === at ? 0 : -1}
        // `aria-disabled`, not `disabled`. A disabled element cannot take
        // focus, so arrowing onto one leaves focus where it was and takes
        // the menu's single tab stop with it — and the reason an item is
        // off is exactly what the reviewer came here to read.
        aria-disabled={item.disabled}
        title={item.title}
        onFocus={() => setAt(position)}
        onClick={() => {
          if (item.disabled === true) return;
          item.onSelect();
          if (item.keepOpen !== true) shut();
        }}
      >
        <span className="menu-item-label">
          {item.label}
          {item.detail !== undefined && <span className="menu-item-detail">{item.detail}</span>}
        </span>
        {item.note !== undefined && (
          // Hidden from the item's *name* and pointed at as its description,
          // which is read after the name and the state rather than in the
          // middle of them. `aria-describedby` still resolves a hidden node.
          <span className="menu-item-note" id={described} aria-hidden="true">
            {item.note}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={className === undefined ? 'menu-host' : `menu-host ${className}`}
      ref={host}
      // Tab is how a menu is left, and leaving has to shut it: Escape is read
      // on the menu, so once focus is outside nothing could close it but a
      // click — and the filter menu is fixed over the diff, where an orphaned
      // one covers what the reviewer tabbed on to read. Only when focus has
      // somewhere to go outside; a null target is the window losing focus, and
      // coming back to the menu still open is right.
      onBlur={(event) => {
        if (!open) return;
        const next = event.relatedTarget;
        if (!(next instanceof Node) || host.current?.contains(next) === true) return;
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="menu-trigger"
        ref={trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-describedby={description === undefined ? undefined : `${noteId}-description`}
        data-active={active ? 'true' : undefined}
        onClick={() => {
          setAt(0);
          setOpen((was) => !was);
        }}
      >
        {icon ?? <Kebab />}
      </button>

      {description !== undefined && (
        <span className="visually-hidden" id={`${noteId}-description`}>
          {description}
        </span>
      )}

      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          ref={menu}
          className="menu"
          role="menu"
          aria-label={label}
          data-placement={placement}
          onKeyDown={onKeyDown}
        >
          {sections.map((section) =>
            // An unlabelled run is drawn bare. Wrapping the commit menu's three
            // commands in a nameless group would announce a boundary with
            // nothing on the other side of it.
            section.label === undefined ? (
              section.items.map(renderItem)
            ) : (
              <div
                key={section.id}
                className="menu-group"
                role="group"
                aria-labelledby={`${noteId}-group-${section.id}`}
              >
                {/* Hidden, and still the group's name: `aria-labelledby`
                    resolves a hidden node, and left exposed the heading would
                    be a stray run of text inside a menu, read once as its own
                    line and again as the group's label. */}
                <span
                  className="menu-heading"
                  id={`${noteId}-group-${section.id}`}
                  aria-hidden="true"
                >
                  {section.label}
                </span>
                {section.items.map(renderItem)}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
