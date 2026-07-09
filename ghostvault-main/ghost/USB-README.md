# GhostVault USB Installer

Deze USB bevat GhostVault met een eenvoudig installatiesysteem.

## Bestanden

- `install.bat` - Setup menu met installatie, update, verwijdering, health check, en USB portable run
- `ghostvault/` - De GhostVault applicatie
- `ghostvault/usb-start.bat` - Start GhostVault direct van USB (geen installatie nodig)
- `ghostvault/start.bat` - Start GhostVault na installatie
- `ghostvault/stop.bat` - Stop GhostVault
- `node.exe` - Portable Node.js (optioneel, ~90MB)
- `version.txt` - Huidige versie nummer

## Installatie

1. Sluit de USB aan op de PC
2. Dubbelklik op `install.bat`
3. Kies optie 1: Installeren / Updaten
4. GhostVault wordt geïnstalleerd op C:\ghostvault

## USB Portable Modus (Geen Installatie)

**Optie 1: Via install.bat (aanbevolen)**
1. Sluit de USB aan op de PC
2. Dubbelklik op `install.bat`
3. Kies optie 4: USB Portable Run
4. GhostVault start direct van USB
5. Alle tijdelijke bestanden blijven op USB (geen sporen op PC)

**Optie 2: Via usb-start.bat**
1. Sluit de USB aan op de PC
2. Navigeer naar `ghostvault/` map op USB
3. Dubbelklik op `usb-start.bat`
4. GhostVault start direct van USB
5. Alle tijdelijke bestanden blijven op USB (geen sporen op PC)

**Belangrijk:**
- Geen data wordt opgeslagen op PC (behalve localStorage ghosttrusted)
- Alle tijdelijke bestanden blijven op USB
- Geen installatie nodig

## Updaten

1. Sluit de USB met de nieuwe versie aan
2. Dubbelklik op `install.bat`
3. Kies optie 1: Installeren / Updaten
4. Volg de update instructies

## Verwijderen

1. Dubbelklik op `install.bat`
2. Kies optie 2: Verwijderen
3. Bevestig de verwijdering

## Health Check

1. Dubbelklik op `install.bat`
2. Kies optie 3: Health Check
3. Controleert versie en systeem status

## Starten

Na installatie:
- Dubbelklik op C:\ghostvault\start.bat om te starten
- Dubbelklik op C:\ghostvault\stop.bat om te stoppen

USB Portable:
- Dubbelklik op ghostvault\usb-start.bat op USB

## Snelkoppeling maken

Na installatie wordt er automatisch een snelkoppeling gemaakt op je bureaublad.
Je kunt ook handmatig een snelkoppeling maken:
1. Klik met rechtermuisknop op C:\ghostvault\start.bat
2. Kies "Snelkoppeling maken"
3. Verplaats de snelkoppeling naar je bureaublad

## Vereisten

- Windows 10 of hoger
- Node.js (wordt automatisch gezocht in deze volgorde):
  1. `node.exe` in huidige map
  2. `node.exe` in parent map
  3. Systeem Node.js installatie
- Administrator rechten (voor installatie op C:\)

## Veiligheid

- **USB Portable Modus**: Alle tijdelijke bestanden blijven op USB, geen sporen op PC
- Temp files worden behouden voor snellere startup bij volgende runs
- Geen internet verbinding vereist voor installatie
- Updates handmatig via USB

## Node.exe Locatie

De scripts zoeken automatisch naar `node.exe` op de volgende locaties:
1. `node.exe` in USB root
2. `ghostvault\node.exe` (in ghostvault map)
3. Systeem Node.js installatie

Als je node.exe op USB plaatst, wordt deze automatisch gekopieerd tijdens installatie.
