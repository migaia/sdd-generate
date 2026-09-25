# Go projects

Load when in-scope packages are Go modules. Follow the repository's module layout and linters; this guide closes decisions the repository has not yet made.

## Structure

- **Module**: one `go.mod` per releasable unit with the `go` directive and, when needed, a `toolchain` line. A `go.work` workspace only for local multi-module development. Major versions ≥2 use the `/vN` module path suffix.
- **Layout**: `cmd/<binary>/main.go` for each binary; `internal/` for code no other module may import; packages named by what they provide (`billing`, `store`), never `util`, `common` or `models`. Use `pkg/` only when the repository already does.
- **Dependency direction**: domain packages import no transport or storage packages; adapters (`httpapi`, `cli`, `postgres`) depend on domain interfaces ([core and adapters](../architecture/core-adapters.md)). Define interfaces in the consuming package, small and behavior-named.
- **Wiring**: explicit constructors in `main` (or one wiring package); no global mutable state and no `init()` side effects beyond registration.

## Design-controlling decisions

- **Context**: `context.Context` is the first parameter of every call that blocks, performs I/O or can be cancelled; never stored in structs. Deadlines and cancellation propagate to downstream calls.
- **Errors**: return errors, wrap with `fmt.Errorf("…: %w", err)`; sentinel errors or typed errors for conditions callers branch on, checked with `errors.Is`/`errors.As`. Map domain errors to exit codes or HTTP status in adapters only.
- **Concurrency**: every goroutine has an owner that waits for it (`errgroup`, `sync.WaitGroup`) and a cancellation path; channels have a documented closer; shared state is guarded or confined. Name the shutdown order for servers and workers.
- **Configuration**: parsed once at startup into typed config, validated before serving; environment and flags resolved in `main`.
- **Observability**: `log/slog` with structured fields; metrics and traces around external calls; no logging of secrets or full payloads.
- **HTTP services**: `http.Server` with read, write and idle timeouts; graceful shutdown with `Server.Shutdown`; request size limits; middleware order stated.
- **Compatibility**: exported identifiers are API; removal or signature change is a breaking change even inside a monorepo when other modules import it.
- **Supply chain**: `govulncheck ./...` and pinned module versions in `go.sum`.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Formatting and vet | `gofmt -l .` prints nothing; `go vet ./...` exits 0 |
| Lint | `golangci-lint run` or `staticcheck ./...` with the repository configuration |
| Behavior | `go test -race -run '<TestName>' ./<package>/...` naming the batch's table tests |
| Concurrency safety | the same tests under `-race`; goroutine leak check (`goleak`) where goroutines are started |
| Input robustness | `go test -fuzz=<FuzzName> -fuzztime=60s ./<package>` as a design probe for parsers |
| HTTP contracts | `httptest.Server` or handler tests asserting status, headers and body schema |
| Performance claims | `go test -bench=<Name> -benchmem -count=10` compared with `benchstat` against a baseline and threshold |
| Build | `go build -trimpath ./cmd/...` for every shipped target (`GOOS`/`GOARCH`) |
| Vulnerabilities | `govulncheck ./...` exits 0 |

## Contract grounding probe

When a key decision depends on version, types or call shape and no applicable contract, documentation or existing consumer settles it, make one focused probe: create a temporary module (`go mod init`, `go get <module>@<exact version>`), write the calls and types the SDD uses, and run `go build ./...` or `go vet ./...`. Compiling or type-checking is design evidence; running the scratch program to observe behavior is testing and follows the user's test authorization. Persist the command, exact versions, toolchain and an output excerpt in the SDD's evidence companion; a temporary directory may host the probe but is not the record.

## Anti-patterns

- Interfaces declared next to their only implementation "for testing".
- Goroutines started in libraries without a way to stop them.
- `panic` for expected errors; `log.Fatal` outside `main`.
- One `models` package imported by every layer.
