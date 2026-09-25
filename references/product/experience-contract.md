# Experience contract

Load for every product with a user interface (see [archetypes](archetypes.md)). The experience contract makes routes, templates, journeys and style hooks explicit design decisions and gives the loop controller a machine index to validate. Write the human section **Experience Architecture** in the SDD first; the contract block is its projection.

## Human section: Experience Architecture

Use these labeled parts:

1. **Archetype and audience**: `product_archetype`, primary audience, arrival sources, the single most important outcome.
2. **Route set**: a table of every route with `ID`, `description`, path pattern, template, purpose, indexability, and requirement/acceptance IDs.
3. **Templates and regions**: each template's regions in reading or task order (for example header, orientation, body, continuation, footer) and what content fills each region.
4. **Journeys**: two to five ordered journeys, each a sequence of route steps with the user's intent at every step and the acceptance cases that prove it.
5. **Style hooks**: the token table and the component hook map (below), plus font choices and loading, breakpoints and dark-mode policy.
6. **States**: empty, loading, error and not-found behavior per template.
7. **Readability** (content archetypes): the normative measure, font size, line height and contrast targets from [content site](content-site.md).

## Platform navigation units

Routes use the navigation unit of each declared platform ([delivery platforms](platforms.md)): URL paths for `web`; page paths from `app.json` for `mini-program` (`pages/home/index`); screen IDs for `ios`, `android`, `flutter`, `harmonyos` and `desktop`. Native and mini-program kinds are `screen`, `tab`, `sheet`, `deep-link` (every external entry: share card, QR code, notification, universal or app link), `widget` and `notification`. Style hooks on native platforms map to the platform token system (asset catalogs, `MaterialTheme`, `ThemeData` extensions, HarmonyOS resource elements) while keeping the same token table.

## Style hooks

Tokens are named CSS custom properties (or the repository's existing token system) grouped by category. Components expose hooks (class names, data attributes or props) that consume tokens; they never embed raw values.

```text
Token                 | category   | purpose
--color-bg            | color      | page background
--color-text          | color      | body text, AA on --color-bg
--color-accent        | color      | links and primary actions
--font-body           | typography | reading face with fallback stack
--font-size-body      | typography | body size step
--line-height-body    | typography | body line height
--space-3             | space      | paragraph spacing
--measure-reading     | layout     | article column max width (ch)
```

```text
Component    | hooks                         | tokens
ArticleBody  | .prose, data-density          | --font-body, --font-size-body, --line-height-body, --measure-reading
PostCard     | .post-card, data-variant      | --color-text, --space-3
```

Reuse an existing design system's tokens when present; the table then maps product roles onto those tokens instead of inventing new ones.

## Contract block

Add beside `delivery_plan`:

```json
"product_archetype": "content-publication",
"experience_contract": {
  "protocol": "experience-contract/v1",
  "templates": [
    {"id": "TP01", "purpose": "read one article and continue", "regions": ["header", "orientation", "body", "continuation", "footer"]},
    {"id": "TP02", "purpose": "browse posts by date or topic", "regions": ["header", "listing", "pagination", "footer"]},
    {"id": "TP03", "purpose": "machine-readable and recovery surfaces", "regions": ["body"]}
  ],
  "routes": [
    {"id": "RT01", "path": "/", "kind": "home", "template": "TP02", "purpose": "orient and surface newest posts", "requirement_ids": ["XQ01"], "acceptance_ids": ["YS01"]},
    {"id": "RT02", "path": "/posts/[slug]", "kind": "article", "template": "TP01", "purpose": "read comfortably and continue", "requirement_ids": ["XQ02"], "acceptance_ids": ["YS02"]},
    {"id": "RT03", "path": "/tags/[tag]", "kind": "taxonomy", "template": "TP02", "purpose": "browse one topic", "requirement_ids": ["XQ01"], "acceptance_ids": ["YS01"]},
    {"id": "RT04", "path": "/feed.xml", "kind": "feed", "template": "TP03", "purpose": "subscribe in feed readers", "requirement_ids": ["XQ01"], "acceptance_ids": ["YS01"]},
    {"id": "RT05", "path": "/sitemap.xml", "kind": "sitemap", "template": "TP03", "purpose": "list indexable routes", "requirement_ids": ["XQ01"], "acceptance_ids": ["YS01"]},
    {"id": "RT06", "path": "/404", "kind": "error", "template": "TP03", "purpose": "recover to useful content", "requirement_ids": ["XQ01"], "acceptance_ids": ["YS01"]}
  ],
  "journeys": [
    {"id": "JN01", "audience": "search visitor", "steps": [{"route_id": "RT02", "intent": "read the answer"}, {"route_id": "RT03", "intent": "continue within the topic"}], "acceptance_ids": ["YS02"]}
  ],
  "style_hooks": {
    "tokens": [
      {"name": "--measure-reading", "category": "layout", "purpose": "article column width"},
      {"name": "--font-size-body", "category": "typography", "purpose": "body size step"},
      {"name": "--color-text", "category": "color", "purpose": "body text meeting AA"}
    ],
    "component_hooks": [
      {"component": "ArticleBody", "hooks": [".prose"], "tokens": ["--measure-reading", "--font-size-body", "--color-text"]}
    ]
  },
  "readability": {"measure_ch": [60, 75], "body_font_px": 18, "line_height": 1.7, "contrast": "AA", "acceptance_ids": ["YS03"]}
}
```

The loop controller checks: a known `product_archetype`; an experience contract for every UI archetype; unique template, route, path, journey and token identifiers; every route on a known template bound to known requirements and acceptance; no unused template; journeys of at least two steps over known routes with known acceptance; component hooks that reference declared tokens only; and, for `content-publication`, readability values within sane ranges plus the home, article, index or taxonomy, feed, sitemap and error route kinds and a journey that continues from an article. Run `validate` and read `experienceContract` in its result. Route, template and journey IDs that appear in presentation tables need their prefixes registered in `presentation.prefixes`.

A change to an existing UI product declares `"scope": "delta"` with `"product_contract"` naming the SDD or source that owns the full route set, and lists only the routes, templates and journeys the change touches; content-route completeness, readability and reading continuation stay with that owner. New products and full redesigns keep the default `"scope": "product"`.

Route `kind` is one of `home`, `article`, `index`, `taxonomy`, `series`, `search`, `feed`, `sitemap`, `page`, `error`, `app`, `checkout`, `dashboard`, `settings`, `other`. Token `category` is one of `color`, `typography`, `space`, `size`, `radius`, `shadow`, `motion`, `layout`, `z-index`, `breakpoint`.

## Planning impact

Templates, style hooks and the route skeleton are foundation work: put tokens and base templates in an early batch that later page batches depend on, so pages never invent visual values. Readability and journey acceptance join the final verification shard for the affected templates.
