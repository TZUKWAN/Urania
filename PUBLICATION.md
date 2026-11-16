# Public source snapshot

Published project name: **Urania**. Snapshot date: **2026-11-16**. Product metadata at upload: `designcraft@1.3.0-dev.148`, UI build **163**. Existing `designcraft` plugin IDs, tool names and package identifiers are retained for compatibility.

This repository contains the current plugin source, tests, declared resources, runtime source/metadata/licenses, and engine-source snapshot archives. Windows compiled runtime files are distributed separately in the matching development Release because several exceed GitHub's regular Git file limit. `release/runtime-assets.json` records the exact download, SHA256, file sizes and per-file manifest. Extract the verified archive into the repository root; its paths begin with `runtimes/`.

The runtime bundle preserves the files present in the project, including compatibility builds referenced by existing locks. It does not include DSH itself, private SDK/profile caches, installed node_modules, system Node/Chromium caches or the external FFmpeg executable. Dependency locks and upstream license/source information remain in the source tree. Third-party components retain their actual licenses; the project's MIT license does not relicense AGPL, font, asset or other third-party material. See THIRD_PARTY_NOTICES.md and licenses/.

Excluded from publication: the unrelated METIS parent repository/history; developer state; raw user plans/conversations; private DSH test profiles; node_modules and build caches; raw validation transcripts/captures and temporary test outputs. Public JSON report copies have local profile paths, test session IDs, nonce/credential fields and conversation/draft payloads anonymized. These copies describe historical checks; omitted raw evidence remains local and is not presented as independently reproducible public evidence.

The public README is prepared for this source upload. Application source and asset bytes are retained; publishing documentation and public report anonymization do not modify the original development directory. SOURCE_SNAPSHOT.json records the source and publication hashes.

Publication verification covers credential scanning (including bundled source archives), precise review of scanner false positives, file/hash checks, Git/remote contents, and runtime archive readback. `.gitleaks.toml` extends the scanner's default rules and only permits exact reviewed non-secret source/hash lines. It does not exclude whole application directories or disable credential rules.

This upload is **a development snapshot, not a new claim of functional acceptance**. The existing development state still lists actual DSH desktop reload/animation workflow acceptance as pending. Functional/model/render tests were not rerun merely for this GitHub upload. Historical verification reports retain their original scope, dates and limitations.
