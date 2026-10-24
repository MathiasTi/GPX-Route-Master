# Garmin Connect Personal API: Reine Browser-Tab-Sitzung (Nicht-Persistent) & Behebung des HTTP 406 Token-Austausch-Fehlers

Dieses Update entfernt die persistente Speicherung des Garmin Personal API Keys vollständig aus der Anwendung und behebt den Fehler `Status 406: NotAcceptableException` beim Abruf des 24-Stunden-OAuth2-Bearer-Tokens über den Garmin Token-Service.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Architektur- & Sicherheitsentscheidungen für dieses Update:**
> - **Vollständige Entfernung der persistenten API-Key-Speicherung**: Der Garmin Personal API Key wird ausschließlich flüchtig im Arbeitsspeicher (RAM) des aktuellen Browser-Tabs gehalten und bei jeder Anfrage über den Request-Header `X-Garmin-Personal-Key` übermittelt. Weder der API-Key noch das ausgetauschte OAuth2-Bearer-Token werden in SQLite oder auf dem Dateisystem gespeichert; eventuell noch vorhandene Alt-Einträge in der Datenbank oder Schlüsseldateien werden automatisch bereinigt.
> - **Ursache & Behebung von `Status 406: NotAcceptableException`**: Der offizielle Garmin-Endpunkt `POST /personalapitoken-service/personal-api/personal-api-key/token` liefert das generierte Access-Token als `text/plain` (bzw. direktes Token-Payload) zurück und lehnt Anfragen, die strikt `Accept: application/json` sowie `Content-Type: application/json` ohne Request-Body erzwingen, per JAX-RS/Spring Content-Negotiation mit `406 NotAcceptableException` ab. Der Request wird exakt an die offizielle Garmin-Spezifikation (`Authorization: ApiKey <key>`, `Accept: */*`, kein `Content-Type`-Header bei leerem POST-Body) angepasst und unterstützt sowohl `text/plain`-JWTs als auch JSON-Antworten.

---

## 1. Overview & Core Concept

- **Was umgesetzt wird**:
  1. **Reiner Nicht-Persistenter Sitzungsmodus (Browser-Tab RAM)**: Wegfall der Modus-Umschaltung („Verschlüsselt speichern“ vs. „Nicht-persistent“) sowie der serverseitigen AES-256-GCM-Datenbankverschlüsselung für den API-Key. Beim Schließen oder Neuladen des Browser-Tabs verfällt der Schlüssel sofort.
  2. **Fehlerfreier OAuth2 Token-Austausch (Fix für HTTP 406)**: Anpassung der HTTP-Header und der Antwort-Deserialisierung beim Token-Austausch sowie bei den nachgelagerten Garmin-API-Abfragen, sodass `NotAcceptableException` (HTTP 406) zuverlässig verhindert wird.
- **Zielgruppe & Mehrwert**: Nutzer, die ihre Garmin-Aktivitäten (inkl. `.FIT`-GPS-Routen) und Gesundheitsdaten mit maximaler Datensparsamkeit abrufen möchten, ohne dass ihr API-Key jemals persistent gespeichert wird.

---

## 2. User Experience & Visual Design

- **Vereinfachter Sitzungs-Workflow**:
  1. **Eingabe & Aktivierung**: Der Nutzer fügt seinen Garmin Personal API Key in das Eingabefeld ein und klickt auf **„Für diese Sitzung aktivieren“**.
  2. **Direkte Token-Verifizierung**: Der Key wird im RAM des Browser-Tabs hinterlegt und einmalig gegen den Garmin Token-Endpunkt geprüft. Die Statusleiste zeigt `Temporär im Browser-Tab (xxxx••••••••xxxx) · Nicht-persistent (Nur Browser-Tab RAM) · 24h Bearer Aktiv`.
  3. **Sitzung beenden / Key entfernen**: Über **„Sitzungs-Key entfernen“** kann der Nutzer den Key jederzeit aus dem Tab-Speicher löschen (optional inklusive Bereinigung bereits synchronisierter Garmin-Aktivitäten und Gesundheitsdaten).
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Funktionales, kontrastreiches Sport- & Telemetrie-Dashboard im bestehenden Slate/Sky-Farbsystem (`bg-white dark:bg-slate-900`, `border-slate-200 dark:border-slate-800`, Akzentfarbe `sky-600`).
  - *Typografie & Hierarchie*: Klare Sektionstitel, unverschachtelte Oberflächen (Single-Elevation Depth) und strikte Verwendung von `font-mono tabular-nums` für alle Status-, Zeit- und Metrikwerten sowie ungerahmte Metadaten-Trenner (`·`).

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Vollständiger Verzicht auf persistente Key-Speicherung (DB & Keyfile)**
  - *Gewählter Ansatz*: Entfernung aller Funktionen zur Datenbank-Speicherung und Verschlüsselung des API-Keys sowie automatisches Löschen etwaiger Alt-Einträge beim Serverstart.
  - *Begründung*: Eliminiert jegliches Risiko kompromittierter ruhender Zugangsdaten (Data-at-Rest) und vereinfacht die Bedienung auf einen klaren, transparenten Sitzungsmodus.
