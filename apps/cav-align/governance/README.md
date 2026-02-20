# CAV-Align Governance

This directory is a required repository artifact. It must be committed and kept current.

## Contents

| File                                        | Purpose                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `Governance_Matrix.xlsx`                    | Tracks every product release against CAV Level, RPD version, and hardening status |
| 'CAV_Levels_Roadmap_Consolidated_v1.1.docx' | The current CAV Levels roadmap, as defined by the CAV Standards team              |
| `README.md`                                 | This file                                                                         |

## Governance Matrix — Sheet: Governance Matrix

One row per product release. **A new row must be added before any version bump is merged.**

| Column                 | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| Release Date           | YYYY-MM                                                      |
| Product Version        | e.g. `MQTT Align v1.1.0`                                     |
| CAV Level              | e.g. `CAV Level 1.1` — never advance without formal review   |
| CAV Standard Version   | `CAV v1.0` — do not increment without explicit authorisation |
| RPD Version            | e.g. `RPD v1.1 (With Addendum)`                              |
| Alignment Pack Version | e.g. `Alignment Pack v1.1`                                   |
| Hardening Status       | Session A / Session B / Complete                             |
| Notes                  | Summary of what changed                                      |

## Governance Matrix — Sheet: Release Checklist

Must be reviewed before every release. Sections:

- **Architecture** — engines pure, store isolation, no Level 2 creep
- **Security** — JWT, WS auth, credential encryption, entitlements, no secrets logged
- **Tenant Isolation** — store tenantId enforcement, RLS enabled and tested
- **Governance** — this file updated, CAV Standard unchanged
- **Operational** — builds clean, lint clean, health endpoint, logging, session lifecycle

## Rules

1. **No release without a matrix row.** The Governance_Matrix.xlsx must contain an entry
   for the version being released before the release PR is merged.

2. **CAV Standard version is frozen at CAV v1.0** until formally reviewed.
   Do not increment it as part of a feature release.

3. **CAV Level may only advance** (e.g. 1.1 → 2.0) after a formal architectural review
   confirming the new level's requirements are fully met.

4. **This directory is governance-only.** No runtime code, no imports, no dependencies.
   Separation between governance artifacts and runtime logic is non-negotiable.
