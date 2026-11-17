# Public source and verified development delivery

Urania `designcraft@1.3.0-dev.150`, UI165. The public audit baseline was b1627b7/UI163; current source, actual tests and scope are recorded in VERIFICATION_UI165.json. No forced main update is part of this delivery; changes are prepared on audit/ui165-closeout-20261118 for review.

Compiled runtime files and the fixed HyperFrames dependency tree use the matching checksummed GitHub Release. release/runtime-assets.json and runtime-manifest.json identify7713files. DSH itself, user profiles, credentials, raw model conversations, private test SDKs and development caches are not published. The runtime SDK dependency tree is restored offline, without lifecycle scripts; it is not the developer's unrelated node_modules.

Public report copies anonymize local profile paths, session identities and opaque browser capabilities. Their public hashes and source-copy hashes are distinguished in SOURCE_SNAPSHOT.json. Historical expected hashes and originals are not rewritten to imitate recovery.56old originals were reverified locally;3old source snapshots were not found. These old identities are not used as current functional acceptance evidence.

THIRD_PARTY_NOTICES.md, fixed source/input archives and original licenses are retained. The project's MIT license does not relicense AGPL, font, asset or other third-party content. Current converter/codec sources and independent reproducible build are recorded separately from the preserved, inactive historical OpenDesign prebuilt.

The final TGZ/archive hashes, actual extracted-package load, Git commit/PR/Release and remote readback belong in the adjacent DELIVERY.json. This source file does not manufacture a future publication result. Public CI uses no private DSH credentials, no uncontrolled caches and no large artifact upload; private integration is opt-in and never runs untrusted PR code.
