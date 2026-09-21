# Review — skills/network-dhcp-dns-audit

Round 1, 2026-09-18 10:37 (local). Read-only instruction review of
`skills/network-dhcp-dns-audit/SKILL.md` (the directory's only file, 126 lines).

**Reviewed state**

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/network-dhcp-dns-audit` → *(no output — path clean, file matches HEAD)*
- Report location: `.ai/reviews/` (git-ignored via `.gitignore:1:/.ai/`), not committed.

**Scope** — correctness and completeness of the instructions: followability,
branch/exit-criteria completeness, internal consistency, and fidelity of the
referenced commands and their documented output. Prose style and formatting are
out of scope. No command was executed against any network.

**Self-sufficiency rule (root `AGENTS.md`)** — checked and clean: `SKILL.md`
contains no reference to any file outside its own directory, so nothing violates
"reference only files inside its own directory".

**External sources used for verification** — nmap NSE doc for
`broadcast-dhcp-discover`; `rdisc6(8)` man page (Debian bookworm, ndisc6);
NetworkManager source `src/core/nm-config.c` (`nm_config_device_state_write`);
Microsoft Learn `Set-DnsClientServerAddress`.

## Dashboard

**Fix progress** — 0 🔧 fixed / 0 approved awaiting a fix.

**Triage state** — 20 findings total: 19 ⏳ awaiting triage, 1 ❓ unverified
(awaiting the user's call), 0 ✅, 0 🔧, 0 ❌, 0 📌, 0 🔀.

| Severity | Count |
|---|---|
| 🔴 High | 3 |
| 🟡 Medium | 13 |
| ⚪ Low | 3 |
| ❓ Unverified | 1 |

## Summary

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: `skills/network-dhcp-dns-audit/SKILL.md:10`, `:103-126`, `:4`<br>State: ⏳ Awaiting triage<br>The runbook declares itself "non-intrusive" and is advertised as an audit, but section 6 applies persistent client configuration changes with no approval gate. |
| F2 | Severity: 🔴 High<br>File: `skills/network-dhcp-dns-audit/SKILL.md:36`<br>State: ⏳ Awaiting triage<br>`rdisc6 -1` exits on the first Router Advertisement, so a second/rogue router's RDNSS is never seen — the opposite of the multi-responder detection section 1 performs. |
| F3 | Severity: 🔴 High<br>File: `skills/network-dhcp-dns-audit/SKILL.md:79-82`<br>State: ⏳ Awaiting triage<br>The "dual-stack" sinkhole test never queries AAAA, so the documented success value `::` can never appear and an IPv6-only block failure is undetectable. |
| F4 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:81-82`, `:88-89`<br>State: ⏳ Awaiting triage<br>Both section 4 tests define two outcomes each, leaving empty answers, SERVFAIL and timeouts without a defined verdict. |
| F5 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:79`<br>State: ⏳ Awaiting triage<br>`flurry.com` is hardcoded with no step to confirm it is on the active blocklist, so a healthy sinkhole can be reported as "Bypass (Leaking)". |
| F6 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:75`, `:79`, `:86-89`<br>State: ⏳ Awaiting triage<br>Section 4 never says which resolvers to test or that they come from sections 1 and 3, and its verdict labels presuppose which resolver was queried. |
| F7 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:20-22`, `:39`, `:99-101`<br>State: ⏳ Awaiting triage<br>The "no response / no output" outcome is undefined in sections 1, 2 and 5, although all three commands can legitimately produce it. |
| F8 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:40-49`<br>State: ⏳ Awaiting triage<br>The RA flag table omits the O-flag `No` branch and the A-flag `No` branch, and the M/O `Yes` branches lead to no follow-up audit step. |
| F9 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:47`<br>State: ⏳ Awaiting triage<br>Classifying an RDNSS entry as "ISP" by the `2607:`/`2001:` prefix is not a checkable test; both are ordinary global-unicast ranges. |
| F10 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:65-71`<br>State: ⏳ Awaiting triage<br>`cat /run/NetworkManager/devices/* 2>/dev/null` concatenates per-ifindex files with no device marker and suppresses every error, so `[dhcp4]` sections cannot be attributed and "empty" is ambiguous. |
| F11 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:17`, `:36`, `:57`, `:79`, `:86`, `:100`, `:109`, `:115`<br>State: ⏳ Awaiting triage<br>Six placeholders are used and none is defined or given a discovery command; `<local_domain>` in particular has no stated form. |
| F12 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:17`, `:36`, `:96`, `:109`, `:120`, `:125`<br>State: ⏳ Awaiting triage<br>Privilege requirements are shown inconsistently: `sudo` on two commands, none on `rdisc6`, `nmcli`, `networksetup` or `Set-DnsClientServerAddress`, which also need elevation. |
| F13 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:10`, `:14`, `:33`, `:51`<br>State: ⏳ Awaiting triage<br>No preconditions: sections 1–5 silently assume Linux plus nmap, ndisc6, dig, iproute2, systemd-resolved and NetworkManager, with no "not installed / not applicable" branch. |
| F14 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:10`, `:126`<br>State: ⏳ Awaiting triage<br>No entry conditions, no section ordering, no completion criterion, no result artifact, and no verification step after the section 6 changes. |
| F15 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:93`, `:99-101`<br>State: ⏳ Awaiting triage<br>Section 5 states expected bindings as fact, defines no criterion for what counts as a collision, and gives no action when one is found. |
| F16 | Severity: 🟡 Medium<br>File: `skills/network-dhcp-dns-audit/SKILL.md:105-116`<br>State: ⏳ Awaiting triage<br>Section 6 offers two Linux variants with no selection rule, does not say the `resolvectl` one is transient, and does not warn that `nmcli connection up` drops the link. |
| F17 | Severity: ❓ Unverified<br>File: `skills/network-dhcp-dns-audit/SKILL.md:123-125`<br>State: ❓ Unverified — awaiting triage<br>Whether an IPv4-only `-ServerAddresses` list clears the interface's RA/DHCPv6-learned IPv6 resolvers is undocumented; if it does not, the Windows step does not achieve the section's stated goal. |
| F18 | Severity: ⚪ Low<br>File: `skills/network-dhcp-dns-audit/SKILL.md:79`, `:100`, `:115`, `:120`, `:125`<br>State: ⏳ Awaiting triage<br>The same value appears as `<target_dns_ip>`, `<host_ip>` and `<local_ipv4_dns>`, while macOS and Windows hardcode the interface as `"Wi-Fi"`. |
| F19 | Severity: ⚪ Low<br>File: `skills/network-dhcp-dns-audit/SKILL.md:36`<br>State: ⏳ Awaiting triage<br>`-n` is inert in `rdisc6 -1 -n <interface>`: it only suppresses hostname resolution of the optional target-address argument, which is not supplied. |
| F20 | Severity: ⚪ Low<br>File: `skills/network-dhcp-dns-audit/SKILL.md:31`<br>State: ⏳ Awaiting triage<br>RFC 6724 / RFC 8305 govern destination-address selection and connection racing, not resolver choice, so the stated rationale does not support the conclusion. |

## Findings

### ⏳ 🔴 F1 — "Non-intrusive audit" framing contradicts section 6, which changes client configuration

<details open>
<summary>Description</summary>

`SKILL.md:10` scopes the whole document as read-only inspection:

> `This runbook provides non-intrusive, verified procedures to audit local network DHCP delivery, ICMPv6 Router Advertisements, and dual-stack DNS resolution.`

The frontmatter agrees — `SKILL.md:4-5`:

> `Audits local network DHCPv4 offers, ICMPv6 Router Advertisements, and dual-stack DNS resolution paths.`
> `Use when diagnosing rogue DHCP servers, DNS leaks, ad-blocking bypasses, or verifying authoritative DHCP/DNS migrations.`

Section 6 (`SKILL.md:103-126`) is remediation, not audit, and it writes persistent
state — `SKILL.md:109-110`:

> ````
> nmcli connection modify "<connection-name>" ipv6.ignore-auto-dns yes
> nmcli connection up "<connection-name>"
> ````

Nothing marks section 6 as state-changing or gates it behind user approval, and
it carries the same numbering as the inspection sections, so an agent invoked to
"audit" will read it as the next step of the same procedure and reconfigure the
user's machine.

Suggested fix: restrict the "non-intrusive" claim on line 10 to sections 1–5, retitle
section 6 as remediation, and open it with an explicit gate (state-changing, requires
user confirmation, and a rollback command — `nmcli connection modify … ipv6.ignore-auto-dns no`
or `Set-DnsClientServerAddress -ResetServerAddresses`).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High · `SKILL.md:10`, `:4-5`, `:103-126`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🔴 F2 — `rdisc6 -1` stops at the first Router Advertisement, hiding additional routers

<details open>
<summary>Description</summary>

`SKILL.md:36`:

> ````
> rdisc6 -1 -n <interface>
> ````

`rdisc6(8)` (Debian bookworm, ndisc6) documents the two options as:

> **-1** or **--single** — Exit as soon as the first advertisement is received.
> **-m** or **--multiple** — Wait for possible multiple advertisements and print all of them (default).

The skill's own premise is that several devices may answer on the same segment —
`SKILL.md:22`:

> `- **Rogue / Multiple Offers**: If \`Response 1 of 2\` or multiple responses are received, multiple DHCP daemons are racing on the LAN.`

With `-1`, the audit records whichever router answers first and terminates. If a
second router (an ISP CPE alongside a local router, or a rogue RA source) is the
one advertising ISP `Recursive DNS server` entries, the run reports a clean result
and the leak described at `SKILL.md:47` is missed.

Suggested fix: drop `-1` (the default `-m` prints all advertisements) or state explicitly
that `-1` is only for a single-router segment and that rogue-RA detection requires the
multiple-advertisement mode.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High · `SKILL.md:36`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1; verified against the `rdisc6(8)` man page (manpages.debian.org, bookworm/ndisc6).
</details>

### ⏳ 🔴 F3 — Section 4 claims a dual-stack check but only queries A records, so `::` can never be observed

<details open>
<summary>Description</summary>

`SKILL.md:73` titles the section:

> `## 4. Dual-Stack Resolution & Ad-Block Verification`

`SKILL.md:79-82`:

> ````
> dig @<target_dns_ip> flurry.com +short
> ````
> `- **Success (Blocked)**: Returns \`0.0.0.0\` or \`::\`.`
> `- **Bypass (Leaking)**: Returns public WAN IP addresses.`

`dig` defaults to query type `A` when no type is given, so this command returns
IPv4 answers only. The documented success value `::` is the AAAA sinkhole answer
and cannot appear in this output — the criterion as written is unreachable.

The consequence is not cosmetic: the skill exists to catch IPv6 DNS leaks
(`SKILL.md:31`, `:47`), yet the verification step never asks the resolver for an
AAAA record, so a resolver that blocks A but returns a real AAAA — or an IPv6
resolver reached over IPv6 — passes the check.

Suggested fix: run both `dig @<target_dns_ip> flurry.com A +short` and
`dig @<target_dns_ip> flurry.com AAAA +short`, and attach `0.0.0.0` to the A result
and `::` to the AAAA result; repeat against each IPv6 resolver found in sections 2–3.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High · `SKILL.md:73`, `:79-82`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F4 — Section 4 outcome lists are not exhaustive

<details open>
<summary>Description</summary>

`SKILL.md:81-82`:

> `- **Success (Blocked)**: Returns \`0.0.0.0\` or \`::\`.`
> `- **Bypass (Leaking)**: Returns public WAN IP addresses.`

`SKILL.md:88-89`:

> `- **Success (Local Resolver)**: Returns internal LAN IP (e.g. \`10.0.0.3\`).`
> `- **Failure (ISP Resolver)**: Returns \`NXDOMAIN\`.`

Neither list covers outcomes the commands routinely produce:

- empty stdout from `+short` — the resolver blocks in NXDOMAIN or NODATA mode
  (Pi-hole's non-NULL blocking modes), which is a *pass*, not a bypass;
- `;; connection timed out; no servers could be reached` — the resolver is
  unreachable or filtered, so no verdict about blocking is possible;
- `SERVFAIL` / `REFUSED` — the resolver refuses queries from this client.

An agent following the two bullets must either invent a verdict or force the
result into the wrong branch.

Suggested fix: add explicit branches for empty answer, NXDOMAIN/NODATA, SERVFAIL/REFUSED
and timeout to both tests, stating for each whether it is a pass, a fail, or an inconclusive
result that halts the section.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:81-82`, `:88-89`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F5 — The sinkhole probe domain is assumed to be on the active blocklist

<details open>
<summary>Description</summary>

`SKILL.md:79`:

> ````
> dig @<target_dns_ip> flurry.com +short
> ````

The verdict at `SKILL.md:82` — "**Bypass (Leaking)**: Returns public WAN IP
addresses" — is only valid if `flurry.com` is on the blocklist the audited
resolver actually loaded. Blocklist contents vary per install (and many lists
carry subdomains such as `data.flurry.com` rather than the apex), so a correctly
configured sinkhole that simply does not list this domain is reported as leaking.

Suggested fix: instruct the agent to pick a domain confirmed present on the running
resolver's blocklist (for example via the resolver's own query/lookup interface), or to
first establish a baseline — one domain known to be blocked and one known to be allowed —
before interpreting the result.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:79`, `:82`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F6 — Section 4 never says which resolvers to test, and its labels presuppose the answer

<details open>
<summary>Description</summary>

`SKILL.md:75`:

> `Directly test individual DNS resolvers to confirm ad-blocking sinkhole behavior vs. private split-horizon resolution:`

The commands take an arbitrary `<target_dns_ip>` (`SKILL.md:79`, `:86`), but no
step states where that value comes from, how many resolvers to test, or that the
candidate set is exactly what sections 1–3 enumerate (`Domain Name Server` at
`SKILL.md:25`, `Recursive DNS server` at `SKILL.md:45`, `DNS Servers` at
`SKILL.md:61`). Sections 1–5 are presented as independent blocks with no data flow
between them.

The verdict labels then assume a fact the command cannot know — `SKILL.md:88-89`:

> `- **Success (Local Resolver)**: Returns internal LAN IP (e.g. \`10.0.0.3\`).`
> `- **Failure (ISP Resolver)**: Returns \`NXDOMAIN\`.`

The parenthetical names describe *which resolver was queried*, not the outcome. If
the agent points the command at the local Pi-hole and receives NXDOMAIN (missing
local record, wrong domain form), the table tells it the answer came from an "ISP
Resolver", which is false.

Suggested fix: state that section 4 runs once per resolver collected in sections 1–3,
name that input explicitly, and relabel the outcomes by observation ("returns LAN address"
/ "returns NXDOMAIN") with the conclusion drawn from which resolver was queried.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:75`, `:79`, `:86-89`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F7 — The "nothing answered" outcome is undefined in sections 1, 2 and 5

<details open>
<summary>Description</summary>

Section 1 — `SKILL.md:20-22` lists only single-offer and multi-offer results:

> `### Verification Criteria`
> `- **Clean Single-Server Offer**: Expected \`Response 1 of 1\` identifying the target DHCP server IP.`
> `- **Rogue / Multiple Offers**: If \`Response 1 of 2\` or multiple responses are received, multiple DHCP daemons are racing on the LAN.`

The nmap NSE documentation for `broadcast-dhcp-discover` states: "If no response
has been received before the timeout has been reached (default 10 seconds) the
script will abort execution." Zero offers is a meaningful audit result (relay-only
segment, filtered broadcast, wrong interface) and has no branch.

Section 2 — `SKILL.md:39` opens the field list with no prior branch for a silent
link:

> `### Critical Fields to Inspect`

`rdisc6(8)`: "If **rdisc6** does not receive any response after the specified
number of attempts … it will exit with code 2." No RA at all (IPv6 disabled
upstream, RA guard) is undefined.

