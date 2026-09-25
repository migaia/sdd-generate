# Migration boundary for `sdd/v2`

Load only when this change replaces or removes an owner, public path, export, wire or persisted format, or an externally observed behavior. Use the repository's current contract as authority; this page does not require a controller, packet or additional workflow.

Name the old surface, the new owner and the supported consumers. For each consumer, record the real read/call edge, who changes it, the interface version it will consume, and whether compatibility is retained, migrated or intentionally broken. Search the declared source universe for candidate readers and dispose of every hit; a text search is a candidate inventory, not proof of exhaustiveness. State any dynamic or generated-reader discovery method separately.

Order steps so a consumer never needs an unavailable producer. Identify the first version in which each form exists, the cutover or coordinated breaking boundary, and rollback or recovery where that path is supported. A removal closes only when its named acceptance observes zero remaining supported readers and the intended new behavior. For each compatibility promise, link one implementation step and one acceptance case that can distinguish preservation from a changed result. Keep unrelated historic readers and hypothetical future platforms outside the user-owned delta.
