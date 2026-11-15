export const sanitizePhilippineMobileNumber = (value: string) =>
  value.replace(/\D/g, '').slice(0, 11);

export const isValidPhilippineMobileNumber = (value: string) =>
  /^09\d{9}$/.test(value);
