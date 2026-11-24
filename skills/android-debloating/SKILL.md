---
name: android-debloating
description: Read-only ADB device audit, structured user decision interview, risk-tiered debloating, containment, and post-reboot verification for Android devices.
disable-model-invocation: true
---

# Android Debloating & Optimization

Investigate an Android device over ADB, collect the user's explicit policy through a short structured interview, verify live package couplings before proposing changes, and execute/verify a risk-tiered optimization plan through a mandatory post-reboot audit.

## Core Discipline

- **Read-only by default:** Inspect the live device strictly with read-only ADB probes. Apply mutating commands only in the user's chosen execution mode after explicit approval for that block.
- **Device truth over web lore:** Classify every candidate from observed `dumpsys` state, `codePath`, `sharedUser`, running processes, scheduled jobs, and `logcat` telemetry on the attached device—treat generic web lists only as hypotheses to test.
- **Reversibility ladder (lightest effective intervention):**
  1. Pure `/data/app` (`Hidden system packages: NONE`) → `pm uninstall`
  2. System/priv-app or updated stub → `pm disable-user --user 0` (halting execution cleanly with one-command `pm enable` rollback)
  3. OS-coupled or PackageManager-protected non-`uid=1000` app → AppOps + Standby Bucket containment
  4. Protected `sharedUserId=android.uid.system` (`uid=1000`) package → leave untouched (consult [`references/containment-and-safety.md`](references/containment-and-safety.md) for why UID-mode AppOps on `uid=1000` corrupt system services)

---

## Phase 0 — Device Fingerprint & Baseline Snapshot

Consult [`references/adb-telemetry-commands.md`](references/adb-telemetry-commands.md) for exact read-only probes and ADB shell quoting/stdin safeguards before running commands.

1. Confirm `adb get-state` returns `device`; record `manufacturer`, `model`, `Android`/`API` release, build ID, bootloader lock state, RAM/swap totals, account count, and USB link speed.
2. Save raw baseline snapshots locally (`-u`, `-d`, `-3`, strictly `enabled=3` filtered list, `settings_{global,secure,system}`, `meminfo`, `jobscheduler`, `notification`, `device_policy`) so every change has a diffable baseline.

**Done when:** Baseline snapshot files exist on disk and exact live `-u`, `-d`, `-e`, `-3`, and `enabled=3` package counts are recorded.

---

## Phase 1 — Structured User Interview (Before Classifying Packages)

Collect explicit user decisions across all **6 axes** in one structured batch before building any removal list:

1. **Ecosystems & Accounts:** Identify mission-critical apps/ecosystems (e.g., Google Play Services, Gmail, Maps, Calendar Sync, Gemini, Find Hub) versus unwanted ecosystems (OEM account/cloud/store, social preloads, vendor suites).
2. **Zero-Compromise Features:** List hardware and OS features that must remain untouched (e.g., Call Recording, Camera voice triggers, Stylus/DeX, Android Auto, biometrics, VoLTE/Wi-Fi Calling, eSIM, NFC/Wallet, Work Profile).
3. **Third-Party Background Policy:** Classify key apps into real-time push (unrestricted FCM + Cached Apps Freezer) versus on-demand only (restricted/deep-sleep containment) versus unused stubs.
4. **Privacy, DNS & System Tuning Scope:** Confirm Private DNS hostname, virtual swap/RAM expansion policy, Cached Apps Freezer, animation scale, unused radios (UWB), clipboard access alerts, and setup/OEM nudge suppression.
5. **Operational Constraints:** Confirm whether OEM backup/transfer agents must stay enabled for external backup tools, and confirm deferring USB/ADB-blocking lockdowns (e.g., Auto Blocker) until post-reboot verification finishes.
6. **Execution Mode:** Choose whether the agent outputs command blocks for manual user execution or executes approved blocks directly, and whether to verify per block or per tier.

**Done when:** All 6 axes are resolved into an explicit Device Policy Profile with zero unconfirmed assumptions.

