# Veritas Calendar (Netlify-ready)

## Avvio locale
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy su Netlify (consigliato)
- Build command: `npm run build`
- Publish directory: `dist`

Il file `netlify.toml` è già incluso (SPA redirect).


## PWA (Installabile su iOS/Android)
Dopo il deploy:
- iPhone (Safari): Condividi → "Aggiungi alla schermata Home"
- Android (Chrome): Menu → "Installa app" / "Aggiungi a schermata Home"
