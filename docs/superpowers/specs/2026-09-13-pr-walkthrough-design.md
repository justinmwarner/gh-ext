# The PR Walkthrough — Design

**Date:** 2026-09-13
**Status:** Designed, not implemented
**Register:** product

## Goal

A button on the review page that turns a pull request into an ordered sequence
of **virtual commits** — each one a set of hunks with a title and a reason —
underneath a short prose summary that acts as the map. The reviewer walks the
change in the order it makes sense in, rather than the order it was written in
or the order the file tree happens to fall in.

The sequence is produced by Claude Code running on the reviewer's own machine,
reached over a local bridge and driven by a button in the extension. It explains
and it points; it does not judge. A step may say "look hard here, because this
changes the locking order". No step says the code is wrong.

---

## Part 0: The argument this feature has to win

PRODUCT.md says the extension "collects nothing, sends nothing to its developer,
and talks to github.com and api.github.com and nowhere else". `wxt.config.ts`
backs that with `data_collection_permissions: { required: ['none'] }` for
Firefox and matching Chrome Web Store disclosures. This feature breaks that
sentence. Even the local route breaks it, because the diff reaches Anthropic by
way of a process on the machine, and a reviewer reading that sentence would not
consider "we sent it to a program you installed, which sent it on" a technicality.

Three things keep it inside the product rather than outside it.

**It is off, and absent, unless the reviewer installs a second thing.** The
button does not exist until a bridge is detected. A store install that never
installs the bridge is byte-for-byte the product PRODUCT.md describes, and the
permission it would need is `optional_host_permissions`, so a default install's
warning screen is unchanged.

**It is explanation, not review.** Principle 2 is "do less, completely", and the
anti-reference is "a second GitHub with everything in it". A walkthrough that
finds bugs is a different product with a different failure mode — a confident
wrong finding costs the reviewer a wild goose chase and some credibility with
the author. Explanation fails cheaply: a wrong sentence about why a hunk exists
costs a few seconds and is obvious on contact with the code.

**The disclosures change honestly, or the feature does not ship.** The Firefox
data collection declaration and the store listing both have to say what happens.
That is work, and it is not optional.

Principle 3 — speed is the budget — is the one this feature cannot satisfy and
must therefore pay for differently. An agentic run is slow. See §2.2.

---

## Part 1: What is actually possible

### An extension has exactly three ways out of the sandbox

An extension cannot spawn a process. Everything else follows from that.

| Route | Mechanism | Cost |
|---|---|---|
| Native messaging | `chrome.runtime.connectNative()` to an OS-registered host | `nativeMessaging` permission and its install warning; a per-OS installer; **1 MB cap on a single extension→host message** |
| Local HTTP/WS | `fetch` to `127.0.0.1` | A host permission; CORS; a daemon the user starts |
| Nothing else | — | — |

**Chosen: local HTTP.** It needs no extra permission warning beyond an optional
host permission, has no message-size cap, behaves identically on Chrome and
Firefox, and can be driven with `curl` during development. Native messaging's
one advantage — no port, no CORS — is bought with an installer that has to write
a registry key on Windows and a plist path on macOS, and with a manifest whose
`allowed_origins` is keyed on extension ID. That last point is a concrete
problem here: `wxt.config.ts` pins `kpjeagilmchpoganlnllmhloplapcnoj` for
unpacked installs and deliberately omits the key for the store build, which gets
a different ID. A native host manifest would have to list both, and the store ID
is not known until after publication.

The 1 MB cap turns out not to matter either way, because of §2.2.

### The daemon cannot ship inside the extension

This is a technical wall before it is a policy one. An extension package is
HTML, CSS, JS, WASM and assets; there is no filesystem API to extract a bundled
binary and no API to execute one. A `.exe` zipped into the package is an inert
file. On top of that both stores prohibit shipping executables, and AMO's human
review would reject it.

What is allowed, and is what every comparable product does — 1Password,
KeePassXC, browserpass, Zotero Connector — is to ship the companion separately
and link to it. The options page gets a row that says *detected* or *not
detected, here is the command*, which is the same thing the token row already
does for a different missing credential.

---

## Part 2: Design

