function luhnValid(digits: string) {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function isValidSiren(value: string) {
  const digits = value.replace(/\s/g, "");
  return /^\d{9}$/.test(digits) && luhnValid(digits);
}

export function isValidSiret(value: string) {
  const digits = value.replace(/\s/g, "");
  return /^\d{14}$/.test(digits) && luhnValid(digits);
}

export function vatKeyFromSiren(siren: string) {
  const digits = siren.replace(/\s/g, "");
  const key = (12 + 3 * (Number(digits) % 97)) % 97;
  return String(key).padStart(2, "0");
}

export function vatFromSiren(siren: string) {
  const digits = siren.replace(/\s/g, "");
  return `FR${vatKeyFromSiren(digits)}${digits}`;
}

export function isValidFrenchVat(value: string) {
  const compact = value.replace(/\s/g, "").toUpperCase();
  if (!/^FR[0-9A-Z]{2}\d{9}$/.test(compact)) return false;
  const siren = compact.slice(4);
  return isValidSiren(siren) && compact.slice(2, 4) === vatKeyFromSiren(siren);
}

export function findValidSirens(count: number, start = 100000000) {
  const found: string[] = [];
  for (let value = start; found.length < count && value < 999999999; value += 1) {
    const siren = String(value);
    if (isValidSiren(siren)) found.push(siren);
  }
  return found;
}