Section 5 — `SKILL.md:99-101` lists only the expected bindings, so an empty grep
result (daemon down, socket bound elsewhere) has no defined reading.

Suggested fix: give each of the three sections an explicit "no response / no output"
branch stating what it means and what to check next (interface selection, firewall,
service state).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:20-22`, `:39`, `:99-101`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1; timeout behaviour verified in the nmap NSE doc, exit code 2 in `rdisc6(8)`.
</details>

### ⏳ 🟡 F8 — RA flag table defines one branch per flag and none of them leads anywhere

<details open>
<summary>Description</summary>

`SKILL.md:40-49`:

> `- **\`Stateful address conf.\` (M Flag)**:`
> `  - \`No\` (0): Router is NOT offering managed IPv6 address leases via DHCPv6.`
> `  - \`Yes\` (1): Router runs stateful DHCPv6 (\`IA_NA\`).`
> `- **\`Stateful other conf.\` (O Flag)**:`
> `  - \`Yes\` (1): Router instructs clients to perform Stateless DHCPv6 (\`Information-Request\`) to obtain DNS resolvers (DHCPv6 Option 23).`
> …
> `- **\`Autonomous address conf.\` (A Flag)**:`
> `  - \`Yes\` (1): SLAAC address autoconfiguration is active for the advertised \`/64\` prefix.`

