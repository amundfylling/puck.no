# Redigering av puck.no — veiledning for styret

Nettsiden kan redigeres rett i nettleseren. Du trenger ikke kunne kode.

## Logge inn

1. Gå til **https://www.puck.no/admin/**
2. Trykk **Logg inn med GitHub** og godkjenn tilgang.
   - Første gang må en administrator ha lagt deg til som medlem av repoet på GitHub.
3. Du kommer nå til redigeringsverktøyet (Sveltia CMS) med norsk meny.

Endringer du lagrer blir publisert automatisk i løpet av 1–3 minutter
(Cloudflare bygger siden på nytt). Er du usikker, lagre og sjekk siden etterpå.

---

## Publisere en nyhetsartikkel

1. Velg **Nyheter (norsk)** i menyen til venstre.
2. Trykk **Ny nyhetsartikkel**.
3. Fyll inn:
   - **Tittel** – overskriften på artikkelen.
   - **Slug (URL)** – kort adresse, f.eks. `nm-2027-forhandstips`. Kun små
     bokstaver, tall og bindestreker.
   - **Publiseringsdato** – styrer sorteringen på nyhetssiden.
   - **Kategorier** – velg en eller flere (valgfritt).
   - **Forsidebilde** – last opp eller velg et bilde (vises i nyhetslisten).
   - **Innhold** – selve artikkelen. Bruk verktøylinjen for overskrifter,
     fet skrift, lenker og bilder.
4. Trykk **Lagre**. Artikkelen er straks på vei ut på `/post/<slug>`.
5. Engelsk versjon: gjenta under **Nyheter (engelsk)** (valgfritt).

## Opprette en turnering og åpne påmelding

1. Velg **Turneringer** → **Ny turnering**.
2. Fyll inn:
   - **Navn** – f.eks. «Norway Open 2027».
   - **Slug** – f.eks. `norway-open-2027`.
   - **Dato** – norsk datoformat, f.eks. `5. september 2027`
     (eller `1.–3. mai 2027` for flere dager). **Viktig:** datoen styrer om
     turneringen vises som «Kommende». Påmeldingsskjemaet vises bare for
     kommende turneringer.
   - **Sted**, **Priser**, **Spillsystem** – valgfritt.
   - **Min./maks. spillere per lag** – la begge stå **tomme** for vanlig
     (individuell) turnering. For lagturnering (f.eks. Duo-NM): fyll inn
     begge, f.eks. 2 og 2.
   - **Innhold** – beskrivelse, tidsskjema osv.
3. Trykk **Lagre**. Turneringen får egen side under `/turneringer/<slug>`
   med påmeldingsskjema og liste over påmeldte spillere (henter navn fra
   verdensrankingen automatisk).

## Oppdatere styremedlemmer

1. Velg **Sider (norsk)** → **Om oss**.
2. Rediger styrelisten i innholdsfeltet. Gjør det samme under
   **Sider (engelsk)** → **About us** om nødvendig.
3. Trykk **Lagre**.

## Laste opp en ny timer (MP3)

1. Velg **Data** → **Timere (lydfiler)**.
2. Trykk **Legg til timer**.
3. Skriv inn **Tittel**, last opp **MP3-filen**, og fyll inn varighet
   (f.eks. `05:38`) om du vil.
4. Trykk **Lagre**. Timeren dukker opp på `/timere`.

## Legge til årsmøtereferat (PDF)

1. Velg **Data** → **Årsmøtedokumenter (PDF)**.
2. Trykk **Legg til dokument**, fyll inn tittel og år, last opp PDF-en.
3. Trykk **Lagre**. Dokumentet vises på `/årsmøter`.

---

## Alternativ: redigere direkte på GitHub (uten CMS)

Om innloggingen i CMS-et ikke virker, kan alt redigeres i GitHubs
nettgrensesnitt — det krever heller ingen kodekunnskaper:

1. Logg inn på https://github.com og åpne repoet.
2. Naviger til riktig fil:
   - Nyheter: `src/content/posts/` (engelske: `src/content/posts/en/`)
   - Turneringer: `src/content/tournaments/`
   - Sider: `src/content/pages/` (engelske: `src/content/pages/en/`)
   - Timere/dokumenter: `src/data/timers.json` / `src/data/documents.json`
3. Trykk på blyant-ikonet (**Edit this file**), gjør endringen, og trykk
   **Commit changes** (velg «Commit directly to the main branch»).
4. Ny artikkel: trykk **Add file** → **Create new file** i riktig mappe.
   Husk frontmatter-blokken øverst (kopier en eksisterende fil og bytt ut
   verdiene). Bilder lastes opp til `media-originals/images/` og refereres
   som `/media/images/<filnavn>`.

Endringen publiseres automatisk i løpet av noen minutter.

## Vanlige spørsmål

- **Jeg ser ikke endringen min:** Vent 2–3 minutter og last siden på nytt
  (hold gjerne Shift nede mens du laster for å tømme hurtigbufferen).
- **Påmeldingsskjemaet vises ikke:** Sjekk at turneringens dato er i
  framtiden.
- **Noe gikk galt:** Kontakt amund.fylling@puck.no.
