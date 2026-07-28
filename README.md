# Praćenje servisa vozila

Web aplikacija za praćenje servisa voznog parka. Radi u pregledniku, kompatibilna je s mobitelom i računalom, a svi koji dobiju link mogu je koristiti (dodavati vozila, unositi servise, pisati napomene o uočenim nedostacima).

## Što aplikacija radi

- Popis svih vozila s pretragom i filtrima (baza, status, dospijeće servisa)
- Automatski izračun sljedećeg servisa po **datumu i kilometraži** (dospijeva ono što nastupi prije), s vizualnim oznakama: servis u redu (zeleno) / uskoro (žuto) / dospio (crveno)
- Praćenje u kojoj se bazi/lokaciji vozilo trenutno nalazi
- Oznaka je li vozilo ispravno ili neispravno (jedan klik za promjenu)
- Povijest svih unesenih servisa po vozilu
- Napomene - svatko može upisati uočeni nedostatak, s imenom i datumom, i označiti ga kao riješenog

Aplikacija nema prijavu/login - svatko tko ima link može gledati i unositi podatke. To je namjerno jednostavno za početak; javi ako kasnije želiš dodati zaštitu lozinkom ili korisničke račune.

## Tehnički detalji

Za **lokalno pokretanje** (na tvom računalu) aplikacija nema nijednu vanjsku ovisnost - koristi isključivo ugrađene Node.js module (`node:http` za server, ugrađeni `node:sqlite` za bazu podataka). Podaci se tada spremaju u `data/fleet.db`.

Za **online hosting** (kad je postavljena varijabla okoline `DATABASE_URL`), aplikacija se automatski prebacuje na [Turso](https://turso.tech) - besplatnu, pouzdanu SQLite-kompatibilnu bazu u oblaku - umjesto lokalne datoteke, jer besplatni serveri (poput Rendera) sami po sebi ne čuvaju datoteke trajno. To je jedina vanjska ovisnost (`@libsql/client`), i koristi se samo u online modu.

**Preduvjet za lokalno pokretanje: Node.js verzija 22.5 ili novija.** Provjeri svoju verziju s `node -v`.

## Pokretanje lokalno (za testiranje na svom računalu)

```bash
node server/index.js
```

Zatim otvori `http://localhost:3000` u pregledniku. Nema `npm install` koraka.

## Kako to staviti online da svi mogu koristiti preko linka (besplatno)

Ovo je kombinacija tri besplatna servisa, sve se radi klikanjem u pregledniku (nije potreban Terminal):

### 1. Turso - besplatna baza podataka koja čuva podatke trajno

1. Idi na [app.turso.tech](https://app.turso.tech) i napravi besplatan račun
2. Napravi novu bazu (npr. nazovi je `evidencija-vozila`)
3. Iz postavki baze kopiraj **connection URL** (izgleda kao `libsql://ime-baze-korisnik.turso.io`)
4. Generiraj **auth token** (pristupni ključ) i kopiraj ga
5. Ova dva podatka (URL i token) trebat će ti kod postavljanja Rendera (korak 3)

### 2. GitHub - tu se sprema kod aplikacije

1. Idi na [github.com](https://github.com) i napravi besplatan račun (ili prijavi se ako ga već imaš)
2. Napravi novi repozitorij (New repository), npr. nazovi ga `evidencija-vozila`
3. Otvori repozitorij → "Add file" → "Upload files" → povuci (drag & drop) SVE datoteke i mape iz ovog projekta OSIM mape `data/` i `node_modules/` (ako postoji) → Commit changes

### 3. Render - ovdje aplikacija stvarno "živi" i dobiva javni link

1. Idi na [render.com](https://render.com) i napravi besplatan račun (najlakše prijavom kroz GitHub - jedan klik)
2. "New" → "Web Service" → poveži GitHub repozitorij iz koraka 2
3. Postavke:
   - **Build Command**: `npm install`
   - **Start Command**: `node server/index.js`
4. Pod "Environment Variables" dodaj dvije varijable (vrijednosti iz koraka 1):
   - `DATABASE_URL` = connection URL iz Turso
   - `DATABASE_AUTH_TOKEN` = auth token iz Turso
5. Klikni "Create Web Service" / "Deploy" - Render će sam instalirati i pokrenuti aplikaciju
6. Nakon par minuta dobiješ javni link (npr. `https://evidencija-vozila.onrender.com`) - taj link podijeli sa svima

Napomena: besplatni Render server "zaspi" nakon ~15 minuta neaktivnosti i probudi se za par desetaka sekundi kad netko idući put otvori link - to je normalno i ne utječe na podatke, jer su oni sigurno spremljeni u Turso bazi, ne na samom serveru.

### Alternativa - Docker / VPS / Railway

Ako u budućnosti poželiš pouzdaniji (plaćeni) hosting bez "spavanja", u projektu je priložen i `Dockerfile` koji radi identično na Railway, Fly.io ili vlastitom VPS-u - tada nije ni potreban Turso jer takve platforme imaju svoj trajni disk (podesi `DATABASE_URL` samo ako ipak želiš zadržati Turso).

## Redovito sigurnosno kopiranje

Ako koristiš Turso (online verzija), podaci su već sigurni u oblaku. Ako koristiš samo lokalnu verziju, cijela baza je jedna datoteka: `data/fleet.db` - povremeno je kopiraj negdje sigurno (npr. Google Drive).

## Sljedeći koraci / ideje za nadogradnju

Ovo je prva radna verzija. Neke ideje za kasnije doradu (javi što ti treba):

- Prijava korisnika / lozinka za pristup ili razdvajanje "administrator" vs "svatko može gledati"
- Automatski email/SMS/push podsjetnik kad se servis približava
- Prilog fotografija uz napomene o nedostacima
- Izvoz podataka u Excel
- Odvojene uloge (npr. samo vozač piše napomene, samo mehaničar unosi servis)
