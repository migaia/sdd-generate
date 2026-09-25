# Mini programs

Load when `delivery_platforms` contains `mini-program`. Covers WeChat first and names what changes on Alipay, Douyin, Baidu and QQ. Platform limits change: confirm every number below in the current official documentation and record the source and date in the design basis.

## Decide the implementation route

| Route | Choose when | Costs |
| --- | --- | --- |
| Native (WXML/WXSS/JS or TS) | one platform, performance-sensitive pages, deep platform APIs | no reuse across platforms |
| Taro (React/Vue) | several mini-program platforms plus H5 from one codebase, team knows React | framework compile layer, lagging new APIs |
| uni-app (Vue) | several platforms plus app/H5, Vue team | same, plus plugin ecosystem risk |

Keep the repository's existing route unless the requested outcome requires another platform. Record platform-specific branches (`process.env.TARO_ENV`, conditional compilation `#ifdef MP-WEIXIN`) as explicit design, not incidental code.

## Design-controlling dimensions

- **Package structure**: main package holds launch and tab pages only; features go to subpackages (`subPackages`), rarely used flows to independent subpackages; declare `preloadRule` for the next likely subpackage. Budget each package against the platform size limit (WeChat main package 2 MB) with a measured size in acceptance.
- **Page stack and navigation**: `navigateTo` stacks pages up to the platform limit (WeChat 10); tab pages use `switchTab`; long flows use `redirectTo` or `reLaunch`. Design the back path for shared entries (share cards, QR codes, subscription messages, `scene` values) that land deep in the stack.
- **Lifecycle**: `App.onLaunch/onShow/onHide`, page `onLoad/onShow/onReady/onHide/onUnload`; hot start after background reuses memory state, cold start does not. Name which state is rebuilt from storage or server on each.
- **Rendering and data flow**: minimize `setData` size and frequency; never push whole lists on each change; use custom components with `observers`; long lists use virtual lists. State the render budget for the heaviest page.
- **Identity**: `wx.login` returns a one-time code; the server exchanges it (`code2Session`) and issues its own session. The AppSecret and session key never reach the client. Phone number and user profile require explicit user action and component-based authorization.
- **Privacy and permissions**: declare the privacy guide and handle the privacy authorization flow before calling protected APIs; request scopes (`scope.userLocation`, camera, album) at the moment of use with a denied-path UI and a route to settings.
- **Network**: HTTPS request domains must be registered in the platform console; design per-environment domains and a failure state for a domain not yet whitelisted.
- **Payments and messages**: payment signing happens on the server; subscription messages need a user-triggered request per template.
- **Review gates**: service category, content policy, user-generated content moderation, and qualification documents. Features that fail review are a product risk and belong in the design, not in release notes.
- **Styles**: `rpx` for layout, tokens as CSS variables in `app.wxss`, safe-area insets, dark mode via `darkmode` and theme variables.
- **Cross-platform differences**: API prefixes (`wx`, `my`, `tt`, `swan`), login and payment providers, component support and size limits differ. List every used API with its availability per target platform.

## Experience contract rules

- Routes are page paths from `app.json` (`pages/home/index`); tab pages have `kind: "tab"`, entry points from share cards, QR codes or messages have `kind: "deep-link"` with the entry parameters they accept.
- Every journey that starts from a share card or QR code declares its cold-start state and back destination.
- Style hooks name tokens in `app.wxss` or the framework theme; components reference tokens only.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Pages and navigation | `miniprogram-automator` (or the framework's E2E runner) drives the developer tools: reach every route, assert page stack depth and back destination |
| Package size | `miniprogram-ci` build or preview output reports main and subpackage sizes below the declared budget |
| Login security | server test: a forged or reused code is rejected; client bundle contains no AppSecret (search the built output) |
| Denied permissions | automator mocks the authorization result; the denied state renders its fallback |
| Rendering | performance panel or `wx.getPerformance` entries for the heaviest page stay within the budget on the declared test device |
| Review readiness | checklist evidence per category rule, privacy guide text, and a preview build uploaded with `miniprogram-ci` |

Unit logic runs in Node/Jest/Vitest with platform APIs behind an adapter; never import `wx` into domain code.

## Anti-patterns

- A single main package that grows past the limit in the last batch.
- Calling `wx.getUserProfile`-style APIs on launch instead of at the moment of need.
- Storing the session key or AppSecret on the client.
- Designing H5 routes first and mapping them to pages afterward.