---

## Phase 2 — Live Forensic Package & Footprint Audit (Read-Only)

Consult [`references/adb-telemetry-commands.md`](references/adb-telemetry-commands.md) and [`references/containment-and-safety.md`](references/containment-and-safety.md) while classifying packages. When `ro.product.manufacturer` is `samsung`, also consult [`references/oem-notes-samsung.md`](references/oem-notes-samsung.md) for One UI-specific daemons and settings.

1. Measure live cost for candidates and suspicious preloads: resident RAM (`dumpsys meminfo`, `ps -A`), periodic or persisted jobs (`dumpsys jobscheduler`), Doze exemptions (`dumpsys deviceidle`), active notifications, and large `/data/app` bundles (`pm path`).
2. Inspect `dumpsys package <pkg>` for `codePath`, `sharedUser`, `User 0` `enabled=` state, `PERSISTENT` / `SYSTEM_FIXED` flags, and active providers/receivers.
3. Empirically verify non-obvious feature couplings on the live phone (`logcat`, providers, `dumpsys`) before recommending removal.

**Done when:** Every candidate package has observed RAM/disk/job footprint, `codePath`, `sharedUser`, `User 0` state, and verified dependency impact.

---

## Phase 3 — Risk-Tiered Action Plan & Approval Gates

Present proposed actions in reviewable blocks using one uniform table (`Package | Function | Live Footprint | Dependency Impact | Recommended Method`):

- **Tier A — Safe Zero-Dependency Bloat & Telemetry:** Commercial `/data/app` preloads, hidden social/carrier installers, OEM telemetry/diagnostic agents, legacy AOSP residue.
- **Tier B — Feature-Dependent Clusters (Explicit Tradeoffs):** Voice hotword/assistant services, Gallery background scanners, OEM Cloud/Push/Pass, offline language/AI packs, Gaming/Themes/Wallet, Continuity/BLE/Caller-ID helpers.
- **Tier C — OS-Coupled / Protected (Keep or Contain):** Account/auth frameworks, OEM stores/transfer agents, `uid=1000` protected packages, active viewers, required GMS sync/onboarding packages.
- **Tier S — System & Privacy Tuning + Deferred Lockdowns:** Virtual swap/RAM expansion, Cached Apps Freezer, animations, Private DNS, UWB/radios, clipboard alerts, ART `speed-profile`, setup-nudge suppression, and UI-only ADB-blocking lockdowns deferred last.

Obtain explicit user approval for each block before execution or handoff.

**Done when:** Every proposed block is either explicitly approved or intentionally excluded per the Device Policy Profile.

---

## Phase 4 — Incremental Verification & Mandatory Post-Reboot Audit

1. **Per-block verification (immediately after each applied block):** Confirm target `User 0: enabled=3` (strictly distinguished from `enabled=4`), process termination and RAM reclaimed, job purge, `0` lines in `logcat -b crash -d`, and user smoke tests of coupled features.
2. **Mandatory Post-Reboot Audit:** After all blocks and kernel/freezer settings are applied, cold-reboot the phone, wait for boot + User 0 unlock (`sys.boot_completed=1` and `sys.user.0.ce_available=true`), and verify:
   - Kernel swap resize (`SwapTotal` in `/proc/meminfo`) and active freezer state (`dumpsys activity`).
   - Any `PERSISTENT` disabled stubs that respawn idle on boot (`0` services, `0` jobs).
   - Standby buckets (`am get-standby-bucket`): catch Android's post-boot `reason=u-su` bucket promotion back to `10` and re-apply `restricted` (`45`) after unlock.
   - Validated Private DNS (`dumpsys connectivity`), empty setup/OEM nudge notification list (`cmd notification list`), and `0` crash lines.

**Done when:** Post-reboot verification reports expected package counts, zero crashes, persisted AppOps/standby buckets (`45`), validated DNS/kernel tuning, and zero unintended regressions.