- **Entscheidung 2: Content-Negotiation-konformer Garmin Token-Request (Fix für Status 406)**
  - *Gewählter Ansatz*: Senden von `Accept: */*` (ohne `Content-Type` bei leerem POST-Body) analog zur offiziellen Garmin-Dokumentation (`curl -X POST 'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token' -H 'Authorization: ApiKey [your-api-key]'`), ergänzt um einen automatischen Fallback-Retry und JWT-`exp`-Auswertung.
  - *Begründung*: Garmins `personalapitoken-service` beantwortet `Accept: application/json` mit `406 NotAcceptableException`, da der Endpunkt keinen strikten JSON-Medientyp deklariert. Durch `Accept: */*` und flexible Token-Extraktion (Roh-JWT, JSON-String oder JSON-Objekt) funktioniert der Token-Austausch stabil.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Browser-Tab (Client RAM)                          │
│                                                                         │
│  ┌──────────────────────────────┐     ┌──────────────────────────────┐  │
│  │  GarminPersonalApiPanel UI   │────▶│  Ephemeral Tab Key Store     │  │
│  │  (Kein Persistenz-Umschalter,│     │  (Nur JS Heap RAM +          │  │
│  │   direkte Sitzungs-Steuerung)│     │   pagehide Auto-Wipe)        │  │
│  └──────────────┬───────────────┘     └──────────────┬───────────────┘  │
│                 │                                    │                  │
│                 └─────────────────┬──────────────────┘                  │
│                                   │ Header: X-Garmin-Personal-Key       │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Express Backend Proxy                            │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Garmin Personal API Service (Keine DB-Key-Speicherung)            │  │
│  │  • Bereinigt evtl. alte DB-Keys & .garmin_secret.key              │  │
│  │  • SSRF-Schutz: Nur offizielle https://*.garmin.com Hosts         │  │
│  │  • Token-Exchange: POST /personal-api-key/token                   │  │
│  │    Headers: Authorization: ApiKey <key>, Accept: */*              │  │
│  │  • Extrahiert Plaintext-JWT / JSON-Token & prüft Ablaufzeit (exp) │  │
│  └────────────────────────────────┬──────────────────────────────────┘  │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          Garmin Connect Personal API (personal.connectapi.garmin.com)   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Client-State (RAM)**: `ephemeralTabGarminKey` hält den eingegebenen API-Key ausschließlich im JavaScript-Heap des geöffneten Browser-Tabs und hängt ihn bei Anfragen über `X-Garmin-Personal-Key` an.
- **Server-State (RAM)**: Speichert lediglich einen kurzlebigen, nicht-sensitiven Verifikations-Hash (`apiKeyHash` + `expiresAtMs`) im Arbeitsspeicher für die Statusanzeige, jedoch niemals den API-Key oder das Bearer-Token in der Datenbank. Beim Schließen des Tabs löscht `/api/garmin/personal/clear-session` auch diese Metadaten.

### Interactive Component & State Mapping

- **Sitzungs-Key aktivieren (`handleSaveConfig`)**: Validiert die Eingabe und die Garmin-Basis-URL, legt den Key im Tab-RAM ab, ruft `/api/garmin/personal/config` zur sofortigen Token-Prüfung auf und zeigt bei Erfolg den aktiven 24h-Bearer-Status an.
- **Token prüfen (`handleTestToken`)**: Führt über `/api/garmin/personal/test-token` einen frischen Token-Austausch mit `Accept: */*` durch und aktualisiert die Ablaufzeit.
- **Sitzungs-Key löschen (`handleConfirmDeleteKey`)**: Löscht den Key sofort aus dem Browser-Tab-RAM, setzt den Server-Sitzungsstatus zurück und löscht optional die synchronisierten Aktivitäten und Gesundheitsmetriken aus SQLite.
