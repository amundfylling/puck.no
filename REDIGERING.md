# Redigering av puck.no — veiledning for styret

Nettsiden kan redigeres rett i nettleseren. Du trenger ikke kunne kode.

## Logge inn

1. Gå til **https://www.puck.no/admin/** — du kommer til adminportalen.
2. For å redigere innhold, trykk **Rediger innhold (CMS)** i menyen
   (eller gå direkte til **https://www.puck.no/admin/cms/**).
3. Trykk **Logg inn med GitHub** og godkjenn tilgang.
   - Første gang må en administrator ha lagt deg til som medlem av repoet på GitHub.
4. Du kommer nå til redigeringsverktøyet (Sveltia CMS) med norsk meny.

Endringer du lagrer blir publisert automatisk i løpet av 1–3 minutter
(Cloudflare bygger siden på nytt). Er du usikker, lagre og sjekk siden etterpå.

## Adminportalen (/admin/)

Forsiden av portalen gir et sanntidsbilde av påmeldingene:

- **Oversikt** – antall påmeldte per turnering, nye påmeldinger siste 7 dager
  og de siste påmeldingene.
- **Åpne/stenge påmelding** – trykk på «Åpen»/«Stengt» ved en kommende
  turnering. Stenging av nye API-påmeldinger skjer med én gang; skjemaets
  synlighet (og full åpning igjen) synkroniseres ved neste bygg.
- **Påmeldinger** – søkbar og sorterbar liste over påmeldte per turnering.
  Her kan du legge til en påmelding selv etter at påmeldingen er stengt,
  redigere lag/spillere, kontaktinformasjon og tilleggssvar, eller slette en
  påmelding. Her laster du også ned **CSV-filen** med kontaktinformasjon og
  tilleggssvar (håndteres etter personvernerklæringen).
- Mørkt tema: sol/måne-knappen øverst til høyre.

---

## Publisere en nyhetsartikkel

1. Velg **Nyheter (norsk)** i menyen til venstre.
2. Trykk **Ny nyhetsartikkel**.
3. Fyll inn:
   - **Tittel** – overskriften på artikkelen.
   - **Slug (URL)** – kort adresse, f.eks. `nm-2027-forhandstips`. Kun små
     bokstaver, tall og bindestreker.
   - **Forfatter** – navnet som vises på nyhetskortet og artikkelsiden.
   - **Publiseringsdato** – styrer sorteringen på nyhetssiden.
   - **Kategorier** – velg en eller flere (valgfritt).
   - **Forsidebilde** – last opp eller velg et bilde (vises i nyhetslisten).
   - **Innhold** – selve artikkelen. Bruk verktøylinjen for overskrifter,
     fet skrift, lenker og bilder.
4. Trykk **Lagre**. Artikkelen er straks på vei ut på `/post/<slug>`.
5. Engelsk versjon: gjenta under **Nyheter (engelsk)** (valgfritt).

## Legge til eller oppdatere en bordhockeykombinasjon

1. Velg **Bordhockeykombinasjoner** i menyen til venstre.
2. Åpne en eksisterende kombinasjon, eller trykk **Ny kombinasjon**.
3. Fyll inn navn, URL-slug, spiller(e), vanskelighetsgrad og forklaring på
   både norsk og engelsk. Én oppføring driver begge språkversjonene.
4. Last gjerne opp en illustrasjon og legg inn en video-URL. Begge feltene kan stå
   tomme og fylles ut senere.
5. Angi **Rekkefølge** for plasseringen i katalogen. La **Gammelt
   lenkeanker** stå tomt for helt nye kombinasjoner.
6. Trykk **Lagre**. Katalogsidene, den norske detaljsiden og den engelske
   detaljsiden bygges og publiseres automatisk.

Katalogen støtter senter, begge vinger, begge backer og keeper. Søk,
spillerfilter og vanskelighetsfilter oppdateres automatisk når nye
kombinasjoner legges til.

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
   - **ITHF-rankingnivå** – valgfritt. Velg nivå 1–6 når siden skal vise
     beregnede rankingpoeng for hver plassering. Nivå 1 har egne valg for VM
     og kontinentalmesterskap. Nivå 10 brukes for lagturneringer og gir null
     poeng. La feltet stå tomt hvis tabellen ikke skal vises.
   - **Spillere som teller per lag** – la feltet stå **tomt** for en vanlig
     individuell turnering. For en lagturnering skriver du hvor mange av de
     høyest rangerte spillerne som teller i lagets poengsum, f.eks. `3`.
   - **Maks. antall innbyttere** – hvor mange ekstra spillere laget kan melde
     på, f.eks. `2`. Et 3+2-lag kan dermed registrere 3–5 spillere, men bare de
     tre høyeste ITHF-poengsummene teller. Bruk `0` hvis innbyttere ikke er lov.
   - **Tilleggsspørsmål** – valgfrie enkeltvalgsspørsmål for akkurat denne
     turneringen, f.eks. lunsj. Spørsmål og hvert svaralternativ må ha norsk
     og engelsk tekst. Velg selv om spørsmålet er obligatorisk. Svarene er kun
     synlige i den beskyttede adminportalen og CSV-filen.
   - **Innhold** – beskrivelse, tidsskjema osv.
3. Trykk **Lagre**. Turneringen får egen side under `/turneringer/<slug>`
   med påmeldingsskjema og liste over påmeldte spillere. Rankingposisjon og
   ITHF-poeng hentes automatisk; data for kommende turneringer oppdateres også
   hver onsdag kl. 03:00. Hvis et ITHF-rankingnivå er valgt, vises også en
   norsk/engelsk poengtabell basert på antall påmeldte og deres oppdaterte
   `Player_Value` fra ITHF. Denne verdien er ikke spillerens totale
   rankingpoeng. Færre enn fire påmeldte gir null poeng; for nivå 1–6 får
   vinneren i tillegg 10 poeng. Tabellen kan derfor endre seg mens nye spillere
   melder seg på.

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
   - Bordhockeykombinasjoner: `src/content/tricks/` (én JSON-fil per kombinasjon)
   - Timere/dokumenter: `src/data/timers.json` / `src/data/documents.json`
3. Trykk på blyant-ikonet (**Edit this file**), gjør endringen, og trykk
   **Commit changes** (velg «Commit directly to the main branch»).
4. Ny artikkel: trykk **Add file** → **Create new file** i riktig mappe.
   Husk frontmatter-blokken øverst (kopier en eksisterende fil og bytt ut
   verdiene). Bilder lastes opp til `media-uploads/images/` og refereres
   som `/media/images/<filnavn>`.

Endringen publiseres automatisk i løpet av noen minutter.

## Vanlige spørsmål

- **Jeg ser ikke endringen min:** Vent 2–3 minutter og last siden på nytt
  (hold gjerne Shift nede mens du laster for å tømme hurtigbufferen).
- **Påmeldingsskjemaet vises ikke:** Sjekk at turneringens dato er i
  framtiden.
- **Noe gikk galt:** Kontakt amund.fylling@puck.no.
