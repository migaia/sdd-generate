# Python projects

Load when in-scope packages are Python. Follow the repository's project manager, lint and type configuration; this guide closes decisions the repository has not yet made.

## Structure

- **Project metadata**: `pyproject.toml` (PEP 621) is the single source of name, version, `requires-python`, dependencies, optional groups and entry points (`[project.scripts]`). One project manager per repository (uv, Poetry, PDM or Hatch — the existing one) and a committed lockfile for applications.
- **Layout**: `src/<package>/` layout so tests import the installed package; `tests/` beside `src/`. Subpackages by capability; `domain` and application modules import no web framework, ORM session or CLI library ([core and adapters](../architecture/core-adapters.md)).
- **Entry points**: CLI (Typer, Click or argparse), web app (FastAPI, Django, Flask — the existing one), workers (Celery, RQ, arq) are adapters calling application services.
- **Supported versions**: `requires-python` from evidence (deployment images, users); CI tests the lowest and highest supported versions when publishing a library.

## Design-controlling decisions

- **Typing**: public functions and core modules fully annotated; `pyright` or `mypy --strict` on core packages; `Protocol` for ports; `TypedDict`, dataclasses or Pydantic models chosen per boundary (Pydantic at I/O edges, plain dataclasses inside the domain).
- **Sync versus async**: choose per service. Async services keep blocking I/O out of the event loop (`asyncio.to_thread` or async drivers); never mix sync ORM sessions into async request handlers without an explicit boundary.
- **Errors**: domain exceptions in one hierarchy per package; adapters translate them to HTTP responses or exit codes; no bare `except:`; `raise … from err` preserves cause.
- **Configuration**: typed settings (for example `pydantic-settings`) loaded once at startup and injected; no module-level reads of environment variables inside the domain.
- **Data access**: migrations tool (Alembic, Django migrations) and a version per schema change; transactions owned by the application service, not the repository function.
- **Packaging**: `python -m build` produces sdist and wheel; package data declared; native extensions name their build backend and supported platforms.
- **Security and supply chain**: `pip-audit` or the project manager's audit; no `pickle`/`eval` on untrusted input; secrets from environment or a secret manager.
- **Performance**: profile before optimizing (`cProfile`, `py-spy`); state the workload and threshold for any performance claim.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Lint and format | `ruff check .` and `ruff format --check .` (or the repository's tools) exit 0 |
| Types | `pyright` or `mypy` on the batch's packages exits 0 |
| Behavior | `pytest tests/<module>::<test> -q` naming the batch's tests, run through the project manager (`uv run pytest …`) |
| Invariants | `hypothesis` properties with a fixed `--hypothesis-seed` recorded on failure |
| Async behavior | `pytest-asyncio` or `anyio` tests with explicit timeouts |
| HTTP contracts | framework test client (FastAPI `TestClient`, Django test client) asserting status and response schema |
| Database behavior | tests against the real engine in a disposable container or transaction-rolled fixture, never only SQLite for a Postgres product |
| Packaging | `python -m build` then install the wheel in a clean virtual environment and import or run the entry point |
| Supply chain | `pip-audit` exits 0 |

## Contract grounding probe

When a key decision depends on version, types or call shape and no applicable contract, documentation or existing consumer settles it, make one focused probe: create a temporary virtual environment, install the exact versions, import the modules and call the signatures the SDD uses, and run the repository's type checker on the scratch file when the project uses one. Compiling or type-checking is design evidence; running the scratch program to observe behavior is testing and follows the user's test authorization. Persist the command, exact versions, toolchain and an output excerpt in the SDD's evidence companion; a temporary directory may host the probe but is not the record.

## Anti-patterns

- Business rules inside FastAPI route functions or Django views.
- `requirements.txt` and `pyproject.toml` both declaring dependencies.
- Tests that pass only because of import path hacks instead of an installed package.
- Mutable default arguments and module-level singletons holding connections.
