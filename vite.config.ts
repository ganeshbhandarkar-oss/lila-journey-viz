import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Project site: https://<owner>.github.io/<repo>/
// User/org site (repo named *.github.io) and other hosts stay at the domain root.
function resolveBase(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
    const repo = process.env.GITHUB_REPOSITORY.split('/')[1] ?? ''
    if (repo && !repo.endsWith('.github.io')) return `/${repo}/`
  }
  return './'
}

// BASE_PATH lets the same build work at a domain root (Vercel/Netlify) or a
// sub-path such as GitHub Pages (https://<user>.github.io/lila-journey-viz/).
export default defineConfig({
  plugins: [react()],
  base: resolveBase(),
})
