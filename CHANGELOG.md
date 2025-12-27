# Changelog

Alle wichtigen Änderungen an dieser Extension werden hier dokumentiert.

## [0.5.0] - 2024-12-27

### Neu
- **Subdomains deutlicher dargestellt**
  - Subdomains werden mit 🔹 markiert und farblich hervorgehoben
  - Vollständiger Subdomain-Name (z.B. www.example.com) in Tree View und DevOps Map
  - Unterschiedliche Icons für Root-Records (@) und Subdomains

- **Hetzner SSH Keys Integration**
  - Neue Kategorie "SSH Keys" unter jedem Hetzner Account
  - Liste aller SSH Keys mit Fingerprint
  - SSH Keys erstellen und löschen (API-Unterstützung)

- **Hetzner Volumes Integration**
  - Neue Kategorie "Volumes" unter jedem Hetzner Account
  - Anzeige von Größe, Status und Standort
  - Volumes erstellen und löschen (API-Unterstützung)

- **GitHub Integration**
  - Neue GitHub View im DevOps Panel
  - Repository-Liste mit Sprache, Stars, Forks
  - GitHub Actions Workflows anzeigen
  - Workflow Runs mit Status (✅ Success, ❌ Failure)
  - Workflows manuell starten (dispatch)
  - Repository im Browser öffnen
  - Repository klonen (öffnet Terminal)

- **IONOS Developer Console**
  - Direktlink zur IONOS Developer Console zum Erstellen neuer API-Keys
  - Im Account-hinzufügen Dialog integriert

### Verbessert
- DevOps Map Legend mit neuen Node-Typen (Subdomain, SSH Key, Volume)
- Tree View Struktur für Hetzner mit Kategorien (Server, SSH Keys, Volumes)

## [0.4.0] - 2024-12-10

### Neu
- **DevOps Map - Erweiterte Filter & Darstellung**
  - Filter mit Single/Multi-Select Modus (Typ, Provider, Projekt)
  - Toggle zwischen Multi-Select und Single-Select pro Filter-Kategorie
  - Layout-Modi: Hierarchisch, Kreis, Grid, Force-Directed
  - Node-Größe anpassbar (50% - 200%)
  - Verbindungsstile: Gerade, Gebogen, Gestrichelt
  - Verbindungsstärke einstellbar (1-5px)
  - Labels ein/ausblenden
  - Node-Farben nach Typ, Provider, Projekt oder Status
  - Verbesserte Kontraste und Lesbarkeit der Filter-UI
  - Scrollbare Controls-Box für bessere Übersicht

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
