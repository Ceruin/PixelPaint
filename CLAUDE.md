# PixelPaint

Browser art studio (Draw, Notes, Sprite Studio, Pyxl the mascot). Plain ES modules, no build step.
This repo is public and is the live site: keep personal information out of it (the feedback
address in the app is the only contact detail that belongs here).

## Every change: version + release notes

Do these in order on every change that users can see, in the same commit:

1. Bump `VERSION` in `js/version.js` (`YYYY.MM.DD.N`).
   Check: `git diff js/version.js` shows one changed line.
2. Add the change to `js/releaseNotes.js` (Help > Release Notes reads it). Newest entry first,
   one entry per day (`YYYY.MM.DD`): add to today's entry if it exists, else start a new one.
   One short line per change, in words a user would use, no code or file names:
   `+` for something new, `-` for something fixed or removed.
   Check: read the line back as a user who has never seen the code. Would they know what changed?
3. Commit to main and push.
   Check: `git status -sb` shows nothing ahead of `origin/main`.

Internal-only changes (refactors, docs, tools/) need no release note.

## Editing

- Most files are CRLF. Never `sed -i` them (it strips the CRs); edit in place or with node.
  Check: `file <path>` still reports the endings it had before.
