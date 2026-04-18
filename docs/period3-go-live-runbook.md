# Stanley Cup go-live runbook

Tämä checklist on periodi 1 -> Stanley Cup -vaihtoon.

Lisäkonteksti ja päätösloki: [docs/specification.md](docs/specification.md) (kohta 11: Stanley Cup -siirtymä).

## 1) Aikaraja (source of truth)

- Period 1 päättyy: `2026-03-15 klo 10:00` (SE) / `11:00` (FI)
- `2026-03-14` illan NHL-pelit kuuluvat vielä periodiin 1
- Stanley Cup alkaa `2026-03-15` illan peleistä

### Päiväkohtainen päätöstaulukko (cron 09:00 FI)

| Aamun ajopäivä (FI) | Oletus targetDate (`eilinen`) | Tavoite | Vaaditaanko Stanley Cup -rosteri? |
| --- | --- | --- | --- |
| 2026-03-15 | 2026-03-14 | Päivitä period 1 viimeinen pelipäivä | Ei |
| 2026-03-16 | 2026-03-15 | Stanley Cupin ensimmäinen pelipäivä | Kyllä |
| 2026-03-17 -> | >= 2026-03-16 | Stanley Cupin jatkuvat päivitykset | Kyllä |

Tulkinta:
- `2026-03-15` aamun automaattiajo on sallittu ilman Stanley Cup -rosteria.
- `2026-03-16` aamusta eteenpäin automaattiajo blokataan ilman Stanley Cup -rosteria.

## 2) Ennen vaihtoa (viimeistään 15.3 ennen ensimmäistä Stanley Cup -peliä)

- [ ] Stanley Cup validator toimii (`/team-validator.html`)
- [ ] Kaikkien osallistujien Stanley Cup -joukkueet on syötetty validatorin kautta
- [ ] `data/period1-rosters.json` sisältää kaikkien osallistujien pelaajat
- [ ] Varmista että admin-kirjautuminen toimii (`/admin.html`)

## 3) Vaihtohetki (operointi)

- [ ] Syötä tai tarkista puuttuvat Stanley Cup -joukkueet validatorissa
- [ ] Varmista että `period1-rosters.json.enabled === true`
- [ ] Aja force-refresh, jotta data lämpenee uudelle vaiheelle
- [ ] Varmista että `Ställningen` ja `Lagen` latautuvat ilman virheitä

### Aamun operointichecklist (15.3 -> 16.3)

15.3 aamulla (period 1 finalisointi):
- [ ] Kutsu `GET /api/cron/daily-refresh` ilman `force=true`
- [ ] Varmista että vastaus EI ole legacy-gate `sc_rosters_missing`
- [ ] Varmista että `date` on `2026-03-14` (tai vastaava period 1 viimeinen targetDate)

16.3 aamulla (Stanley Cup gate aktiivinen):
- [ ] Jos Stanley Cup -rosteri puuttuu, varmista että ajo ei käynnisty normaalipolkua pitkin
- [ ] Tallenna puuttuvat joukkueet validatorilla ja aja `GET /api/cron/daily-refresh?force=true`
- [ ] Varmista onnistumisen jälkeen `autoRefreshLastSuccessDate` asetuksista/API-vastauksesta

## 4) Stanley Cup pisteasteikko

Stanley Cup -sijoituspisteet:

- `30, 24, 19, 15, 12, 10, 8, 6, 4, 2, 1`

Huomio:

- Tämä poikkeaa periodi 1 asteikosta (`20, 16, 13, 11, 9, 7, 5, 4, 3, 2, 1`)
- Tasapisteissä käytetään keskiarvoa ja pyöristystä lähimpään kokonaislukuun (sama periaate kuin aiemmassa vaiheessa)

## 5) Julkaisun jälkeinen tarkistus (smoke)

- [ ] `/` (Lagen) → toimii ja näyttää odotetut arvot
- [ ] `/stallning.html` → toimii ja järjestys näyttää järkevältä
- [ ] `/api/tipsen-summary` → vastaa `200`
- [ ] `/api/health` → vastaa `200`
- [ ] Admin edelleen suojattu (`401` ilman tunnuksia)

## 6) Rollback-suunnitelma

Jos Stanley Cup -data on virheellinen:

1. Palauta edellinen toimiva `period1-rosters.json`
2. Aja force-refresh uudelleen
3. Tarkista `Lagen` + `Ställningen`
4. Tee korjattu rosteri validatorissa ja toista vaihto

## 7) Viestintä osallistujille

Kun vaihto on tehty:

- [ ] Lähetä lyhyt ilmoitus: Stanley Cup käynnissä
- [ ] Kerro että pisteasteikko Stanley Cupissa on päivitetty
- [ ] Jaa suora linkki `Ställningen`-sivulle
