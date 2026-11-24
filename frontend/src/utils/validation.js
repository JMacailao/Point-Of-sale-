export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function passwordProblems(pw) {
  const problems = []
  if (pw.length < 8) problems.push('at least 8 characters')
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter')
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter')
  if (!/[0-9]/.test(pw)) problems.push('a number')
  return problems
}
