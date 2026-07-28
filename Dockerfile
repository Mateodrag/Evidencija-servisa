FROM node:22-slim

WORKDIR /app
COPY . .

# Aplikacija nema vanjskih ovisnosti (koristi ugrađeni node:sqlite), pa nije potreban npm install.

ENV PORT=3000
EXPOSE 3000

# Mapa /app/data mora biti na trajnom disku (volume) kako bi baza preživjela restart kontejnera.
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
