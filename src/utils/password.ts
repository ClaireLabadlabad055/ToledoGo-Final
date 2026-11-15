const passwordRequirements = [
  { label: 'at least 12 characters', test: (password: string) => [...password].length >= 12 },
  { label: 'an uppercase letter', test: (password: string) => /[A-Z]/.test(password) },
  { label: 'a lowercase letter', test: (password: string) => /[a-z]/.test(password) },
  { label: 'a number', test: (password: string) => /\d/.test(password) },
  { label: 'a symbol', test: (password: string) => /[^A-Za-z0-9]/.test(password) },
];

export const getPasswordRequirementsMessage = (password: string) => {
  const missing = passwordRequirements
    .filter((requirement) => !requirement.test(password))
    .map((requirement) => requirement.label);

  return missing.length ? `Use ${missing.join(', ')}.` : null;
};

export const isStrongPassword = (password: string) =>
  getPasswordRequirementsMessage(password) === null;
