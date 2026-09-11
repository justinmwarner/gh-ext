# Product

## Register

product

## Users

Working developers reviewing their team's pull requests. Review is a regular
part of the week rather than the whole job: they are not full-time reviewers,
they are people with their own branch waiting who have been asked to look at
someone else's.

Their context is a browser tab opened from a Slack message or a notification
email, often between two other tasks. They already know the codebase. What they
do not have is patience for GitHub's review interface, which makes them scroll,
click and wait for a job whose actual content is a handful of repeated actions:
read a hunk, leave a comment, reply to one, resolve one, mark a file viewed,
approve.

The job to be done is finish the review without losing the thread of what they
were doing before it. Every second of load time and every extra click is taken
out of the attention they have left for the code.

## Product Purpose

A Better Reviewer replaces GitHub's pull request review interface with a faster
one that covers the actions reviewers perform constantly and deliberately
nothing else. It ships as a browser extension with no server and no account: the
reviewer supplies a fine-grained personal access token scoped to the repositories
they choose, and the extension talks directly to GitHub from their machine.

It has three surfaces:

1. **The injected card** on github.com pull request pages. The entry point, and
   the only part a reviewer sees before opting in. It can collapse to a pill.
2. **The review page**, a standalone extension page built on Pierre's diff and
   file-tree components. Where the work happens.
3. **The options page**, where the token is set up and the review destination is
   chosen. The first screen a new reviewer meets.

Success is a reviewer who stops noticing the extension: it opens fast, the
keyboard does what they expect, nothing they typed is lost, and they never have
to ask where they are. Failure is a reviewer who has to go back to github.com to
finish, or who cannot tell whether their comment was posted.

## Brand Personality

**Precise, quiet, fast.**

- **Precise.** Says exactly what happened. When status checks are incomplete
  because the token lacks a grant, the top bar names what it could not show
  rather than presenting a shorter list as if it were the whole one. Numbers,
  states and errors are specific.
- **Quiet.** Never asks for attention it has not earned. It injects one card
  into someone else's page and that card can be collapsed. No badges, no tours,
  no announcements. Chrome recedes so the diff is the loudest thing on screen.
- **Fast.** Speed is not a quality attribute here, it is the product. The whole
  reason to use this instead of GitHub is that it opens quicker and responds
  quicker. Anything that costs perceptible time has to earn it against that.

Voice: plain declarative sentences, no exclamation marks, no emoji in UI copy.
Button labels are verb plus object. Errors say what failed and what to do, not
that something went wrong.

## Anti-references

- **A second GitHub with everything in it.** Feature parity is not the goal and
  pursuing it would destroy the reason the thing exists. Anything out of scope
  hands off through Open in GitHub. Adding a feature is a decision to be argued
  for, not a default.
- **A SaaS-looking developer tool.** No gradient hero, no metric tiles, no
  purple-to-blue accent, no illustrated empty states, no product tour. The
  visual language of a tool that is being sold is wrong for a tool that is being
  used.
- **Chatty or cute.** No emoji in interface copy, no exclamation marks, no
  "Oops! Something went wrong." A reviewer hitting an error wants the cause.

## Design Principles

**1. Native, not novel.** The extension deliberately wears GitHub's palette so
there is zero visual context switch between the pull request page and the review
page. A reviewer moving from one to the other should not have to re-orient. This
is a strategic choice, not a side effect of the Pierre components: identity comes
from speed and behaviour, not from colour. New surfaces adopt the same palette.
The injected card is the one licensed exception, because it has to read as not
part of GitHub while sitting inside GitHub.

**2. Do less, completely.** A short list of actions, each finished properly,
beats a long list each done to eighty percent. Every feature already present
earns its place by being something reviewers do repeatedly. The escape hatch is
the design: because Open in GitHub always works, saying no to a feature costs
the reviewer very little.

**3. Speed is the budget.** Treat load and response time as a resource that
every change spends from. A change that makes the page slower has to be worth
more than the speed it costs, and usually is not. This is what the reviewer came
for.

**4. Nothing fails silently.** If something could not load, say which thing. If a
post failed, keep what was typed. If the head moved under the review, surface it.
The failure modes here involve someone's written work and someone else's code, so
degrading quietly is worse than degrading loudly.

**5. One product, three surfaces.** The card, the review page and the options
page are one thing and should be indistinguishable in materials: same palette,
same type, same radii, same motion timings, same words for the same concepts. A
reviewer arriving at the options page from a dark review page should not notice
a seam.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA**.

- **Contrast.** Body text at 4.5:1 minimum, large text at 3:1. This is already
  treated as a real constraint rather than a checkbox: Pierre's own addition
  green measures 2.47:1 on white and is overridden for that reason.
- **Full keyboard operability, no exceptions.** Keyboard navigation is a headline
  feature, so a keyboard gap is a product bug rather than an accessibility
  footnote. Every interactive element reachable, every dialog escapable, no
  traps. *Known gap: a new line comment cannot be started from the keyboard.
  The `c` shortcut needs a line selection, and a selection can only be made by
  pointer, so the shortcut the help overlay advertises can only produce an
  error for a keyboard-only reviewer.*
- **Reduced motion.** Every transition needs a `prefers-reduced-motion: reduce`
  alternative, normally a crossfade or an instant change.
- **Never colour alone.** Added, removed and modified must be readable without
  hue. This matters more here than in most products: a diff tool that encodes its
  primary signal in red and green is unusable for the most common form of colour
  vision deficiency. Signs, symbols, position and text carry the meaning; colour
  reinforces it.
- **The syntax palette belongs to the reviewer.** The diff's code colours are a
  setting, not a decision this product gets to make for everybody. The list
  includes high-contrast themes and four built for colour vision deficiency, and
  those are offered first. Choosing any of them also releases the Primer red and
  green this page otherwise paints onto added and removed lines, because keeping
  them would undo the thing the theme was chosen to do. The default is left to
  the diff library, so an install that never opens the options page is unchanged.
- **Reflow.** Usable at 200% zoom and at narrow window widths without horizontal
  scrolling, since the review page is routinely opened in a half-screen window on
  a second monitor.

The extension collects nothing, sends nothing to its developer, and talks to
github.com and api.github.com and nowhere else. Privacy is treated as part of
inclusion, not as a separate compliance exercise.