### 2.1 Three modules and one boundary

**`bridge/`** — a separate npm package, built and published independently of the
extension and never present in `.output/`. A Node HTTP server bound to
`127.0.0.1`, driving `@anthropic-ai/claude-agent-sdk`'s `query()`. It is
deliberately not in the extension's dependency tree.

**`lib/walkthrough/`** — pure, per the `lib/` rule in CLAUDE.md. The request
shape, the response schema and its parser, the slice resolver, and the staleness
predicate. No DOM, no `chrome.*`, no transport, so all of it tests under Node in
milliseconds.

**One adapter in `entrypoints/background.ts`** — the only code that knows about
`fetch`, the shared secret, and `chrome.permissions`. It sits beside the two
adapters CLAUDE.md already excepts from the purity rule.

### 2.2 The wire, and why it carries almost nothing

The extension sends coordinates, not content:

```
POST http://127.0.0.1:<port>/walkthrough
Authorization: Bearer <secret>
{ "owner": "…", "repo": "…", "number": 123, "headRefOid": "abc1234" }
```

Claude Code then uses `gh` to fetch whatever it needs — the diff, the changed
files at head, the description, the linked issue. Four consequences, all good:

- **No token crosses the bridge.** Claude Code authenticates as the reviewer's
  own `gh`. The extension's fine-grained PAT stays in the vault and is never
  handed to another process.
- **No payload size problem.** The request is a few hundred bytes, which is why
  native messaging's 1 MB cap turns out to be irrelevant.
- **No local clone required.** `gh` reads from the API, so the bridge works for
  any pull request the reviewer's `gh` can see, on a machine that has never
  cloned the repository.
- **The extension does not have to decide what is relevant.** An agent that can
  ask follow-up questions of the API beats a fixed payload assembled in advance.

The response is **Server-Sent Events**: `progress` events, then exactly one
`result`. An agentic run that shells out to `gh` several times is slow — the
working assumption is 60 to 120 seconds, and it has not been measured. Speed is
the budget and this feature cannot pay it, so it pays in legibility instead:
"reading 14 changed files" is a different experience from a spinner, and it is
the same instinct as naming which status checks the token could not show.

### 2.3 The schema is the contract

```ts
interface Walkthrough {
  /** The head the sequence was written against. Half of every cache key. */
  headRefOid: string;
  /** The map. Markdown, two to four short paragraphs. */
  summary: string;
  steps: Step[];
}

interface Step {
  id: string;
  /** Verb plus object, per the voice in PRODUCT.md. */
  title: string;
  /** Why this change, and why here in the order. */
  rationale: string;
  /** "Look hard here, because …". Null when there is nothing to say. */
  attention: string | null;
  slices: Slice[];
}

interface Slice {
  path: string;
  /** Head-side line numbers, inclusive. See §2.4. */
  startLine: number;
  endLine: number;
}
```

An agent left free to run tools will return an essay. The bridge must pin this
shape — a required final structured call, or a known file the bridge reads back
— or there is nothing to render.

`attention` being nullable is load-bearing. A model asked for a warning on every
step will invent one, and six invented warnings teach the reviewer to skip the
field. Null must be the cheap answer.

### 2.4 Head side only, which is the decision everything else rests on

A virtual commit is a **subset of the pull request's own head diff**. It is not
a diff between two commits.

`lib/review/diffScope.ts` spends its opening comment on why that distinction
matters: a review thread's `line` is a position in the *pull request's* diff, and
a narrowed diff numbers its lines against its own base and head, so line 42 there
is very likely to exist and very likely to be the wrong text. That is why
`AnchorableSides` exists and why `ui/composerAnchor.ts` refuses to place a
composer on a side it cannot trust.

Because a virtual commit reuses the whole-PR diff and only hides parts of it, its
line numbers *are* the pull request's line numbers. `AnchorableSides` stays
`BOTH_SIDES`. **Commenting works normally inside a step** — which a real commit
range structurally cannot offer. This is the strongest argument for virtual
commits over "show me commit 3 of 7", and it falls out of the representation
rather than being engineered in.

Slices therefore address the head side only. A step that is purely deletions is
addressed by the hunk that contains them, not by base-side line numbers.