Two gaps:

1. The O flag and the A flag list only the `Yes` value; `rdisc6` always prints
   both flags, so the agent reaches an observed `No` with no documented meaning.
2. Every branch is terminal. `O = Yes` says DNS resolvers arrive over Stateless
   DHCPv6 — i.e. they are *not* in the RA — yet no step tells the agent how to
   inspect what DHCPv6 Option 23 delivered. Section 3 happens to surface the
   accepted result (`SKILL.md:71`, `dhcp6.dhcp6_name_servers`), but nothing links
   the branch to it. `M = Yes` is likewise a dead end.

Suggested fix: complete both flag tables with their `No` rows, and give the `Yes` rows a
next action — for `O = Yes` / `M = Yes`, point explicitly at the section 3 checks
(`resolvectl status`, `dhcp6.dhcp6_name_servers`) as the way to read the DHCPv6-supplied
resolvers.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:40-49`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1; field names confirmed against `rdisc6` documented output.
</details>

### ⏳ 🟡 F9 — "ISP IPv6 address" is identified by a prefix heuristic that does not hold

<details open>
<summary>Description</summary>

`SKILL.md:47`:

> `  - If ISP IPv6 addresses (\`2607:...\`, \`2001:...\`) appear here, dual-stack clients will aggregate them and leak queries directly to the ISP.`

`2001::/16` and `2607::/16` are ordinary global-unicast allocations, not ISP
markers: `2001:4860:4860::8888` is Google Public DNS, `2001:db8::/32` is the
documentation range, and an ISP's resolver may sit in any other `2xxx::/16`. A
locally operated resolver reachable on a global address in the same ranges would
be flagged as a leak, while an ISP resolver in an unlisted range would pass.

The second half of the sentence is also asserted unconditionally ("will aggregate
them and leak"), although whether the client accepts RDNSS depends on its
configuration — exactly what section 6 changes.

Suggested fix: replace the prefix test with a check the agent can actually evaluate — any
`Recursive DNS server` entry that is not the intended local resolver address is a finding —
and phrase the consequence as conditional on the client accepting RA-supplied DNS, verified
in section 3.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:47`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F10 — The NetworkManager lease dump loses device attribution and hides its own errors

<details open>
<summary>Description</summary>

`SKILL.md:65-71`:

> `Inspect unprivileged device lease caches directly:`
> ````
> cat /run/NetworkManager/devices/* 2>/dev/null
> ````
> `Look for:`
> `- \`[dhcp4]\` section: \`dhcp4.domain_name_servers\``
> `- \`[dhcp6]\` section: \`dhcp6.dhcp6_name_servers\``

The section names and key names are correct — NetworkManager's
`nm_config_device_state_write` (`src/core/nm-config.c`) writes
`name_full = g_strdup_printf("%s.%s", prefix, values[i].name)` into the group
`prefix`, which is `"dhcp4"` or `"dhcp6"`. Two problems remain:

1. Each file is named by ifindex (`nm_sprintf_buf(path, "%s/%d", NM_CONFIG_DEVICE_STATE_DIR, ifindex)`),
   and the `[device]` group holds no interface name (only `managed`,
   `perm-hw-addr-fake`, `connection-uuid`, `nm-owned`, route metrics, `next-server`,
   `root-path`, `dhcp-bootfile`). `cat` of a glob discards the filenames, so on a
   host with several devices — precisely the LXD/libvirt scenario section 5
   anticipates — the agent cannot tell which `[dhcp4]` block belongs to the audited
   interface, and both blocks carry identically named keys.
2. `2>/dev/null` swallows every error, so "NetworkManager is not installed",
   "directory unreadable" and "device has no DHCP lease" all present as empty
   output, which section 3 does not interpret.

Suggested fix: use a per-file form that keeps the identity (for example `grep -H … /run/NetworkManager/devices/*`
or a `for f in …; do echo "$f"; cat "$f"; done` loop) plus the ifindex→name mapping,
and drop or interpret the error suppression.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:65-71`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1; group/key naming and per-ifindex filename verified in NetworkManager `src/core/nm-config.c` (`nm_config_device_state_write`), so the key names themselves are **not** a finding.
</details>

### ⏳ 🟡 F11 — Placeholders are never defined and no step produces their values

<details open>
<summary>Description</summary>

Six distinct placeholders appear in commands with no definition section and no
discovery step:

> `SKILL.md:17` — `sudo nmap --script broadcast-dhcp-discover -e <interface>`
> `SKILL.md:36` — `rdisc6 -1 -n <interface>`
> `SKILL.md:57` — `resolvectl status <interface>`
> `SKILL.md:79` — `dig @<target_dns_ip> flurry.com +short`
> `SKILL.md:86` — `dig @<target_dns_ip> <local_domain>`
> `SKILL.md:100` — `- Pi-hole / DNS server: Bound to \`<host_ip>:53\` and \`127.0.0.1:53\`.`
> `SKILL.md:109` — `nmcli connection modify "<connection-name>" ipv6.ignore-auto-dns yes`
> `SKILL.md:115` — `resolvectl dns <interface> <local_ipv4_dns>`

`<local_domain>` is the worst case: no form is given, and the choice changes the
expected result — a bare zone such as `lan` usually has no A record even on the
local resolver, whereas `host.lan` does, so `SKILL.md:88` ("Returns internal LAN
IP") only holds for one reading.

Suggested fix: add a short "Inputs" block ahead of section 1 defining each placeholder and
the command that resolves it (`ip route get 1.1.1.1` or `nmcli device status` for the
interface, `nmcli connection show` for the connection name, an FQDN example for
`<local_domain>`).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:17`, `:36`, `:57`, `:79`, `:86`, `:100`, `:109`, `:115`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F12 — Privilege requirements are stated inconsistently

<details open>
<summary>Description</summary>

Two commands carry `sudo`:

> `SKILL.md:17` — `sudo nmap --script broadcast-dhcp-discover -e <interface>`
> `SKILL.md:96` — `sudo ss -tulpn | grep -E ':(53|67)\b'`

Four others need elevation and do not show it:

> `SKILL.md:36` — `rdisc6 -1 -n <interface>`
> `SKILL.md:109` — `nmcli connection modify "<connection-name>" ipv6.ignore-auto-dns yes`
> `SKILL.md:120` — `networksetup -setdnsservers "Wi-Fi" <local_ipv4_dns>`
> `SKILL.md:125` — `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("<local_ipv4_dns>")`

`rdisc6(8)` states under SECURITY: "**rdisc6** must be _setuidroot_ to allow use by
non privileged users." Where the distribution does not ship it setuid, the command
fails on the raw socket and the agent has no documented recovery. `nmcli connection
modify` needs root or a polkit authorisation — under an unattended agent a polkit
prompt blocks; `networksetup -setdnsservers` and `Set-DnsClientServerAddress`
require admin/elevated sessions.

Suggested fix: state the privilege requirement once per command (or in a preconditions
block), including the "run elevated / non-interactive polkit will fail" note, and give the
expected failure text so the agent can recognise it.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:17`, `:36`, `:96`, `:109`, `:120`, `:125`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1; `rdisc6` privilege requirement quoted from the `rdisc6(8)` SECURITY section.
</details>

### ⏳ 🟡 F13 — No platform or tooling preconditions, and no branch when a tool is absent

<details open>
<summary>Description</summary>

`SKILL.md:10` introduces the runbook without any statement of applicability:

> `This runbook provides non-intrusive, verified procedures to audit local network DHCP delivery, ICMPv6 Router Advertisements, and dual-stack DNS resolution.`

Sections 1–5 then require, without saying so, a Linux host plus `nmap` with the
NSE scripts, `ndisc6`, `dig` (bind-utils/dnsutils), `ss` (iproute2),
`systemd-resolved` and `NetworkManager`:

> `SKILL.md:14` — `Use \`nmap\`'s broadcast DHCP discovery script …`
> `SKILL.md:33` — `Audit the live ICMPv6 announcements using \`rdisc6\`:`
> `SKILL.md:51` — `## 3. Client Resolver State Inspection (systemd-resolved & NetworkManager)`

Section 6 covers macOS and Windows (`SKILL.md:118-126`), which contradicts the
implied Linux-only scope and leaves an agent on macOS/Windows with no defined way
to perform sections 1–5. Hosts using `resolv.conf`/`dnsmasq` instead of
systemd-resolved, or `systemd-networkd` instead of NetworkManager, have no
alternative path either — and no instruction says a section may be skipped.

Suggested fix: add a preconditions block naming the required OS and packages with the
check command for each, and state for every section what to do when its tool or stack is
absent (skip and record, or use a named alternative).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:10`, `:14`, `:33`, `:51`, `:118-126`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F14 — No entry conditions, no ordering, no completion criterion, no verification of applied changes

<details open>
<summary>Description</summary>

The document states its subject at `SKILL.md:10` and then runs six numbered
sections to its last line, `SKILL.md:126`:

> ````
> Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("<local_ipv4_dns>")
> ````

Nothing follows. There is no "Ready when" (or equivalent) criterion, so an agent
cannot decide when the audit is finished; no statement of whether the sections are
a sequence or a menu; no mapping from the four triggers in the frontmatter
(`SKILL.md:5`: rogue DHCP servers, DNS leaks, ad-blocking bypasses, migration
verification) to the sections that serve each one; and no required output — the
skill never says to record findings, in what form, or what constitutes a pass.

Section 6 in particular ends without a verification step: after changing client
configuration, nothing instructs the agent to re-run `resolvectl status
<interface>` (`SKILL.md:57`) and confirm the ISP IPv6 resolvers are gone from
`DNS Servers` (`SKILL.md:61`).

Suggested fix: add (a) a trigger→section map, (b) a stated order with which sections are
mandatory, (c) a closing "Ready when" listing the checkable conditions and the summary the
agent must produce, and (d) a post-change re-check at the end of section 6.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:5`, `:10`, `:126`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F15 — Section 5 asserts expected bindings, defines no collision test and no action

<details open>
<summary>Description</summary>

`SKILL.md:93`:

> `Verify that local DNS (port 53) and DHCP (port 67) daemons are bound properly and identify port collisions with host virtualization daemons (e.g., LXD or libvirt \`dnsmasq\`):`

`SKILL.md:99-101`:

> `### Key Bindings`
> `- Pi-hole / DNS server: Bound to \`<host_ip>:53\` and \`127.0.0.1:53\`.`
> `- DHCP Server: Bound to \`0.0.0.0%<interface>:67\` via \`SO_BINDTODEVICE\` (prevents collision with \`0.0.0.0%lxdbr0:67\`).`

These are written as facts about the environment, not as a criterion:

- A default Pi-hole/dnsmasq install listens on `0.0.0.0:53` (wildcard) unless
  `bind-interfaces`/`interface=` is configured, so the very common wildcard result
  matches neither bullet and has no interpretation.
- "identify port collisions" is never operationalised: the section does not say
  what output pattern *is* a collision (two processes, one wildcard socket plus a
  device-bound socket, a `dnsmasq` on `lxdbr0`), so the agent has no test.
- No outcome is defined for a collision that is found — no remediation, no
  escalation, no pointer to another section.

Suggested fix: restate the bullets as "expected vs. suspicious" patterns including the
wildcard `0.0.0.0:53` case, define the collision condition explicitly in terms of the `ss`
output columns, and state the action for each verdict.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:93`, `:99-101`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F16 — Section 6 gives four variants with no selection rule, no persistence note and no disruption warning

<details open>
<summary>Description</summary>

`SKILL.md:105`:

> `When an ISP gateway refuses to stop advertising its upstream IPv6 DNS, configure client devices to ignore auto-configured IPv6 DNS while leaving native IPv6 routing and addressing fully functional:`

`SKILL.md:107-116` then offers two Linux variants:

> `### Linux (NetworkManager)`
> ````
> nmcli connection modify "<connection-name>" ipv6.ignore-auto-dns yes
> nmcli connection up "<connection-name>"
> ````
> `### Linux (systemd-resolved runtime override)`
> ````
> resolvectl dns <interface> <local_ipv4_dns>
> ````

Three gaps:

1. No rule says which Linux variant applies. On an NM-managed host both commands
   are runnable and they act at different layers; on a `systemd-networkd` host only
   the second exists. The agent must guess.
2. The `resolvectl` variant is labelled "runtime override" but the document never
   states the consequence — the setting is lost on link down/up or on the next
   reconfiguration, so it does not deliver the persistent suppression the section
   promises at line 105. `ipv6.ignore-auto-dns` does.
3. `nmcli connection up` re-activates the connection, which drops the link
   momentarily. Nothing warns that this interrupts connectivity and will terminate
   an SSH session running over the audited interface — a realistic way for this
   step to leave the host half-configured and unreachable.

Suggested fix: add a selection rule (NetworkManager-managed → variant 1; otherwise variant
2), mark variant 2 as non-persistent with the condition that reverts it, and warn that
`nmcli connection up` bounces the link.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium · `SKILL.md:105-116`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ❓ F17 — Windows step may not remove the RA/DHCPv6-learned IPv6 resolvers it is meant to suppress

<details open>
<summary>Description</summary>

`SKILL.md:105` states the goal:

> `… configure client devices to ignore auto-configured IPv6 DNS while leaving native IPv6 routing and addressing fully functional:`

`SKILL.md:123-125`:

> `### Windows (PowerShell)`
> ````
> Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("<local_ipv4_dns>")
> ````

Windows stores DNS server lists per interface *and per address family*
(`Get-DnsClientServerAddress` reports IPv4 and IPv6 rows separately). The command
supplies IPv4 addresses only. If the cmdlet sets the IPv4 list and leaves the IPv6
list as-is, the RA/DHCPv6-supplied IPv6 resolvers stay configured and the leak the
section exists to close remains open.

**What was tried:** read the Microsoft Learn reference for
`Set-DnsClientServerAddress` (windowsserver2025-ps). It states only "This cmdlet
statically adds DNS server addresses to the interface. If this cmdlet is used to
add DNS servers to the interface, then the DNS servers will override any DHCP
configuration for that interface" — with no statement about per-family behaviour,
and no example mixing families. A web search returned a confident but
unsourced claim that the IPv6 list is emptied; I could not confirm it against
Microsoft documentation, and no Windows host with RA-supplied IPv6 DNS was
available (running the command would also be a state change, out of scope for this
review).

**What would settle it:** on a Windows host receiving RDNSS/DHCPv6 DNS, run
`Get-DnsClientServerAddress -InterfaceAlias "Wi-Fi"`, apply the command, and re-run
it — if the `IPv6` row still lists the router-supplied resolvers, the instruction
is incomplete and needs an explicit IPv6 clause (for example including the local
resolver's IPv6 address in `-ServerAddresses`, or
`netsh interface ipv6 set dnsservers … static … primary`).
</details>

<details>
<summary>Status</summary>

❓ Unverified — awaiting the user's call · Severity ❓ (would be 🔴 if confirmed) · `SKILL.md:105`, `:123-125`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1 as unverified; Microsoft Learn reference read, per-family behaviour undocumented.
</details>

### ⏳ ⚪ F18 — Three names for the same value, and hardcoded interface names in two variants

<details open>
<summary>Description</summary>

The local resolver's IPv4 address appears under three different placeholder names:

> `SKILL.md:79` — `dig @<target_dns_ip> flurry.com +short`
> `SKILL.md:100` — `- Pi-hole / DNS server: Bound to \`<host_ip>:53\` and \`127.0.0.1:53\`.`
> `SKILL.md:115` — `resolvectl dns <interface> <local_ipv4_dns>`

An agent cannot tell whether these denote the same value or three different ones.

Section 6 is also inconsistent about interfaces: Linux uses placeholders while
macOS and Windows hardcode `"Wi-Fi"`:

> `SKILL.md:120` — `networksetup -setdnsservers "Wi-Fi" <local_ipv4_dns>`
> `SKILL.md:125` — `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("<local_ipv4_dns>")`

On a wired Mac or PC the literal `"Wi-Fi"` is the wrong service/alias and the
command fails; no step points at `networksetup -listallnetworkservices` or
`Get-NetAdapter` to obtain the right name.

Suggested fix: use one name per value throughout, and replace the hardcoded `"Wi-Fi"` with
a placeholder plus the enumeration command for each platform.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low · `SKILL.md:79`, `:100`, `:115`, `:120`, `:125`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ ⚪ F19 — `-n` has no effect in the given `rdisc6` invocation

<details open>
<summary>Description</summary>

`SKILL.md:36`:

> ````
> rdisc6 -1 -n <interface>
> ````

`rdisc6(8)` defines the flag as: "**-n** or **--numeric** — If the optional
parameter is not a valid IPv6 address, do not try to resolve it as a DNS
hostname." The optional parameter is the target address argument, which this
invocation does not supply, so `-n` changes nothing here. It reads as if it
forced numeric output, which it does not.

Suggested fix: drop `-n`, or state what it actually governs so the flag is not copied into
other invocations under a wrong assumption.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low · `SKILL.md:36`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1; definition quoted from `rdisc6(8)` (Debian bookworm).
</details>

### ⏳ ⚪ F20 — RFC 6724 / RFC 8305 do not govern resolver selection

<details open>
<summary>Description</summary>

`SKILL.md:31`:

> `Modern operating systems prioritize IPv6 over IPv4 (RFC 6724 / RFC 8305 "Happy Eyeballs"). Even if IPv4 DHCP points to a local DNS server (e.g. Pi-hole), routers continuously announce ISP IPv6 DNS resolvers via Layer 3 Router Advertisements.`

RFC 6724 is default *destination/source address* selection and RFC 8305 races
connection attempts across families — neither decides which DNS server a stub
resolver queries; that is resolver-implementation behaviour (glibc,
systemd-resolved, NetworkManager ordering). The citation therefore does not
support the conclusion the section draws, and "routers continuously announce ISP
IPv6 DNS resolvers" is stated as universal when it is the specific misconfiguration
being hunted.

Suggested fix: attribute the behaviour to the resolver stack's server ordering (which
section 3 actually observes) and phrase the router claim as the hypothesis under test.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low · `SKILL.md:31`
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

## Resolved and discarded

*(none yet — no finding has been fixed or discarded)*
