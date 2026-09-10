/**
 * The notice for a pull request this account can read but not write to.
 *
 * It exists because the symptom is much quieter than the cause. GitHub reports
 * the refusal one control at a time — a greyed-out *Resolve conversation* with
 * "you do not have permission to do this" on its tooltip, a *Start a review*
 * button that is simply not there — and a reviewer meeting those one by one
 * concludes the extension is broken rather than that their access is. Nothing
 * on the page connected them, and the tooltip is invisible to anyone not using
 * a mouse.
 *
 * So the explanation is given once, at the level it is actually true at: this
 * repository, this token, everything that writes.
 *
 * Not a full-page state, for the same reason `TokenRejectedNotice` is not. Read
 * access is enough to read the diff, which is most of what this page is for —
 * and someone reviewing on GitHub in the other tab still wants this one.
 *
 * The two causes are given in the order they are worth checking. A token
 * narrower than the account is the fixable one and by far the commoner: the
 * options page asks for *Pull requests: Read and write*, and a token made in a
 * hurry, or made before a repository was added to it, has neither.
 */

import { openOptions } from './openOptions';

export function ReadOnlyNotice({ href }: { href: string | null }) {
  return (
    <aside className="notice-body" role="status">
      <p>
        GitHub reports this account as read-only on this repository, so nothing
        can be posted, resolved or marked as viewed here. Reading the pull
        request is unaffected.
      </p>
      {/* Not `.notice-detail`, which is the stacked monospace block `DeniedNotice`
          uses for GitHub's raw error lines. This is prose and has to read as
          prose — quieter than the sentence above it, but a paragraph. */}
      <p className="notice-more">
        Two things cause this. Your token may be narrower than your account —
        it needs this repository under <strong>Repository access</strong> and{' '}
        <strong>Pull requests: Read and write</strong>, and an organisation
        owner may still have to approve it. Or your account really does have
        read access to this repository, in which case the token cannot help and
        the change has to be asked for.
      </p>
      <div className="notice-actions">
        <button type="button" className="button primary" onClick={openOptions}>
          Check your token
        </button>
        {href !== null && (
          <a className="button" href={href}>
            Open on GitHub
          </a>
        )}
      </div>
    </aside>
  );
}