### 2.5 Where it plugs into the existing scope mechanism

`DiffScope` gains a fourth kind:

```ts
| { kind: 'step'; stepId: string }
```

It resolves to **the same commit pair as `whole`**, with a file-and-hunk filter
applied on top. That is the whole trick: no new compare request, no new line
numbering, no new anchoring rules — one more way to narrow what is drawn from a
diff that has already been fetched and parsed.

`ui/ScopeBar.tsx` is already a permanent row that says what is on screen, and
already handles three scopes. It gains a step indicator: `Step 2 of 6 · Move the
retry budget into the client`. Next and previous step take two currently unbound
keys, added to `SHORTCUTS` in `lib/keymap.ts` so the help overlay picks them up
without a second copy.

The summary renders above the diff column when a walkthrough is active, with its
paragraphs linking into steps. It collapses, and its collapsed state is
remembered the way the card's is.

### 2.6 Resolution, and the silent failure it exists to prevent

`lib/walkthrough/resolve.ts` takes the slices and the parsed diff and returns
resolved hunks **or a named failure**. Three rejections:

- a `path` that is not in the diff at all
- a line range that overlaps no hunk in that file
- a step whose slices all fail, leaving nothing to show

`docs/reference/pierre-diffs-api.md` records that Pierre **drops an annotation
outside a rendered hunk silently**. That is precisely the failure mode here: a
step citing lines that are not in the diff does not raise, it just renders short,
and a reviewer has no way to tell a three-location step from a five-location step
that lost two. So the step header says `2 of 5 locations could not be placed`,
and the count is part of the resolved value rather than a log line. This is
principle 4 and a documented library behaviour landing in the same function.

### 2.7 Storage and staleness

`chrome.storage.local`, keyed `walkthrough:{owner}/{repo}#{number}@{headRefOid}`
— the same shape as the existing per-head cache keys. One walkthrough per head.

Generation is manual and never automatic. It costs real time and real money, and
principle 3 forbids spending either on a page load.

When the head moves the walkthrough is marked **stale, not deleted**. The
reviewer keeps what they were reading and the bar says which commit it was
written against: `Generated against abc1234 · head is now def5678`. `Regenerate`
is a button, not a consequence. `ui/HeadMovedNotice.tsx` already exists for the
neighbouring case and is the model for the wording.

### 2.8 Permissions

`optional_host_permissions`, requested from a user gesture on the options page,
never from the service worker.

**Chrome match patterns are believed to carry no port**, in which case
`http://127.0.0.1/*` grants every local port rather than the one the bridge
uses. The options-page copy has to say
that accurately — "this extension will be able to talk to local servers on your
machine" — rather than implying a narrower grant than the browser actually
issues. Verify the exact pattern accepted by both browsers before writing that
sentence; see Open questions.

The bridge binds to `127.0.0.1` and requires a bearer secret that the reviewer
pastes into the options page. Without it, any page open in the browser can drive
the bridge. The secret is stored the way the token is. An `Authorization` header
makes the request non-simple, so the bridge must answer the `OPTIONS` preflight
with `Access-Control-Allow-Origin` for the `chrome-extension://` origin.

Claude Code runs with `--allowedTools` limited to `gh` plus read-only file
access, and a permission mode that does not block — a headless bridge that stops
for an approval prompt deadlocks on the first tool call.

---

## Module layout

| Module | Purpose | Pure |
|---|---|---|
| `lib/walkthrough/types.ts` | `Walkthrough`, `Step`, `Slice`, `WalkthroughRequest` | yes |
| `lib/walkthrough/parse.ts` | Untrusted JSON → `Walkthrough` or a named rejection | yes |
| `lib/walkthrough/resolve.ts` | Slices + `ParsedDiffFile[]` → hunks, with an unplaced count | yes |
| `lib/walkthrough/staleness.ts` | Stored `headRefOid` vs. payload head | yes |
| `lib/review/diffScope.ts` | Gains `{ kind: 'step' }` | yes |
| `lib/keymap.ts` | Two bindings | yes |
| `lib/messages.ts` | Request and response shapes for the worker protocol | yes |
| `entrypoints/background.ts` | `fetch` to the bridge, SSE, secret, permissions | no |
| `ui/WalkthroughSummary.tsx` | The map | — |
| `ui/StepRail.tsx` | The sequence, and where you are in it | — |
| `ui/ScopeBar.tsx` | Step indicator | — |
| `bridge/` | Separate package. Not in the extension build. | — |

