<script setup lang="ts">
const demoVideoUrl = 'https://github.com/user-attachments/assets/3553d66b-7a10-4a68-9e22-307517186350'

const features = [
  {
    title: 'Commit timeline',
    text: 'Read history with messages, hashes, dates, graph lanes, and author context together.',
  },
  {
    title: 'Contributor focus',
    text: 'Filter the timeline by author and open a clean Top 3 contribution ranking.',
  },
  {
    title: 'Working tree actions',
    text: 'Review uncommitted files, select exact paths, write a message, commit, and push.',
  },
]

const downloads = [
  {
    label: 'Linux AppImage',
    meta: 'Portable desktop build',
    href: 'https://github.com/noirlang/differ/releases/latest',
  },
  {
    label: 'Source code',
    meta: 'GPL-3.0-or-later',
    href: 'https://github.com/noirlang/differ',
  },
]
</script>

<template>
  <div class="site-shell">
    <header class="site-header" aria-label="Site navigation">
      <a class="brand" href="#top" aria-label="differ home">
        <img src="/differ-logo.svg" alt="" />
        <span>differ</span>
      </a>

      <nav class="nav-links" aria-label="Primary navigation">
        <a href="#features">Features</a>
        <a href="#download">Download</a>
        <a href="https://github.com/noirlang/differ" rel="noreferrer">GitHub</a>
      </nav>
    </header>

    <main id="top">
      <section class="hero-section" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">Git change explorer</p>
          <h1 id="hero-title">A cleaner way to read what changed.</h1>
          <p class="hero-text">
            differ brings commit history, contributors, changed files, working tree state, and push status into one focused desktop workspace.
          </p>
          <div class="hero-actions">
            <a class="button primary" href="#download">Download</a>
            <a class="button secondary" href="https://github.com/noirlang/differ" rel="noreferrer">View source</a>
          </div>
        </div>

        <div class="hero-media" aria-label="differ demo video">
          <video controls playsinline preload="metadata" poster="/video-poster.svg">
            <source :src="demoVideoUrl" type="video/mp4" />
          </video>
        </div>
      </section>

      <section class="feature-strip" aria-label="Product metrics">
        <div>
          <strong>Timeline</strong>
          <span>Commit graph and diff context</span>
        </div>
        <div>
          <strong>Contributors</strong>
          <span>Author filtering and ranking</span>
        </div>
        <div>
          <strong>Workspace</strong>
          <span>Commit and push selected files</span>
        </div>
      </section>

      <section id="features" class="section-block" aria-labelledby="features-title">
        <div class="section-heading">
          <p class="eyebrow">Features</p>
          <h2 id="features-title">Everything needed for a focused Git review.</h2>
        </div>

        <div class="feature-grid">
          <article v-for="feature in features" :key="feature.title" class="feature-card">
            <span aria-hidden="true"></span>
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.text }}</p>
          </article>
        </div>
      </section>

      <section id="download" class="download-section" aria-labelledby="download-title">
        <div>
          <p class="eyebrow">Download</p>
          <h2 id="download-title">Get differ for your desktop.</h2>
          <p>
            Start with the Linux AppImage build or inspect the GPL source from GitHub.
          </p>
        </div>

        <div class="download-list">
          <a v-for="item in downloads" :key="item.label" class="download-item" :href="item.href" rel="noreferrer">
            <span>
              <strong>{{ item.label }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <i aria-hidden="true">↗</i>
          </a>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <a class="company-mark" href="https://github.com/noirlang" rel="noreferrer" aria-label="noirLang on GitHub">
        <img src="https://github.com/noirlang.png?size=160" alt="" />
        <span>noirLang</span>
      </a>
    </footer>
  </div>
</template>
