/**
 * Translate auth / API error codes into plain-English messages for staff.
 */
export function getAuthErrorMessage(error: unknown): string {
  const code =
    (error as { code?: string })?.code ??
    (error as { message?: string })?.message ??
    ''

  const msg = (error as { message?: string })?.message ?? ''

  if (code.includes('invalid_credentials') || msg.toLowerCase().includes('invalid login')) {
    return 'Incorrect email or password. Please check your details and try again.'
  }
  if (code.includes('email_exists') || msg.toLowerCase().includes('already registered')) {
    return 'An account with this email address already exists.'
  }
  if (code.includes('weak_password') || msg.toLowerCase().includes('password')) {
    if (msg.length < 120) return msg
  }
  if (code.includes('user_not_found')) {
    return 'No account found with this email address.'
  }
  if (code.includes('user_banned') || code.includes('user_disabled')) {
    return 'This account has been deactivated. Contact your administrator.'
  }
  if (code.includes('over_request_rate') || code.includes('too_many')) {
    return 'Too many failed attempts. Please wait a few minutes before trying again.'
  }
  if (msg && msg.length < 200) {
    return msg
  }

  return 'Something went wrong. Please try again or contact your administrator.'
}
