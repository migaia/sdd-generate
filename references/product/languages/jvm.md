# JVM projects: Java and Kotlin

Load when in-scope packages are Java or Kotlin on the JVM (services, libraries, CLIs). Android apps follow [native mobile](../platforms/mobile-native.md); this guide still applies to their pure Kotlin modules.

## Structure

- **Build**: the repository's Gradle (Kotlin DSL, version catalog `gradle/libs.versions.toml`) or Maven; JDK toolchains (`java { toolchain { languageVersion = ... } }`) so local and CI builds use the same JDK; Kotlin `jvmTarget` aligned with the Java target.
- **JDK version**: an LTS release chosen from deployment evidence, recorded with its support horizon.
- **Modules**: domain and application modules with no framework imports; adapters for web (Spring Boot, Ktor, Quarkus, Micronaut — the existing one), persistence, messaging and CLI ([core and adapters](../architecture/core-adapters.md)). Enforce the direction with module dependencies plus ArchUnit or Spring Modulith rules.

## Design-controlling decisions

- **Nullability**: Kotlin types express it; Java public APIs use JSpecify annotations; platform types from Java are wrapped at the boundary.
- **Errors**: domain exceptions in one hierarchy (Java) or sealed result types (Kotlin); adapters map them in one place (`@ControllerAdvice`, Ktor `StatusPages`, CLI exit codes).
- **Concurrency model**: one per service — virtual threads (Java 21+), Kotlin coroutines, or reactive (Reactor) — never mixed without a boundary; blocking I/O never on event-loop threads.
- **Transactions**: owned by application services (`@Transactional` on the service boundary), not controllers or repositories; isolation and retry named for contended writes.
- **Configuration**: typed and validated at startup (`@ConfigurationProperties` with validation, Hoplite, SmallRye Config); no `System.getenv` in the domain.
- **Persistence**: schema migrations with Flyway or Liquibase, one version per change; ORM lazy-loading boundaries stated; queries for large tables have indexes named in the design.
- **Serialization**: Jackson or kotlinx.serialization with an explicit unknown-field policy and date/time formats; public JSON is a contract.
- **Observability**: Micrometer metrics and OpenTelemetry traces around external calls; structured logs without secrets.
- **Startup and memory**: container memory limits and JVM flags stated; GraalVM native image only with evidence that reflection and resource configuration are complete.
- **Dependencies**: platform BOMs, dependency locking or the version catalog; conflict resolution recorded; supply-chain scan in CI.
- **Libraries**: binary compatibility checked (Kotlin binary-compatibility-validator `apiCheck`, japicmp or Revapi for Java); Maven Central publication with sources, Javadoc/Dokka and signatures.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Build and static checks | `./gradlew check` or `mvn verify` with the repository's lint (ktlint/detekt, Spotless, Error Prone) exits 0 |
| Behavior | JUnit 5 or Kotest tests named for the batch: `./gradlew :module:test --tests '<Class.method>'` or `mvn -pl module test -Dtest=<Class#method>` |
| Web contracts | framework slice tests (`@WebMvcTest`, Ktor `testApplication`) asserting status, headers and schema |
| Persistence | integration tests against the real database engine with Testcontainers, not an in-memory substitute |
| Architecture | ArchUnit or Modulith test fails on a deliberately added domain → adapter import and passes on the real tree |
| Library compatibility | `./gradlew apiCheck` or japicmp report matches the declared API change |
| Supply chain | dependency scan (OWASP dependency-check, `osv-scanner`) passes the declared threshold |
| Performance claims | JMH benchmark or load test with workload, JDK, heap settings and baseline |

## Contract grounding probe

When a key decision depends on version, types or call shape and no applicable contract, documentation or existing consumer settles it, make one focused probe: create a minimal Gradle or Maven project in a temporary directory with the exact coordinates, and compile a class that uses the APIs the SDD calls (`compileJava`, `compileKotlin` or `mvn compile`). Compiling or type-checking is design evidence; running the scratch program to observe behavior is testing and follows the user's test authorization. Persist the command, exact versions, toolchain and an output excerpt in the SDD's evidence companion; a temporary directory may host the probe but is not the record.

## Anti-patterns

- Business rules in controllers, JPA entities used as API DTOs, or repositories starting transactions.
- Mixing blocking JDBC calls into reactive pipelines.
- A `common` module that every module depends on and that accumulates domain logic.
- Tests that pass only against H2 for a PostgreSQL product.
