# Changelog

Alle wichtigen Änderungen an dieser Extension werden hier dokumentiert.

## [0.1.0] - 2024-12-10

### Neu
- **DNS Management (IONOS)**
  - Domain-Liste mit allen DNS-Records
  - Quick Edit für Records (Inline-Bearbeitung)
  - TTL Toggle (60s für Migrationen, 3600s für Normal)
  - DNS Propagation Check (Google, Cloudflare, Quad9)
  
- **Server Management (Hetzner Cloud)**
  - Server-Liste mit Status-Anzeige
  - Power Control (Reboot, PowerOn, PowerOff, Hard Reset)
  - Rescue Mode aktivieren (mit automatischem Passwort-Copy)
  - Snapshot erstellen
  - SSH Terminal öffnen
  - Web Console Link

- **Bridge Features**
  - DevOps Clipboard für IP-Transfer zwischen Providern
  - "Update A-Record from Clipboard" Workflow

- **Sicherheit**
  - Read-Only Modus über Einstellung
  - Bestätigungsdialoge für destruktive Aktionen
  - Sichere Token-Speicherung im VS Code SecretStorage
  - Token Clear Commands

- **Entwickler-Experience**
  - Einheitliches Logging mit Output-Panel
  - Caching für API-Responses (30s default)
  - Typsichere Error-Handling mit Custom Error Classes

## [0.0.1] - 2024-12-10

### Initial Release
- Grundlegende Projektstruktur
- Provider-Manager Architektur
- Erste Tree Views für Domains und Server
