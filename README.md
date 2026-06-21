# swayam.dev

A minimal personal blog and project log, built with [Astro](https://astro.build).

## Stack

- **Astro** (static output, content collections for blog posts)
- **MDX** support for posts that need embedded components
- Plain CSS with custom properties — no Tailwind, no component library
- Fonts: Schibsted Grotesk (display), Inter (body), IBM Plex Mono (meta/code)

## Structure

```
src/
  content/
    blog/            ← posts as .md / .mdx, one file per post
    config.ts         ← content collection schema (title, description, date, tags)
  components/
    Header.astro
    Footer.astro
    PostRow.astro      ← single row in any post list
  layouts/
    BaseLayout.astro   ← <head>, fonts, header/footer shell
  pages/
    index.astro         ← homepage (hero, featured, recent)
    blog/
      index.astro        ← all posts, grouped by year
      [...slug].astro    ← individual post page
      tags/
        index.astro       ← all tags
        [tag].astro        ← posts for one tag
    projects/
      index.astro          ← project/lab listing
  styles/
    global.css            ← design tokens + base styles
public/
  favicon.svg
```

## Writing a post

Add a new file to `src/content/blog/`, e.g. `src/content/blog/my-new-post.md`:

```md
---
title: "Post Title"
description: "One sentence used in listings and social previews."
date: 2026-06-21
tags: ["backend", "go"]
---

Post content in Markdown (or MDX if the file ends in `.mdx`).
```

The filename becomes the URL slug: `/blog/my-new-post`.

## Local development

```bash
npm install
npm run dev       # http://localhost:4321
npm run build      # outputs to ./dist
npm run preview     # serve the production build locally
```

## Before you make it yours

- Swap the placeholder `https://github.com` / `https://linkedin.com` links in
  `src/components/Header.astro`, `src/components/Footer.astro`, and
  `src/pages/index.astro` for your real profiles.
- Update `site` in `astro.config.mjs` to your real domain.
- Replace the sample posts in `src/content/blog/` and the project list in
  `src/pages/projects/index.astro` with your own.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel, "Add New Project" → import the repo.
3. Framework preset: **Astro** (auto-detected). No extra config needed —
   it's a static build (`npm run build`, output directory `dist`).
4. Add your custom domain under Project → Settings → Domains once it's live.
