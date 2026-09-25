# Product archetypes

Classify the product before designing it. The archetype decides which dimensions control the design; missing one of them produces a technically complete SDD for the wrong product. Classification happens in [harvest card](../v2-authoring.md#1-harvest--facts-and-principles) pass 1 and is recorded in the contract as `product_archetype`.

## Classify

Choose the archetype of the primary user value, not of the technology. Mixed products name the primary archetype and list secondary surfaces explicitly.

| Archetype | Primary value | Signals in the request or repository |
| --- | --- | --- |
| `content-publication` | People come to read, watch or learn from authored content | blog, articles, posts, docs, knowledge base, newsletter, portfolio of writing, magazine, changelog, tutorials; Markdown/MDX sources; RSS; SEO |
| `marketing-site` | Persuade a visitor toward one conversion | landing page, product site, pricing, waitlist, campaign, hero, CTA |
| `commerce` | Find, evaluate and buy | catalog, product detail, cart, checkout, inventory, payments |
| `web-application` | Get a task done repeatedly | sign-in, forms, workflows, editors, settings, collaboration |
| `data-dashboard` | Monitor and decide from data | charts, metrics, filters, reports, alerts |
| `internal-operations` | Staff run a process | admin, back office, queues, approvals, audit trails |
| `developer-tool` | Developers automate or integrate | CLI, SDK, API client, plugin, build tool |
| `library-or-service` | Other code depends on a contract | package, service, API, protocol, worker |

A blog, documentation site or newsletter is `content-publication` even when it also has a subscribe form or a small shop. Treating it as a generic web application loses reading quality, content modelling and discoverability.

## Design-controlling dimensions

Every dimension listed for the archetype must be `REQUIRED_AND_CLOSED` or evidenced `NOT_APPLICABLE` before the design becomes normative.

| Archetype | Dimensions that must be closed |
| --- | --- |
| `content-publication` | audience and reading intent; content model and taxonomy; authoring workflow and source format; information architecture; route set; reading journey and continuation; typography and readability spec; style hooks and design tokens; discoverability (SEO metadata, feed, sitemap, structured data); media handling; performance budget for reading pages; accessibility |
| `marketing-site` | audience and single conversion goal; message hierarchy; proof and objection handling; route set; conversion journey; brand language and style hooks; analytics events; SEO; performance budget |
| `commerce` | catalog model; search and filtering; product detail decision content; cart and checkout states; payment and tax authority; order lifecycle; trust and policy content; route set; style hooks; performance |
| `web-application` | users and jobs; domain model and permissions; core workflows with empty, loading and error states; navigation and route set; forms and validation; persistence and sync; style hooks and component system; accessibility |
| `data-dashboard` | decisions supported; metric definitions and owners; data freshness; filtering and drill-down journey; visual encoding rules; route set; style hooks; performance with realistic data volume |
| `internal-operations` | operators and roles; process states and SLAs; bulk actions and audit; permissions; route set; density and style hooks |
| `developer-tool` | developer workflow; command or API surface; configuration; error messages; compatibility; documentation surface |
| `library-or-service` | public contract; compatibility and versioning; consumers; failure semantics; performance; observability |

All archetypes with a user interface (`content-publication`, `marketing-site`, `commerce`, `web-application`, `data-dashboard`, `internal-operations`) also produce an [experience contract](experience-contract.md). `content-publication` additionally follows [content site](content-site.md).

The archetype is independent of where the product runs. Classify `delivery_platforms` next with [delivery platforms](platforms.md): a commerce product can ship as a mini program, a web app and a Flutter app, and each platform adds its own lifecycle, permission, review and acceptance rules. A `developer-tool` or `library-or-service` with several surfaces follows [core and adapters](architecture/core-adapters.md).

## Questions that change the design

Ask only what evidence cannot answer, batched once as `INFORMATION_QUESTION`s:

- Who reads or uses it, arriving from where, trying to do what?
- What content or data exists now, in what format, and who produces it next month?
- Which existing sites or products feel right, and which feel wrong, and why?
- What single outcome matters most (read to the end, subscribe, buy, finish a task)?
- Are there brand assets, fonts, colors or a design system to honor?

Do not ask about framework or hosting when the repository already decides them.

## Anti-patterns

- Classifying by stack ("Next.js app") instead of by user value.
- Designing components before routes, templates and journeys exist.
- Leaving typography, spacing and color as implementation details in a content or brand-led product.
- Hard-coding visual values instead of declaring style hooks, which makes later theming a rewrite.
