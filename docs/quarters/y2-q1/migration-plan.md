# Y2-Q1 Provenance Artifacts — Migration Plan

No database migration. Provenance is a type-level extension on `ArtifactRecord` and `ArtifactProvenance`. The data is carried within job results (JSON), not in a separate table.
