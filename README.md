# Garment Designer — Demo Deploy

This is a standalone copy of the garment designer prototype, ready to push to
GitHub and deploy on Render so you can share a real public link for trial
feedback. It's separate from the main `ai-brain` repo on purpose — this way
none of your other business files get pushed anywhere public.

## Test it locally first (optional)

```
python server.py
```
Then open http://localhost:5057 — should behave exactly like it did in the
ai-brain folder.

## Step 1 — Push this to a new GitHub repo

1. Go to [github.com/new](https://github.com/new) and create a new repository.
   - Name it whatever you like, e.g. `garment-designer-demo`
   - Leave it **empty** (no README/gitignore/license — this folder already has those)
   - Private or public both work fine for the next step
2. Copy the commands GitHub shows you under "…or push an existing repository
   from the command line" — they'll look like this (yours will have your
   actual GitHub username/repo name):

```bash
cd "C:\Users\bradj\garment-designer-deploy"
git init
git add .
git commit -m "Garment designer demo"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/garment-designer-demo.git
git push -u origin main
```

(If `git init`/`add`/`commit` already ran — check with `git status` first —
just do the `remote add` and `push` lines.)

## Step 2 — Deploy on Render

1. Go to [render.com](https://render.com) and sign up (free — email or GitHub login, no card needed)
2. Click **New +** → **Web Service**
3. Connect your GitHub account, then select the `garment-designer-demo` repo you just pushed
4. Render should auto-detect the `render.yaml` in this repo and pre-fill everything (Python, free plan, start command). If it asks anyway:
   - **Runtime:** Python 3
   - **Build Command:** (leave blank or `true`)
   - **Start Command:** `python server.py`
   - **Plan:** Free
5. Before clicking "Create Web Service", add the environment variable it asks for:
   - **Key:** `OPENAI_API_KEY`
   - **Value:** (paste your key — the same one in this folder's `.env` file, which is NOT pushed to GitHub)
6. Click **Create Web Service**. First deploy takes a couple of minutes.
7. You'll get a URL like `https://garment-designer-demo.onrender.com` — that's your shareable link.

## Notes

- **Free tier sleeps after inactivity** — the first request after a quiet
  period takes ~30-60 seconds to wake up. Fine for a trial; upgrade later if
  it needs to stay always-on.
- **No login/rate-limit on the image endpoints** — anyone with the link can
  generate images against your OpenAI billing. Fine for a small trusted
  trial group (per your call); worth adding a simple access code if the
  link spreads further than intended.
- **To update the demo later:** make changes in the main `ai-brain/garment-designer-prototype` folder as usual, then copy the 4 changed files (`index.html`, `app.js`, `style.css`, `server.py`) into this folder, commit, and `git push` — Render redeploys automatically on every push.
