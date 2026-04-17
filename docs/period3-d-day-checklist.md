# Period 3 D-day checklist (10 min)

Tämä on nopea tuotantopäivän tarkistuslista periodi 3 -vaihtoon.

## 0) Tavoite

Vaihto periodiin 3 onnistuu ilman katkosta ennen ensimmäistä period 3 iltapeliä.

## 1) Ennen vaihtoa (2 min)

- [ ] Admin-kirjautuminen toimii: `/admin.html`
- [ ] Period 3 rosterit on syötetty validatorissa
- [ ] Varmista aikaraja: period 2 loppu `15.3 klo 10:00 SE / 11:00 FI`

## 2) Vaihto (3 min)

- [ ] Avaa `/team-validator.html` ja tarkista viimeiset rosterit
- [ ] Varmista että `period3-rosters.json` on aktiivinen
- [ ] Aja force-refresh kerran

## 3) Smoke-testit (3 min)

- [ ] `/api/health` → `200`
- [ ] `/api/tipsen-summary` → `200`
- [ ] `/` (Lagen) latautuu
- [ ] `/stallning.html` latautuu
- [ ] Admin suojaus toimii (`401` ilman tunnuksia)

## 4) Hyväksyntä ja viestintä (2 min)

- [ ] Tarkista nopeasti että järjestys näyttää järkevältä
- [ ] Lähetä osallistujille ilmoitus: period 3 käynnissä
- [ ] Jaa suora linkki `Ställningen`-sivulle

## Fallback (jos jokin menee pieleen)

1. Palauta edellinen toimiva rosteri-JSON
2. Aja force-refresh
3. Varmista `Lagen` + `Ställningen`
4. Korjaa rosteri validatorissa ja toista vaihto
