/**
 * Translate raw Firebase / Identity Toolkit error codes into plain-English
 * messages suitable for showing directly to staff users.
 */
export function getFirebaseErrorMessage(error: unknown): string {
  const code =
    (error as { code?: string })?.code ??
    (error as { message?: string })?.message ??
    ''

  // Auth errors
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) {
    return 'Incorrect email or password. Please check your details and try again.'
  }
  if (code.includes('auth/email-already-in-use')) {
    return 'An account with this email address already exists.'
  }
  if (code.includes('auth/weak-password')) {
    return 'Password is too weak — use at least 8 characters including letters and numbers.'
  }
  if (code.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.'
  }
  if (code.includes('auth/user-disabled')) {
    return 'This account has been deactivated. Contact your administrator.'
  }
  if (code.includes('auth/too-many-requests')) {
    return 'Too many failed attempts. Please wait a few minutes before trying again.'
  }
  if (code.includes('auth/network-request-failed')) {
    return 'Network error — please check your internet connection and try again.'
  }
  if (code.includes('auth/requires-recent-login')) {
    return 'For security reasons, please sign out and sign back in before making this change.'
  }
  if (code.includes('auth/operation-not-allowed')) {
    return 'This sign-in method is not enabled. Contact your administrator.'
  }
  if (code.includes('auth/popup-closed-by-user') || code.includes('auth/cancelled-popup-request')) {
    return 'Sign-in was cancelled. Please try again.'
  }
  if (code.includes('auth/expired-action-code')) {
    return 'This link has expired. Please request a new one.'
  }
  if (code.includes('auth/invalid-action-code')) {
    return 'This link is invalid or has already been used.'
  }

  // Identity Toolkit / REST API errors
  if (code.includes('ADMIN_ONLY_OPERATION')) {
    return 'User creation is restricted. Go to Firebase Console → Authentication → Settings → User actions and uncheck "Disable create (sign-up)".'
  }
  if (code.includes('EMAIL_EXISTS')) {
    return 'An account with this email address already exists.'
  }
  if (code.includes('INVALID_PASSWORD')) {
    return 'Incorrect password. Please try again.'
  }
  if (code.includes('EMAIL_NOT_FOUND')) {
    return 'No account found with this email address.'
  }
  if (code.includes('USER_DISABLED')) {
    return 'This account has been deactivated. Contact your administrator.'
  }
  if (code.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
    return 'Too many failed attempts. Please wait a few minutes before trying again.'
  }
  if (code.includes('WEAK_PASSWORD')) {
    return 'Password is too weak — use at least 8 characters.'
  }

  // Firestore / general errors
  if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) {
    return 'You do not have permission to perform this action.'
  }
  if (code.includes('unavailable') || code.includes('UNAVAILABLE')) {
    return 'Service temporarily unavailable. Please try again in a moment.'
  }
  if (code.includes('not-found') || code.includes('NOT_FOUND')) {
    return 'The requested record could not be found.'
  }
  if (code.includes('already-exists') || code.includes('ALREADY_EXISTS')) {
    return 'This record already exists.'
  }
  if (code.includes('deadline-exceeded') || code.includes('DEADLINE_EXCEEDED')) {
    return 'The request timed out. Please check your connection and try again.'
  }

  // If the error already has a clean human-readable message (thrown by us), use it
  const msg = (error as { message?: string })?.message ?? ''
  if (msg && !msg.includes('Firebase:') && !msg.includes('auth/') && msg.length < 200) {
    return msg
  }

  return 'Something went wrong. Please try again or contact your administrator.'
}
