export default defineNuxtConfig({
  ssr: true,
  devtools: {
    enabled: false,
  },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'differ - Git change explorer',
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'differ is a focused desktop Git change explorer for commit history, contributors, diffs, and repository status.',
        },
        { name: 'theme-color', content: '#050505' },
        { property: 'og:title', content: 'differ - Git change explorer' },
        {
          property: 'og:description',
          content: 'Review commits, contributors, changed files, and local Git status in one focused desktop app.',
        },
        { property: 'og:type', content: 'website' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/differ-logo.svg' },
      ],
    },
  },
})
