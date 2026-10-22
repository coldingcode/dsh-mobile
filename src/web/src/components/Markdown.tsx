import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import { openURL } from '../native.ts'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const requested = (lang ?? '').split(/\s+/u)[0] ?? ''
  const valid = requested !== '' && hljs.getLanguage(requested) !== undefined
  const highlighted = valid
    ? hljs.highlight(text, { language: requested, ignoreIllegals: true }).value
    : hljs.highlightAuto(text).value
  const label = requested === '' ? 'code' : requested
  return '<div class="code-block"><div class="code-head"><span class="code-lang">' + escapeHtml(label) + '</span><span class="code-glow"></span></div><pre><code class="hljs">' + highlighted + '</code></pre></div>'
}

function render(markdown: string): string {
  const html = marked.parse(markdown, { gfm: true, breaks: true, renderer }) as string
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['target', 'rel'],
  })
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => render(text), [text])
  return (
    <div
      className="md"
      dir="auto"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        const anchor = target.closest('a')
        if (anchor === null) return
        const href = anchor.getAttribute('href')
        if (href === null || href.startsWith('#')) return
        event.preventDefault()
        openURL(href)
      }}
    />
  )
}
