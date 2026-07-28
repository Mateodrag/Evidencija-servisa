#!/bin/bash
cd "$(dirname "$0")"
echo "======================================="
echo " Pokrecem aplikaciju za servise vozila"
echo "======================================="
echo ""

if ! command -v node &> /dev/null; then
  echo "Node.js nije instaliran na ovom racunalu."
  echo ""
  echo "Instaliraj ga s https://nodejs.org (odaberi LTS verziju),"
  echo "pa nakon instalacije ponovno dvoklikni ovu datoteku."
  echo ""
  read -p "Pritisni Enter za izlaz..."
  exit 1
fi

echo "Node.js pronadjen: $(node -v)"
echo ""
echo "Za par sekundi ce se otvoriti preglednik s aplikacijom."
echo "OVAJ PROZOR MORA OSTATI OTVOREN dok koristis aplikaciju."
echo "(Zatvoris li ga, aplikacija se gasi.)"
echo ""

( sleep 2 && open http://localhost:3000 ) &

node server/index.js
