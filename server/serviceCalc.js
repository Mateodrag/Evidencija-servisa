// Pomoćne funkcije za izračun sljedećeg servisa i statusa dospijeća.

const SOON_DAYS_THRESHOLD = 14; // koliko dana unaprijed je "uskoro"
const SOON_KM_THRESHOLD = 222; // koliko km unaprijed je "uskoro"

function addMonths(dateStr, months) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Number(months || 0));
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + 'T00:00:00');
  const to = new Date(toDateStr + 'T00:00:00');
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/**
 * Izračunava sljedeći servis (po datumu i po kilometraži) i status dospijeća.
 * Vozilo dospijeva za servis kad se dostigne BILO KOJI od dva uvjeta (datum ili km),
 * ovisno što nastupi prije.
 *
 * Pravilo za kilometražu: dok vozilo još nije imalo niti jedan servis (zadnji_servis_km
 * nije postavljen), prvi servis dospijeva na "prvi_servis_km" (npr. 500 km). Nakon prvog
 * (i svakog sljedećeg) servisa, sljedeći servis dospijeva na zadnji_servis_km + interval_km
 * (npr. svakih 1500 km).
 */
function computeServiceInfo(vehicle) {
  const today = new Date().toISOString().slice(0, 10);

  const nextServiceDate = vehicle.zadnji_servis_datum
    ? addMonths(vehicle.zadnji_servis_datum, vehicle.interval_mjeseci)
    : null;

  let nextServiceKm = null;
  if (vehicle.zadnji_servis_km != null && vehicle.interval_km != null) {
    nextServiceKm = Number(vehicle.zadnji_servis_km) + Number(vehicle.interval_km);
  } else if (vehicle.prvi_servis_km != null) {
    nextServiceKm = Number(vehicle.prvi_servis_km);
  }

  let daysUntilDue = null;
  let kmUntilDue = null;
  let dueBy = null; // 'datum' | 'km' | null

  if (nextServiceDate) {
    daysUntilDue = daysBetween(today, nextServiceDate);
  }
  if (nextServiceKm != null) {
    kmUntilDue = nextServiceKm - Number(vehicle.trenutna_kilometraza || 0);
  }

  // Odredi statusnu razinu: 'overdue' | 'soon' | 'ok' | 'unknown'
  let level = 'unknown';
  let reasons = [];

  if (daysUntilDue == null && kmUntilDue == null) {
    level = 'unknown';
  } else {
    const overdueByDate = daysUntilDue != null && daysUntilDue <= 0;
    const overdueByKm = kmUntilDue != null && kmUntilDue <= 0;
    const soonByDate = daysUntilDue != null && daysUntilDue > 0 && daysUntilDue <= SOON_DAYS_THRESHOLD;
    const soonByKm = kmUntilDue != null && kmUntilDue > 0 && kmUntilDue <= SOON_KM_THRESHOLD;

    if (overdueByDate || overdueByKm) {
      level = 'overdue';
      if (overdueByDate) reasons.push('datum');
      if (overdueByKm) reasons.push('km');
    } else if (soonByDate || soonByKm) {
      level = 'soon';
      if (soonByDate) reasons.push('datum');
      if (soonByKm) reasons.push('km');
    } else {
      level = 'ok';
    }
  }

  return {
    sljedeci_servis_datum: nextServiceDate,
    sljedeci_servis_km: nextServiceKm,
    dana_do_servisa: daysUntilDue,
    km_do_servisa: kmUntilDue,
    servis_status: level, // overdue | soon | ok | unknown
    servis_razlog: reasons,
  };
}

module.exports = { computeServiceInfo, addMonths, daysBetween };
