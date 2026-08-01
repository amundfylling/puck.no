# puck-no-admin MCP server

Lokal MCP-server (Model Context Protocol) for administrative oppgaver på
puck.no — turneringer, påmeldinger, innhold og drift. Den kjører lokalt på
din maskin og pakker inn de to kontrollplanene som allerede finnes:

- **Innhold (git):** oppretter/patcher Markdown-filer i `src/content/` og
  committer alltid via en **branch + pull request**. Bare nettleser-CMS-et har
  det dokumenterte unntaket som committer direkte til `main`.
- **Påmeldinger (D1):** kjører SQL mot den **levende** databasen via
  `npx wrangler d1 execute puck-no --remote` — gjenbruker din eksisterende
  `wrangler login`. Ingen API-tokens å forvalte.

Ingenting deployes, og nettsidens arkitektur er urørt.

## Oppsett

```bash
cd mcp
npm install
```

Serveren kjøres over stdio av MCP-klienten din. Den finner repo-roten selv
(uavhengig av cwd) og legger nvm Node 24 først i PATH for subprocesser.

### Kimi CLI

MCP-servere registreres i `mcp.json` (IKKE config.toml) — enten på
brukernivå (`~/.kimi-code/mcp.json`, gjelder alle prosjekter) eller på
prosjektnivå (`<repo>/.kimi-code/mcp.json`, kun dette repoet — anbefalt,
og `.kimi-code/` er allerede git-ignorert). **Denne er allerede satt opp
for deg** i `.kimi-code/mcp.json`:

```json
{
  "mcpServers": {
    "puck-no-admin": {
      "command": "/Users/amundfylling/.nvm/versions/node/v24.18.0/bin/node",
      "args": ["/Users/amundfylling/Downloads/puck.no/mcp/src/index.js"],
      "cwd": "/Users/amundfylling/Downloads/puck.no",
      "toolTimeoutMs": 300000
    }
  }
}
```

Start en ny Kimi-økt i repoet og sjekk status med `/mcp`. Verktøyene dukker
opp som `mcp__puck-no-admin__*` (interaktiv redigering: `/mcp-config`).

### Claude Desktop (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "puck-no-admin": {
      "command": "/Users/amundfylling/.nvm/versions/node/v24.18.0/bin/node",
      "args": ["/Users/amundfylling/Downloads/puck.no/mcp/src/index.js"]
    }
  }
}
```

Krav: Node ≥ 22.12, `wrangler login` gjort, `gh auth login` (for PR-flyt).

## Verktøy (21)

### Turneringer (git)
| Verktøy | Gjør |
|---|---|
| `list_tournaments` | Alle turneringer m/ dato, status, rankingnivå og påmeldingstall (live) |
| `create_tournament` | Ny turnering (NO + valgfri EN-speil), rankingnivå og regenerert API-konfig |
| `update_tournament` | Patch navn/dato/sted/priser/spillsystem/lagregler/rankingnivå/tilleggsspørsmål (uten å røre brødtekst) |
| `duplicate_tournament` | Kopier f.eks. fjorårets Norway Open til ny slug/dato |
| `close_registration` / `open_registration` | Steng straks via D1 / åpne etter branch + PR + bygg (`registrationOpen`) |
| `archive_tournament` | Info — arkivering skjer automatisk etter dato |

### Påmeldinger (D1, live)
| Verktøy | Gjør |
|---|---|
| `list_registrations` | Påmeldte per turnering — roster, klubb, rankingposisjon og ITHF-poeng; PII maskert |
| `count_registrations` | Antall per turnering / totalt |
| `add_registration` | Manuell påmelding (walk-ins); samme validering + duplikatvern som API-et |
| `delete_registration` | **DESTRUKTIV — dry-run er standard**; forhåndsvis, så slett med `dryRun: false` |
| `update_registration` | Rett navn/e-post/telefon (full rosterredigering gjøres i adminportalen) |
| `move_registration` | Flytt til annen turnering (f.eks. feil NM-klasse) |
| `export_registrations` | Full CSV (PII) til git-ignorert `migration/raw/` — aldri i chatten |
| `sync_participant_snapshot` | Regenerer `registrations-snapshot.json` fra live D1 + pull request |
| `ranking_lookup` | Søk i ITHF-rankingen → playerId, rankingposisjon, ITHF-poeng og eksakt `Player_Value` |

### Innhold (git)
| Verktøy | Gjør |
|---|---|
| `create_news_post` | Nyhetsinnlegg (NO + valgfri EN-speil m/ hreflang-par) |
| `add_timer` | MP3 → `public/media/audio` + rad i `timers.json` |
| `add_arsmote_document` | PDF → `public/media/pdf` + rad i `documents.json` |

### Drift
| Verktøy | Gjør |
|---|---|
| `site_health` | `astro check` → `build` → `check-links`, grønn/rød per steg |
| `deploy_status` | Siste Cloudflare Pages-bygg på main (via `gh`) |

## Sikkerhetsmodell

- **Read-only / write / destructive** er tydelig merket i hver verktøy-
  beskrivelse. Destruktive verktøy (`delete_registration`) er
  `dryRun: true` som standard — de viser nøyaktig hva som vil skje først.
- **PII:** e-post/telefon maskeres i all chat-output (`a***@puck.no`).
  Full kontaktinfo skrives kun til fil i git-ignorerte `migration/raw/`.
- **Git:** krever ren working tree, stage'r kun filene verktøyet rørte,
  aldri force-push. Standard er branch + PR.
- **SQL:** all verdi-interpolasjon går gjennom `sqlValue()`-escaping.
- **Ingen skjemaendringer** via MCP — migreringer kjøres manuelt
  (`npx wrangler d1 migrations apply puck-no --remote`, se LAUNCH.md).

## Testing

```bash
cd mcp
npm test                                   # enhetstester (ren logikk)
node test/smoke.mjs                        # read-only mot live D1 + ranking
MCP_D1_LOCAL=1 node test/local-d1-roundtrip.mjs  # skrive-tester mot LOKAL D1
```

`MCP_D1_LOCAL=1` får alle D1-verktøy til å gå mot den lokale
utviklingsdatabasen i stedet for produksjon.

## Merknader

- `close_registration` skriver først en fail-closed D1-veto, slik at API-et
  avviser nye påmeldinger med én gang, og åpner deretter en PR som skjuler
  skjemaet. `open_registration` fjerner vetoen, men lukket frontmatter vinner
  frem til PR-en er merget og siden er bygd på nytt.
- Lokal (miniflare) D1 rapporterer ikke `meta.changes` pålitelig —
  skriveverktøyene verifiserer derfor med oppfølgings-SELECTs og virker
  likt lokalt og i produksjon.
- Lagregler bruker `playersPerTeam` + `maxSubstitutes`. Laget kan registrere
  fra `playersPerTeam` til summen av de to feltene; bare de høyest rangerte
  `playersPerTeam`-spillerne teller i lagets ITHF-poengsum.
- `rankingLevel` er valgfritt og synkroniseres til engelsk speil/API-konfig.
  Tillatte verdier er `1-world`, `1-continental`, `2`, `3`, `4`, `5`, `6`
  og `10`; `null` betyr at turneringen ikke gir beregnede rankingpoeng.
  Individuelle turneringer kan ikke bruke `10`, mens lagturneringer bare kan
  bruke `10` eller `null`.
- MCP-et holder rankingens samlede `points` og algoritmens eksakte
  `Player_Value` adskilt. Ved manuell påmelding lagres sistnevnte i
  `ranking_value` (individuell) og `rankingValue` på hvert lagmedlem.
