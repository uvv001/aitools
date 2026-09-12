---
name: network-dhcp-dns-audit
description: >-
  Audits local network DHCPv4 offers, ICMPv6 Router Advertisements, and dual-stack DNS resolution paths.
  Use when diagnosing rogue DHCP servers, DNS leaks, ad-blocking bypasses, or verifying authoritative DHCP/DNS migrations.
---

# Network DHCP & DNS Audit Guide

This runbook provides non-intrusive, verified procedures to audit local network DHCP delivery, ICMPv6 Router Advertisements, and dual-stack DNS resolution.

## 1. Authoritative DHCPv4 Discovery Probe

Use `nmap`'s broadcast DHCP discovery script to identify all DHCP servers offering IP leases on the broadcast domain.

```bash
sudo nmap --script broadcast-dhcp-discover -e <interface>
```

### Verification Criteria
- **Clean Single-Server Offer**: Expected `Response 1 of 1` identifying the target DHCP server IP.
- **Rogue / Multiple Offers**: If `Response 1 of 2` or multiple responses are received, multiple DHCP daemons are racing on the LAN.
- **Key Fields to Audit**:
  - `Server Identifier`: IP of the responding DHCP server.
  - `Domain Name Server`: Leased DNS resolvers (Option 6).
  - `Router`: Default gateway offered (Option 3).
  - `IP Offered`: Leased address from the server's configured pool.

## 2. ICMPv6 Router Advertisement (RA) & RDNSS Audit

Modern operating systems prioritize IPv6 over IPv4 (RFC 6724 / RFC 8305 "Happy Eyeballs"). Even if IPv4 DHCP points to a local DNS server (e.g. Pi-hole), routers continuously announce ISP IPv6 DNS resolvers via Layer 3 Router Advertisements.

Audit the live ICMPv6 announcements using `rdisc6`:

```bash
rdisc6 -1 -n <interface>
```

### Critical Fields to Inspect
- **`Stateful address conf.` (M Flag)**:
  - `No` (0): Router is NOT offering managed IPv6 address leases via DHCPv6.
  - `Yes` (1): Router runs stateful DHCPv6 (`IA_NA`).
- **`Stateful other conf.` (O Flag)**:
  - `Yes` (1): Router instructs clients to perform Stateless DHCPv6 (`Information-Request`) to obtain DNS resolvers (DHCPv6 Option 23).
- **`Recursive DNS server` (RFC 8106 RDNSS)**:
  - Captures any IPv6 DNS resolvers advertised directly in the ICMPv6 frame.
  - If ISP IPv6 addresses (`2607:...`, `2001:...`) appear here, dual-stack clients will aggregate them and leak queries directly to the ISP.
- **`Autonomous address conf.` (A Flag)**:
  - `Yes` (1): SLAAC address autoconfiguration is active for the advertised `/64` prefix.

## 3. Client Resolver State Inspection (systemd-resolved & NetworkManager)

Check what the operating system has actually accepted and installed into its resolver stack without packet sniffing:

### systemd-resolved
```bash
resolvectl status <interface>
```
Inspect:
- `Current DNS Server`: Active resolver for current lookups.
- `DNS Servers`: Aggregated list of all IPv4 and IPv6 resolvers learned across DHCP, RA, and manual overrides.
- `DNS Domain`: Default search domain (e.g., `lan`).

### NetworkManager Leases
Inspect unprivileged device lease caches directly:
```bash
cat /run/NetworkManager/devices/* 2>/dev/null
```
Look for:
- `[dhcp4]` section: `dhcp4.domain_name_servers`
- `[dhcp6]` section: `dhcp6.dhcp6_name_servers`

## 4. Dual-Stack Resolution & Ad-Block Verification

Directly test individual DNS resolvers to confirm ad-blocking sinkhole behavior vs. private split-horizon resolution:

### Test Ad-Blocking Sinkhole
```bash
dig @<target_dns_ip> flurry.com +short
```
- **Success (Blocked)**: Returns `0.0.0.0` or `::`.
- **Bypass (Leaking)**: Returns public WAN IP addresses.

### Test Split-Horizon Local Domain
```bash
dig @<target_dns_ip> <local_domain>
```
- **Success (Local Resolver)**: Returns internal LAN IP (e.g. `10.0.0.3`).
- **Failure (ISP Resolver)**: Returns `NXDOMAIN`.

## 5. Local Listening Socket Inspection

Verify that local DNS (port 53) and DHCP (port 67) daemons are bound properly and identify port collisions with host virtualization daemons (e.g., LXD or libvirt `dnsmasq`):

```bash
sudo ss -tulpn | grep -E ':(53|67)\b'
```

### Key Bindings
- Pi-hole / DNS server: Bound to `<host_ip>:53` and `127.0.0.1:53`.
- DHCP Server: Bound to `0.0.0.0%<interface>:67` via `SO_BINDTODEVICE` (prevents collision with `0.0.0.0%lxdbr0:67`).

## 6. Client-Side IPv6 Auto-DNS Suppression

When an ISP gateway refuses to stop advertising its upstream IPv6 DNS, configure client devices to ignore auto-configured IPv6 DNS while leaving native IPv6 routing and addressing fully functional:

### Linux (NetworkManager)
```bash
nmcli connection modify "<connection-name>" ipv6.ignore-auto-dns yes
nmcli connection up "<connection-name>"
```

### Linux (systemd-resolved runtime override)
```bash
resolvectl dns <interface> <local_ipv4_dns>
```

### macOS
```bash
networksetup -setdnsservers "Wi-Fi" <local_ipv4_dns>
```

### Windows (PowerShell)
```powershell
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("<local_ipv4_dns>")
```
