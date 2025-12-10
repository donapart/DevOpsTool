# DevOps Hybrid Cockpit

**IONOS + Hetzner in VS Code vereint.**

Eine VS Code Extension, die das nervige Tab-Hopping zwischen IONOS und Hetzner Control Panels beendet. Verwalten Sie DNS-Records und Cloud-Server direkt aus Ihrem Editor.

---

## Features

### 🌐 DNS Management (IONOS)
- **Domain-Übersicht**: Alle Ihre IONOS-Domains auf einen Blick
- **Record-Verwaltung**: A, AAAA, MX, CNAME, TXT Records anzeigen und bearbeiten
- **Quick Edit**: Klick auf Record → neuen Wert eingeben → fertig
- **TTL Toggle**: Schnell zwischen 60s (Migration) und 1h (Normal) wechseln
- **Propagation Check**: Prüfen Sie, ob DNS-Änderungen bei Google, Cloudflare und Quad9 angekommen sind

### 🖥️ Server Management (Hetzner Cloud)
- **Server-Übersicht**: Status-Anzeige mit farbigen Icons (🟢 Running, 🔴 Off, 🟡 Migrating)
- **Power Control**: Soft Reboot, Power On/Off, Hard Reset
- **Rescue Mode**: Mit einem Klick aktivieren – Root-Passwort wird automatisch kopiert
- **Snapshots**: Backup vor dem Deployment direkt aus VS Code
- **SSH Terminal**: Öffnet eine SSH-Session im integrierten Terminal
- **Web Console**: Direktlink zur Hetzner Cloud Console

### 🔗 Bridge (Der echte Mehrwert)
- **Copy IP → Update DNS**: Server-IP kopieren, dann auf Domain anwenden – ohne Copy-Paste-Fehler
- **DevOps Clipboard**: Internes Clipboard für den Workflow zwischen Providern

---

## Installation

1. Extension in VS Code installieren
2. In der Seitenleiste auf das **Cloud-Icon (DevOps)** klicken
3. Tokens konfigurieren (siehe unten)

---

## Tokens einrichten

### IONOS DNS Token

1. Öffnen Sie die [IONOS Developer Console](https://developer.hosting.ionos.de/)
2. Erstellen Sie einen neuen API Key
3. In VS Code: `Ctrl+Shift+P` → **"DevOps Setup: Set IONOS DNS Token"**
4. Token im Format `public_prefix.secret` eingeben

### Hetzner Cloud Token

1. Öffnen Sie die [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Wählen Sie ein Projekt → **Security** → **API Tokens**
3. Neuen Token mit **Read & Write** Berechtigung erstellen
4. In VS Code: `Ctrl+Shift+P` → **"DevOps Setup: Set Hetzner Cloud Token"**

> **🔒 Sicherheit**: Tokens werden verschlüsselt im VS Code SecretStorage gespeichert – nicht im Klartext in settings.json.

---

## Workflows

### Domain auf neuen Server zeigen

```
1. Server in "COMPUTE (HETZNER)" finden
2. Rechtsklick → "Copy IP" (📋)
3. DNS Record in "DOMAINS (IONOS)" finden
4. Rechtsklick → "Update from DevOps Clipboard"
5. Bestätigen → fertig!
```

### Vor einer Migration

```
1. A-Record finden
2. Rechtsklick → "Set TTL to 60s (Migration Mode)"
3. Warten bis propagiert (Check Propagation)
4. Migration durchführen
5. Nach Abschluss: "Set TTL to 1h (Normal)"
```

### Server-Notfall (System hängt)

```
1. Server in Liste finden
2. Rechtsklick → "Hard Reset (Emergency)"
3. ⚠️ Bestätigen (Datenverlust möglich!)
```

### Rescue Mode für Reparaturen

```
1. Server finden
2. Rechtsklick → "Enable Rescue Mode"
3. Root-Passwort wird in Zwischenablage kopiert
4. Server bootet in Rescue-Linux
5. SSH verbinden und reparieren
```

---

## Einstellungen

| Setting | Default | Beschreibung |
|---------|---------|--------------|
| `devops.debugLogging` | `false` | Ausführliches Logging im Output-Panel |
| `devops.readOnly` | `false` | Read-Only Modus – alle Schreiboperationen deaktiviert |
| `devops.cacheTtlSeconds` | `30` | Cache-Dauer für API-Antworten |

### Read-Only Modus

Aktivieren Sie `devops.readOnly` in den Einstellungen, wenn Sie die Extension nur zum Browsen nutzen möchten, ohne versehentlich etwas zu ändern. Alle mutierenden Aktionen (DNS Update, Server Reboot, etc.) werden dann blockiert.

---

## Commands

Alle Commands sind über `Ctrl+Shift+P` erreichbar:

| Command | Beschreibung |
|---------|--------------|
| `DevOps: Refresh` | Alle Views neu laden |
| `DevOps: Show Logs` | Output-Panel öffnen |
| `DevOps Setup: Set IONOS DNS Token` | IONOS API Key eingeben |
| `DevOps Setup: Set Hetzner Cloud Token` | Hetzner API Key eingeben |
| `DevOps Setup: Clear IONOS Token` | IONOS Token löschen |
| `DevOps Setup: Clear Hetzner Token` | Hetzner Token löschen |

---

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                        │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (Tree Views)                                      │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DomainsTreeView │  │ ComputeTreeView │                  │
│  └────────┬────────┘  └────────┬────────┘                  │
├───────────┼─────────────────────┼───────────────────────────┤
│  Core Layer                                                 │
│  ┌────────┴─────────────────────┴────────┐                 │
│  │           ProviderManager             │                 │
│  └───────────────────┬───────────────────┘                 │
├──────────────────────┼──────────────────────────────────────┤
│  Provider Layer      │                                      │
│  ┌───────────────────┴───────────────────┐                 │
│  │  IonosDnsProvider  │  HetznerCloudProvider              │
│  └───────────────────────────────────────┘                 │
├─────────────────────────────────────────────────────────────┤
│  Utilities                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ Logging │ │ Caching │ │ Errors  │ │ Guards  │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Entwicklung

```bash
# Dependencies installieren
npm install

# Kompilieren
npm run compile

# Watch-Mode
npm run watch

# Extension testen (F5 in VS Code)
```

---

## Roadmap

- [ ] IONOS Compute (Cloud Server)
- [ ] Hetzner Robot (Dedicated Server)
- [ ] DNS Presets (Mail-Templates mit einem Klick)
- [ ] "Provision & Point" Wizard (Server erstellen + DNS automatisch setzen)
- [ ] Multi-Account Support

---

## Sicherheitshinweise

- **Tokens sind sensibel**: Sie können Domains übernehmen und Server löschen
- Nutzen Sie den **Read-Only Modus** für sicheres Browsen
- Vor destruktiven Aktionen erscheint **immer ein Bestätigungsdialog**
- Tokens werden **niemals** in Logs oder settings.json gespeichert

---

## Lizenz

MIT

---

## Feedback & Issues

Probleme oder Feature-Wünsche? [GitHub Issues](https://github.com/donapart/devops-hybrid/issues)
