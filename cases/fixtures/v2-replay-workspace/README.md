# Replay: workspace dependency in a package node_modules

The pipeline imports @acme/utils, installed only in packages/pipeline/node_modules. The fixture's own .gitignore ignores it inside the replayed repository, which is the case under test; create-sdd itself tracks it (force-added), so a fresh checkout of the skill still has it (OD-55).