---

## Failure modes

Seven conditions, seven sentences. Principle 4 is that if something could not
load, you say which thing.

| Condition | What the reviewer is told |
|---|---|
| No bridge on the port | The bridge is not running, with the start command. (Package name undecided.) |
| Bridge answers, secret rejected | The bridge rejected the secret. Check it on the options page. |
| Bridge running, `gh` not installed | The bridge could not find `gh`. |
| `gh` present, not authenticated | `gh` is not signed in. Run `gh auth login`. |
| `gh` signed in, no access to this repository | `gh` is signed in as *name*, which cannot see this repository. |
| Result does not parse | The walkthrough could not be read. Nothing was changed. |
| Result parses, slices do not resolve | Rendered, with the unplaced count per step. |

The fourth and fifth are distinct from a failure of the extension's own token,
and must not be reported in the same words. Two credentials, two vocabularies.

---

## Testing

Everything in `lib/walkthrough/` runs under the Node project: parse rejections
against malformed payloads, slice resolution against fixture `ParsedDiffFile`s
including the three rejection cases, staleness against a moved head.

`DiffScope`'s fourth kind gets the same treatment as the existing three,
including the assertion that a step scope reports `BOTH_SIDES` — that is the
property §2.4 is built on and it should fail loudly if someone later resolves a
step through a compare request.

The bridge is mocked at the service worker in the e2e suite, the way GitHub
traffic already is. The e2e case that matters is the SSE stream: progress
events, one result, and a render. A bridge that never answers is a second case.

---

## Rejected alternatives

**An API-key tier for store users.** Considered and deferred. Once the bridge is
agentic with `gh`, a one-shot Messages API call over a payload the extension
assembles is not a lesser grade of the same feature — it is a different feature
sharing an output schema, with a second prompt surface and a second failure
vocabulary, producing visibly worse output from the same button. Build one good
thing first and learn whether the walkthrough is worth having.

**Native messaging.** See §1. The extension-ID problem and the per-OS installer
buy nothing once the payload is four hundred bytes.

**Shipping the bridge in the extension package.** Impossible, not merely
disallowed. See §1.

**Sending the diff to the bridge.** The extension already has the parsed diff and
could hand it over, which would remove the `gh` dependency. Rejected because it
puts a ceiling on what the agent can look at — the description, the linked issue,
a file that was not changed but explains why one was — and because it would mean
either sending the extension's token or making the bridge fetch anyway.

**Verdicts.** See Part 0.

**Auto-generating on open.** See §2.7.

---

## Not doing

- No API-key path. No walkthrough without a bridge.
- No findings, no severities, no "possible bug".
- Nothing is posted to GitHub. The walkthrough is not a review comment.
- No generation without a button press.
- No sharing between reviewers. There is no server; a walkthrough is local to
  one machine and one head.

---

## Open questions — verify before implementing

1. **The Agent SDK's structured-output mechanism.** `@anthropic-ai/claude-agent-sdk`
   is a different product from the Anthropic API SDK and its bindings must be
   read from `code.claude.com/docs/en/agent-sdk` rather than recalled. How it
   pins a final JSON shape decides whether §2.3 is a schema or a hope.
2. **`optional_host_permissions` with a localhost pattern**, on Chrome and on
   Firefox, and whether the port is really ignored. The options-page copy in
   §2.8 depends on the answer and must not overstate how narrow the grant is.
3. **Wall-clock for a real run.** 60–120 seconds is an assumption. If it is
   closer to five minutes the surface in §2.5 is wrong — a five-minute wait needs
   to be leaveable and returnable, not a progress line.
4. **Whether `gh` is a safe assumption** alongside Claude Code, now that Claude
   Code ships as a native binary rather than an npm package. The bridge checks at
   startup either way.
5. **Two unbound keys.** `SHORTCUTS` has to be read before choosing, not after.
