# Setting up team collaboration for JAIN-E (Git + GitHub)

## What's already done

This folder is now a Git repository with one commit capturing today's code as a baseline (`Initial commit: baseline snapshot of JAIN-E before Git-based collaboration`). Nothing changes about how the app works — this just gives every future change a history, and gives multiple people a way to combine their work safely.

The rest of the setup below has to happen in your GitHub account and on each teammate's computer, so it's written as a checklist for you and your team.

## Step 1 — Create a GitHub account and organization

1. Go to [github.com/join](https://github.com/join) and create an account using a Jain Group email (e.g. digitalmarketing@thejaingroup.com).
2. Once logged in, create an **Organization** (Settings → "New organization", or [github.com/account/organizations/new](https://github.com/account/organizations/new)). Free plan is enough. Name it something like `jain-group`.
3. Creating an organization (rather than a personal account) means the project is owned by the company, not one person — if someone leaves, access is still controlled centrally.

## Step 2 — Create the repository and push this code

1. Inside the organization, click **New repository**. Name it `nexus-re` (or similar). **Set it to Private** — this codebase has your Supabase project URL and public API key embedded, and while that specific key is the "publishable" key (safe to expose — real protection comes from Supabase's row-level security, not key secrecy), there's no reason to make the repo public.
2. Do **not** initialize it with a README/.gitignore on GitHub's side (this folder already has both).
3. GitHub will show you a remote URL like `https://github.com/jain-group/nexus-re.git`. From this same folder, someone (you, or ask me) runs:
   ```
   git remote add origin https://github.com/jain-group/nexus-re.git
   git push -u origin main
   ```
4. You'll be prompted to sign in — GitHub will walk you through it (usually a browser popup, or a personal access token if using the command line directly).

## Step 3 — Invite your team

In the repository → **Settings → Collaborators and teams**, invite each person by their GitHub username or email. They'll get an email invite to accept.

## Step 4 — How each person works day to day

Each teammate needs Git installed on their computer (free, one-time install: [git-scm.com](https://git-scm.com)) and to clone the repo once:
```
git clone https://github.com/jain-group/nexus-re.git
```
This creates their own local copy of the project — the same as the folder you've been working in with me, just tied to GitHub.

From there, each person points their own Claude/Cowork session at their own cloned folder and works exactly like we have been. When they're ready to share their changes:
```
git add -A
git commit -m "short description of what changed"
git pull origin main
git push origin main
```
The `git pull` before pushing is what merges everyone else's changes into theirs automatically. If two people changed the *same lines* of the *same file*, Git will flag a conflict and ask that person to pick which version wins (or combine both) before the push can complete — this is normal and expected occasionally, not a sign anything is broken.

**Tip:** for anything bigger than a quick fix, it's safer to work on a separate branch (`git checkout -b my-feature`) and open a **pull request** on GitHub rather than pushing straight to `main` — that gives everyone a chance to see the change before it merges. Optional, but worth adopting once the team grows past 2–3 people.

## Where to edit code (important)

Two kinds of files are now **generated** and must not be edited by hand:

| Generated file | Edit this instead |
|---|---|
| `nexus-core.js` | the part in `src/core/` — one file per section (`04-auth.js`, `05-nav.js`, `10-tasks.js`, `27-customer-portal.js`, …), joined in file-name order |
| the 43 app pages (`crm.html`, `accountability.html`, `index.html`, …) | `src/pages/shell.html` (the one page skeleton: head, sidebar, top bar) or `src/pages/pages.json` (what differs per page: title, page id, extra scripts) |

After editing, run:

```
node tools/build.mjs
```

It rebuilds those files and stamps every script and stylesheet link with a version taken from the file's content, so browsers always pick up a changed file (no more typing `?v=` numbers by hand). If someone has edited a generated file directly, the build stops and names the file instead of overwriting their change — move the edit into `src/` and run it again. `node tools/build.mjs --check` only reports whether anything is out of date.

Pages that are not the app shell — `login.html`, `signup.html`, `reset-password.html`, `vendor-quote.html` and the like — and the other scripts (`accountability.js`, `postsales.js`, …) are still edited directly as before.

## Deploying to Netlify

You asked to keep this manual for now, so nothing changes here: whoever is deploying should first run `git pull origin main` in their local copy to make sure they have everyone's latest merged changes, then run `node tools/build.mjs`, then redeploy exactly as before.

If this ever becomes annoying, Netlify can be connected directly to the GitHub repo so every push to `main` deploys automatically — just say the word and we'll wire that up later.

## One caution

Never commit real secrets (Supabase **service role** key, Gmail app password, etc.) into this repo — those already live safely in Supabase's own secret storage for the edge functions and should stay there, not in these files. The `SUPABASE_KEY` already in `nexus-core.js` is the public/publishable key, which is fine to have in the repo.
