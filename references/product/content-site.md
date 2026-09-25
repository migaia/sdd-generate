# Content-driven sites

Load when `product_archetype` is `content-publication` (blogs, documentation, knowledge bases, newsletters, magazines, tutorials, changelogs). Content sites succeed or fail on reading: whether a visitor understands where they are, reads comfortably to the end, and naturally continues. Every section below is design work, not polish to leave to the Operator.

## 1. Content model

Define each content type once, as data, before any page:

| Field group | Decide |
| --- | --- |
| Identity | type (post, series, page, tag, category, author), stable slug rules, canonical URL, redirects for renamed slugs |
| Editorial | title, dek/summary (used in listings and meta description), body format (Markdown/MDX), cover image with alt text, author, published and updated dates, draft/scheduled state |
| Structure | headings depth rule, table of contents threshold, code blocks and languages, callouts, footnotes, embeds allowed |
| Relations | tags and categories (controlled vocabulary, not free text), series with order, related-content rule (manual list first, then shared taxonomy), previous/next |
| Derived | reading time, excerpt, word count, last-updated notice |

Record where content lives (repository folder, CMS), who writes it, how drafts are previewed, and how an author adds one post end to end. A content type without an authoring path is incomplete design.

## 2. Information architecture and route set

List every route with its template and purpose. A typical blog needs:

| Route | Template | Purpose |
| --- | --- | --- |
| `/` | home | orient: who writes, what about, newest and featured content, subscribe |
| `/posts/[slug]` | article | read one piece comfortably and continue |
| `/posts` or `/archive` (paginated) | index | browse everything chronologically |
| `/tags/[tag]`, `/categories/[category]` | taxonomy | browse a topic |
| `/series/[series]` | series | read an ordered sequence |
| `/about` | page | trust: author and scope |
| `/search` (when content volume justifies it) | search | find a known piece |
| `/rss.xml` or `/feed.xml` | feed | subscribe in readers |
| `/sitemap.xml`, `/robots.txt` | machine | discoverability |
| `404` | error | recover to useful content |

Decide URL stability, pagination size, trailing-slash policy, locale strategy when multilingual (including what a client-side locale switch does to long-lived runtime instances such as search indexes or caches), and which routes are indexable. Remove routes that the content volume cannot justify rather than shipping empty taxonomy pages.

## 3. Reading journey and logical continuity

Design the path a reader actually walks, then make every template serve its step:

1. **Arrive** from search, social or feed on an article, not the home page. The article must orient without prior context: title, dek, author, date, reading time, topic link.
2. **Commit**: above the fold shows the promise of the piece; no layout shift, no interstitial, no cookie wall hiding the first paragraph.
3. **Read**: consistent vertical rhythm, headings that summarize the argument, a table of contents for long pieces, progress cues where the article is long, code and images that never overflow the reading column.
4. **Continue**: at the end, and only there, offer the next step in priority order: next in series, related by topic, latest, subscribe.
5. **Return**: feed, newsletter and stable URLs.

Logical continuity rules:

- The same kind of information always appears in the same place and style on every template (dates, tags, author, navigation).
- Navigation is shallow: any article is at most two steps from the home page and one from its topic.
- Listing cards use the same fields in the same order everywhere.
- Headings follow one outline per page (single `h1`, no skipped levels) so structure is visible and machine-readable.
- Every dead end (404, empty tag, end of series) links onward.

## 4. Readability specification

State these as normative values, each tied to an acceptance case:

| Property | Default target |
| --- | --- |
| Measure (line length) of body text | 60–75 characters (`max-width` about 65–70ch) |
| Body font size | 17–20px on desktop, not below 16px on mobile |
| Line height | 1.6–1.8 for body, tighter for headings |
| Paragraph spacing | about one line of body height |
| Type scale | a declared ratio (for example 1.2–1.25) with named steps |
| Contrast | WCAG AA at minimum (4.5:1 body), AAA preferred for long reading |
| Code blocks | horizontal scroll inside the block, readable monospace size, syntax theme meeting contrast |
| Images | intrinsic size set, captions styled distinctly, never wider than the viewport |
| Dark mode | when offered, tokens for both schemes, no pure-black on pure-white extremes |

Choose fonts deliberately (reading face, heading face, monospace), with loading strategy that avoids invisible text.

## 5. Style hooks

Declare the design language as hooks before components exist, so visual decisions are centralized and themeable. Use the [experience contract](experience-contract.md) token table: color roles (background, surface, text, muted text, accent, link, border, code background), typography roles (body family, heading family, mono family, size steps, line heights), spacing scale, reading column width, radius, shadow and motion. Components reference tokens only; no hard-coded colors, font sizes or widths in templates.

## 6. Discoverability

Per route decide title pattern, meta description source (the dek), canonical URL, Open Graph and social image, structured data (`BlogPosting`/`Article`, `BreadcrumbList`), feed contents (full text or summary), sitemap inclusion, and `noindex` for thin pages. Broken or duplicate canonicals are design defects.

## 7. Performance and accessibility budgets

Reading pages should be statically generated or cached, with a measured budget such as LCP under 2.5s on a mid-range mobile profile, CLS below 0.1, and no render-blocking fonts. Accessibility covers keyboard navigation, focus visibility, skip link, landmarks, alt text and reduced motion.

## 8. Acceptance that proves reading quality

Write atomic, executable acceptance instead of "looks good":

- Computed body `max-width` on the article template stays within the declared measure at 1280px and 390px viewports.
- Axe (or equivalent) reports no contrast or heading-order violations on home, article, taxonomy and 404.
- Every article route renders title, dek, date, reading time and at least one continuation link at the end.
- `feed.xml` validates and lists the newest N posts; `sitemap.xml` lists every indexable route and no drafts.
- Article LCP and CLS stay within budget on a fixed Lighthouse profile.
- Adding a Markdown file with front matter produces a routed, listed, feed-included post without code changes.

## Anti-patterns

- Designing the home page first and treating the article page as a generic content slot.
- Free-text tags that fragment topics; taxonomy pages with one post.
- Full-width body text, tiny fonts, low-contrast gray text.
- Related content above the article, pop-ups before the first paragraph, sticky elements covering the reading column.
- Components with inline colors and sizes instead of style hooks.
- No route for feeds, sitemap or 404.
